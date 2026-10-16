import io
import json, pytz
import importlib.util
from datetime import datetime, date, timedelta
from pathlib import Path
from meta_db import load_connection_raw, get_journal_conn, JOURNAL_TABLE

STORAGE_FILE = Path(__file__).resolve()
PROJECT_ROOT = STORAGE_FILE.parents[3]
USER_WORKSPACE_DIR = (PROJECT_ROOT / "user_workspace/python_scripts").resolve()

def resolve_user_script_path(script_path):
    if not script_path:
        raise ValueError("Для Python source не указан script_path")

    path = Path(script_path)

    if path.is_absolute():
        raise ValueError("script_path должен быть относительным путём внутри user_workspace")

    full_path = (USER_WORKSPACE_DIR / path).resolve()

    try:
        full_path.relative_to(USER_WORKSPACE_DIR)
    except ValueError:
        raise ValueError("script_path выходит за пределы user_workspace")

    if not full_path.is_file():
        raise ValueError(f"Python source script not found: {full_path}")

    return full_path

def parse_columns(columns_raw):
    if not columns_raw:
        return []

    if isinstance(columns_raw, list):
        return columns_raw

    return [
        col.strip().replace('"', "")
        for col in columns_raw.split(",")
        if col.strip()
    ]

def open_source(parsed_flow):
    return None

def parse_dt(value, timezone):
    tz = pytz.timezone(timezone or "UTC")

    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day)
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))

    if dt.tzinfo is None:
        return tz.localize(dt)

    return dt.astimezone(tz)


def add_grain(dt, grain):
    if grain == "hour":
        return dt + timedelta(hours=1)

    if grain == "day":
        return dt + timedelta(days=1)

    if grain == "month":
        return (dt.replace(day=1) + timedelta(days=32)).replace(day=1)

    if grain == "year":
        return dt.replace(year=dt.year + 1, month=1, day=1)

    raise ValueError(f"Неизвестный delta_batch_grain: {grain}")


def format_watermark(dt, delta_column_type=None):
    return dt.isoformat(sep=" ")

def parse_date_value(value):
    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    text = str(value).strip()

    if "T" in text or " " in text:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()

    return date.fromisoformat(text)


def add_date_grain(d, grain):
    if grain == "day":
        return d + timedelta(days=1)

    if grain == "month":
        return (d.replace(day=1) + timedelta(days=32)).replace(day=1)

    if grain == "year":
        return d.replace(year=d.year + 1, month=1, day=1)

    raise ValueError(f"Для date delta поддерживается day/month/year, получено: {grain}")

def get_last_success_watermark_to(conn, journal_table, source_name, target_table, mode, delta_column_type):
    if delta_column_type == "date":
        order_expr = "(add_info -> 'watermarks' ->> 'to')::date DESC"
    else:
        order_expr = "(add_info -> 'watermarks' ->> 'to')::timestamptz DESC"

    sql = f"""
        SELECT add_info -> 'watermarks' ->> 'to'
        FROM {journal_table}
        WHERE source = %s
          AND target = %s
          AND status = 'success'
          AND etl_type = %s
          AND add_info -> 'watermarks' ->> 'to' IS NOT NULL
        ORDER BY {order_expr}, end_at DESC
        LIMIT 1
    """

    with conn.cursor() as cur:
        cur.execute(sql, (source_name, target_table, mode))
        row = cur.fetchone()
        conn.commit()

    return row[0] if row else None

def build_timestamp_delta_batches(source_data, last_to, now):
    delta_column = source_data.get("delta_column")
    delta_start = source_data.get("delta_start")
    delta_end = source_data.get("delta_end")
    grain = source_data.get("delta_batch_grain") or "day"
    timezone = source_data.get("timezone") or "UTC"
    safety_seconds = int(source_data.get("safety_seconds") or 0)

    if last_to:
        start_ts = parse_dt(last_to, timezone) - timedelta(seconds=safety_seconds)
    else:
        start_ts = parse_dt(delta_start, timezone)

    end_ts = parse_dt(delta_end, timezone) if delta_end else now()

    batches = []
    cur = start_ts
    batch_id = 1

    while cur < end_ts:
        nxt = add_grain(cur, grain)

        if nxt > end_ts:
            nxt = end_ts

        batches.append({
            "batch_id": batch_id,
            "batch_cond": "1=1",
            "mode": "delta",
            "watermark_column": delta_column,
            "watermark_from": format_watermark(cur),
            "watermark_to": format_watermark(nxt),
        })

        cur = nxt
        batch_id += 1

    return batches


def build_date_delta_batches(source_data, last_to, now):
    delta_column = source_data.get("delta_column")
    delta_start = source_data.get("delta_start")
    delta_end = source_data.get("delta_end")
    grain = source_data.get("delta_batch_grain") or "day"
    safety_seconds = int(source_data.get("safety_seconds") or 0)

    if grain == "hour":
        raise ValueError("Для date delta нельзя использовать grain=hour")

    if last_to:
        start_dt = datetime.combine(parse_date_value(last_to), datetime.min.time())
        cur = (start_dt - timedelta(seconds=safety_seconds)).date()
    else:
        cur = parse_date_value(delta_start)

    if delta_end:
        end_date_exclusive = parse_date_value(delta_end) + timedelta(days=1)
    else:
        end_date_exclusive = now().date() + timedelta(days=1)

    batches = []
    batch_id = 1

    while cur < end_date_exclusive:
        nxt = add_date_grain(cur, grain)

        if nxt > end_date_exclusive:
            nxt = end_date_exclusive

        batches.append({
            "batch_id": batch_id,
            "batch_cond": "1=1",
            "mode": "delta",
            "watermark_column": delta_column,
            "watermark_from": cur.isoformat(),
            "watermark_to": nxt.isoformat(),
        })

        cur = nxt
        batch_id += 1

    return batches


def build_delta_batches(parsed_flow, request_id, now):
    source_data = parsed_flow["source_data"]
    target_data = parsed_flow["target_data"]

    source_name = parsed_flow["source_name"]
    target_table = target_data["schema_name"] + "." + target_data["target_table"]

    delta_column = source_data.get("delta_column")
    delta_column_type = source_data.get("delta_column_type") or "timestamp"
    delta_start = source_data.get("delta_start")

    if not delta_column:
        raise ValueError("Для python delta не указан delta_column")

    if delta_start in (None, ""):
        raise ValueError("Для python delta не указан delta_start")

    if delta_column_type not in ("timestamp", "date"):
        raise ValueError(f"Для python delta поддерживается только timestamp/date, получено: {delta_column_type}")

    with get_journal_conn() as conn:
        last_to = get_last_success_watermark_to(
            conn=conn,
            journal_table=JOURNAL_TABLE,
            source_name=source_name,
            target_table=target_table,
            mode="delta",
            delta_column_type=delta_column_type,
        )

    if delta_column_type == "date":
        return build_date_delta_batches(source_data, last_to, now)

    return build_timestamp_delta_batches(source_data, last_to, now)

def build_batches(parsed_flow, request_id, now):
    mode = parsed_flow["mode"]

    if mode == "full":
        return [
            {
                "batch_id": 1,
                "batch_cond": "1=1",
                "mode": "full",
            }
        ]

    if mode == "delta":
        return build_delta_batches(parsed_flow, request_id, now)

    raise ValueError(f"Неизвестный mode для Python source: {mode}")

def load_python_function(script_path, function_name):
    path = resolve_user_script_path(script_path)

    spec = importlib.util.spec_from_file_location(
        "belt_user_python_source",
        str(path)
    )

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, function_name):
        raise ValueError(f"Function '{function_name}' not found in {path}")

    return getattr(module, function_name)

def parse_params(raw_params):
    if raw_params in (None, ""):
        return {}

    if isinstance(raw_params, dict):
        return raw_params

    if isinstance(raw_params, str):
        return json.loads(raw_params)

    raise ValueError("Python source params must be dict or JSON string")

def normalize_rows(result):
    if result is None:
        return []

    if hasattr(result, "to_dict"):
        return result.to_dict(orient="records")

    if isinstance(result, list):
        return result

    if isinstance(result, tuple):
        return list(result)

    raise ValueError("Python source must return list[dict] or pandas.DataFrame")

def to_copy_text_value(value):
    if value is None:
        return r"\N"

    if isinstance(value, datetime):
        value = value.isoformat(sep=" ")

    elif isinstance(value, date):
        value = value.isoformat()

    text = str(value)

    return (
        text
        .replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )

class PythonSourceContext:
    def __init__(self, parsed_flow, request_id, batch, workspace_dir):
        self.parsed_flow = parsed_flow
        self.request_id = request_id
        self.batch = batch
        self.workspace_dir = str(workspace_dir)
        self.flow_id = parsed_flow.get("flow_id")
        self.chain_id = parsed_flow.get("chain_id")
        self.chain_run_id = parsed_flow.get("chain_run_id")

    def get_connection(self, connection_id):
        return load_connection_raw(connection_id)

    def log(self, message):
        print(f"{message}")

def extract_batch(parsed_flow, batch, source_resource, target_resource,
                  request_id, t_start, meta_info, now):
    source_data = parsed_flow["source_data"]

    script_path = source_data.get("script_path")
    function_name = source_data.get("function_name") or "run"
    params = parse_params(source_data.get("params"))

    if not script_path:
        raise ValueError("Для Python source не указан script_path")

    columns = parse_columns(source_data.get("columns", ""))

    if not columns:
        raise ValueError("Для Python source нужно указать columns")

    func = load_python_function(script_path, function_name)

    context = PythonSourceContext(
        parsed_flow=parsed_flow,
        request_id=request_id,
        batch=batch,
        workspace_dir=USER_WORKSPACE_DIR
    )

    result = func(params, context)
    rows = normalize_rows(result)

    if not rows:
        return None

    buf = io.BytesIO()

    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Python source rows must be dict objects")

        values = []

        for col in columns:
            values.append(row.get(col))

        values.append(request_id)
        values.append(batch["batch_id"])

        line = "\t".join(to_copy_text_value(v) for v in values) + "\n"
        buf.write(line.encode("utf-8"))

    buf.seek(0)
    return buf