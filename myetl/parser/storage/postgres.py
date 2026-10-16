from uuid import uuid4
import psycopg2
import pytz

from datetime import datetime, date, timedelta, timezone
from meta_db import load_connection_config
from myetl import pg
from meta_db import get_journal_conn, JOURNAL_TABLE


def open_pg_connection(connection_id):
    conn_config = load_connection_config(connection_id)

    allowed_keys = [
        "host",
        "port",
        "dbname",
        "user",
        "password",
        "sslmode",
        "connect_timeout",
    ]

    params = {
        key: value
        for key, value in conn_config.items()
        if key in allowed_keys
    }

    return psycopg2.connect(**params)


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


def parse_bool(value):
    return str(value).lower() == "true"


def quote_col(name):
    return '"' + str(name).replace('"', '') + '"'


def parse_dt(value, timezone_name):
    tz = pytz.timezone(timezone_name or "UTC")

    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day)
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))

    if dt.tzinfo is None:
        return tz.localize(dt)

    return dt.astimezone(tz)


def parse_date_value(value):
    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    text = str(value).strip()

    if "T" in text:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()

    if " " in text:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()

    return date.fromisoformat(text)


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


def add_date_grain(d, grain):
    if grain == "day":
        return d + timedelta(days=1)

    if grain == "month":
        return (d.replace(day=1) + timedelta(days=32)).replace(day=1)

    if grain == "year":
        return d.replace(year=d.year + 1, month=1, day=1)

    raise ValueError(f"Для date delta поддерживается day/month/year, получено: {grain}")


def get_last_success_watermark_to(conn, journal_table, source_table, target_table, mode, delta_column_type):
    if delta_column_type == "int":
        order_expr = "(add_info -> 'watermarks' ->> 'to')::numeric DESC"
    elif delta_column_type == "date":
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
        cur.execute(sql, (source_table, target_table, mode))
        row = cur.fetchone()
        conn.commit()

    return row[0] if row else None


def make_batch_meta(meta_info, batch):
    result = dict(meta_info)

    if batch.get("mode") == "delta":
        result["watermarks"] = {
            "column": batch["watermark_column"],
            "from": batch["watermark_from"],
            "to": batch["watermark_to"],
        }

    return result


def open_source(parsed_flow):
    source_data = parsed_flow["source_data"]

    conn = open_pg_connection(source_data["connection_id"])
    conn.autocommit = True

    return conn


def open_target(parsed_flow):
    target_data = parsed_flow["target_data"]

    return open_pg_connection(target_data["connection_id"])

def get_int_delta_max_value(source_data):
    delta_column = source_data.get("delta_column")
    source_table = source_data["schema_name"] + "." + source_data["table_name"]

    conn = None

    try:
        conn = open_pg_connection(source_data["connection_id"])

        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT max({quote_col(delta_column)})
                FROM {source_table}
            """)
            row = cur.fetchone()

        return row[0] if row else None

    finally:
        if conn:
            conn.close()

def build_int_delta_batches(source_data, last_to):
    delta_column = source_data.get("delta_column")
    delta_start = source_data.get("delta_start")
    batch_size_raw = source_data.get("delta_batch_grain")

    if batch_size_raw in (None, ""):
        raise ValueError("Для int delta нужно указать delta_batch_grain как размер batch")

    start_value = int(last_to) if last_to not in (None, "") else int(delta_start)
    batch_size = int(batch_size_raw)

    if batch_size <= 0:
        raise ValueError("Для int delta размер batch должен быть больше 0")

    max_value = get_int_delta_max_value(source_data)

    if max_value is None:
        return []

    end_exclusive = int(max_value) + 1

    batches = []
    cur = start_value
    batch_id = 1

    while cur < end_exclusive:
        nxt = cur + batch_size

        if nxt > end_exclusive:
            nxt = end_exclusive

        batch_cond = (
            f"{quote_col(delta_column)} >= {cur} "
            f"AND {quote_col(delta_column)} < {nxt}"
        )

        batches.append({
            "batch_id": batch_id,
            "batch_cond": batch_cond,
            "mode": "delta",
            "watermark_column": delta_column,
            "watermark_from": cur,
            "watermark_to": nxt,
        })

        cur = nxt
        batch_id += 1

    return batches

def build_date_delta_batches(source_data, last_to, now):
    delta_column = source_data.get("delta_column")
    delta_start = source_data.get("delta_start")
    grain = source_data.get("delta_batch_grain") or "day"
    timezone_name = source_data.get("timezone") or "UTC"
    safety_seconds = int(source_data.get("safety_seconds") or 0)

    if grain == "hour":
        raise ValueError("Для date delta нельзя использовать grain=hour")

    if last_to:
        start_dt = parse_dt(last_to, timezone_name) - timedelta(seconds=safety_seconds)
        cur = start_dt.date()
    else:
        cur = parse_date_value(delta_start)

    end_date_exclusive = now().date() + timedelta(days=1)

    batches = []
    batch_id = 1

    while cur < end_date_exclusive:
        nxt = add_date_grain(cur, grain)

        if nxt > end_date_exclusive:
            nxt = end_date_exclusive

        watermark_from = cur.isoformat()
        watermark_to = nxt.isoformat()

        batch_cond = (
            f"{quote_col(delta_column)} >= '{watermark_from}' "
            f"AND {quote_col(delta_column)} < '{watermark_to}'"
        )

        batches.append(
            {
                "batch_id": batch_id,
                "batch_cond": batch_cond,
                "mode": "delta",
                "watermark_column": delta_column,
                "watermark_from": watermark_from,
                "watermark_to": watermark_to,
            }
        )

        cur = nxt
        batch_id += 1

    return batches


def build_timestamp_delta_batches(source_data, last_to, now):
    delta_column = source_data.get("delta_column")
    delta_start = source_data.get("delta_start")
    grain = source_data.get("delta_batch_grain") or "day"
    timezone_name = source_data.get("timezone") or "UTC"
    safety_seconds = int(source_data.get("safety_seconds") or 0)
    tail_merge_seconds = int(source_data.get("tail_merge_seconds") or 0)

    if last_to:
        start_ts = parse_dt(last_to, timezone_name) - timedelta(seconds=safety_seconds)
    else:
        start_ts = parse_dt(delta_start, timezone_name)

    end_ts = now()

    batches = []
    cur = start_ts
    batch_id = 1

    while cur < end_ts:
        nxt = add_grain(cur, grain)

        if nxt < end_ts and tail_merge_seconds > 0:
            tail_seconds = (end_ts - nxt).total_seconds()

            if tail_seconds <= tail_merge_seconds:
                nxt = end_ts

        if nxt > end_ts:
            nxt = end_ts

        watermark_from = cur.isoformat(sep=" ")
        watermark_to = nxt.isoformat(sep=" ")

        batch_cond = (
            f"{quote_col(delta_column)} >= '{watermark_from}' "
            f"AND {quote_col(delta_column)} < '{watermark_to}'"
        )

        batches.append(
            {
                "batch_id": batch_id,
                "batch_cond": batch_cond,
                "mode": "delta",
                "watermark_column": delta_column,
                "watermark_from": watermark_from,
                "watermark_to": watermark_to,
            }
        )

        cur = nxt
        batch_id += 1

    return batches


def build_delta_batches(parsed_flow, request_id, now):
    source_data = parsed_flow["source_data"]

    source_table = source_data["schema_name"] + "." + source_data["table_name"]
    target_table = parsed_flow["target_name"]
    journal_table = JOURNAL_TABLE

    delta_column = source_data.get("delta_column")
    delta_column_type = source_data.get("delta_column_type") or "timestamp"
    delta_start = source_data.get("delta_start")

    if not delta_column:
        raise ValueError("Для delta не указан delta_column")

    if delta_start in (None, ""):
        raise ValueError("Для delta не указан delta_start")

    if delta_column_type not in ("timestamp", "date", "int"):
        raise ValueError(f"Неизвестный delta_column_type: {delta_column_type}")

    with get_journal_conn() as conn:
        last_to = get_last_success_watermark_to(
            conn=conn,
            journal_table=journal_table,
            source_table=source_table,
            target_table=target_table,
            mode="delta",
            delta_column_type=delta_column_type,
        )

    if delta_column_type == "int":
        return build_int_delta_batches(source_data, last_to)

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

    raise ValueError(f"Неизвестный mode для Postgres: {mode}")


def get_local_journal_table(target_data):
    journal_name = (target_data.get("journal_table") or "").strip()

    if not journal_name:
        return None

    return target_data["schema_name"] + "." + journal_name


def extract_batch(parsed_flow, batch, source_resource, target_resource,
                  request_id, t_start, meta_info, now):
    source_data = parsed_flow["source_data"]
    target_data = parsed_flow["target_data"]

    source_table = source_data["schema_name"] + "." + source_data["table_name"]
    target_table = parsed_flow["target_name"]
    journal_table = get_local_journal_table(target_data)

    columns = parse_columns(source_data.get("columns", ""))
    source_sql = (source_data.get("source_sql") or "").strip()
    batch_meta_info = make_batch_meta(meta_info, batch)

    with get_journal_conn() as journal_conn:
        return pg.extract_from_pg(
            batch["mode"],
            source_resource,
            target_resource,
            source_table,
            target_table,
            columns,
            batch["batch_id"],
            batch["batch_cond"],
            batch_meta_info,
            request_id,
            t_start,
            journal_table,
            now,
            source_sql=source_sql,
            main_journal_conn=journal_conn,
            main_journal_table=JOURNAL_TABLE,
        )


def load_batch(parsed_flow, batch, target_resource, buf,
               request_id, t_start, meta_info, now):
    source_data = parsed_flow["source_data"]
    target_data = parsed_flow["target_data"]

    source_table = parsed_flow["source_name"]
    target_table = target_data["schema_name"] + "." + target_data["target_table"]
    journal_table = get_local_journal_table(target_data)

    columns = parse_columns(source_data.get("columns", ""))
    batch_meta_info = make_batch_meta(meta_info, batch)

    with get_journal_conn() as journal_conn:
        if parse_bool(target_data.get("truncate_table_before_load", "false")):
            pg.clear_target_table(
                target_resource,
                target_table,
                journal_table,
                batch_meta_info,
                main_journal_conn=journal_conn,
                main_journal_table=JOURNAL_TABLE,
            )

        return pg.extract_to_pg(
            batch["mode"],
            target_resource,
            source_table,
            target_table,
            buf,
            columns,
            batch["batch_id"],
            batch_meta_info,
            request_id,
            t_start,
            journal_table,
            now,
            main_journal_conn=journal_conn,
            main_journal_table=JOURNAL_TABLE,
        )


def get_transformation_batches(conn, journal_table, source_table, target_table, mode):
    if mode == "full":
        sql = f"""
            SELECT 
                j.request_id, 
                j.batch_id,
                (j.add_info -> 'watermarks' ->> 'column') AS batch_column,
                (j.add_info -> 'watermarks' ->> 'from') AS batch_from,
                (j.add_info -> 'watermarks' ->> 'to') AS batch_to,
                COALESCE((j.add_info -> 'watermarks' ->> 'to_inclusive')::boolean, false) AS to_inclusive
            FROM {journal_table} j
            WHERE j.target = %s 
              AND j.status = 'success'
              AND COALESCE(j.rows_count, 0) > 0
            ORDER BY j.request_id, j.batch_id
        """
        params = (source_table,)

    elif mode == "delta":
        sql = f"""
            SELECT 
                j.request_id, 
                j.batch_id,
                (j.add_info -> 'watermarks' ->> 'column') AS batch_column,
                (j.add_info -> 'watermarks' ->> 'from') AS batch_from,
                (j.add_info -> 'watermarks' ->> 'to') AS batch_to,
                COALESCE((j.add_info -> 'watermarks' ->> 'to_inclusive')::boolean, false) AS to_inclusive
            FROM {journal_table} j
            WHERE j.target = %s 
              AND j.status = 'success'
              AND COALESCE(j.rows_count, 0) > 0
              AND NOT EXISTS (
                  SELECT 1 
                  FROM {journal_table} s 
                  WHERE s.source = j.target 
                    AND s.target = %s 
                    AND s.request_id = j.request_id 
                    AND s.batch_id = j.batch_id 
                    AND s.status = 'success'
              )
            ORDER BY j.request_id, j.batch_id
        """
        params = (source_table, target_table)

    else:
        raise ValueError(f"Неизвестный mode для transformation: {mode}")

    with conn.cursor() as cur:
        cur.execute(sql, params)
        batches = cur.fetchall()

    conn.commit()
    return batches


def run_transformation(parsed_flow):
    source_data = parsed_flow["source_data"]
    transform_data = parsed_flow["transform_data"]
    target_data = parsed_flow["target_data"]
    mode = parsed_flow["mode"]

    conn = None
    journal_conn = None
    staging_table = None
    recalculate = mode == "delta" and parse_bool(
        target_data.get("recalculate_target_delta_boundaries", True)
    )

    try:
        conn = open_pg_connection(target_data["connection_id"])
        journal_conn = get_journal_conn()

        source_table = source_data["schema_name"] + "." + source_data["table_name"]
        target_table = target_data["schema_name"] + "." + target_data["target_table"]
        journal_table = get_local_journal_table(target_data)

        user_sql = transform_data.get("sql") or source_data.get("sql")
        if not user_sql:
            raise ValueError("Для transformation не указан SQL")

        columns = parse_columns(
            target_data.get("columns")
            or transform_data.get("columns")
            or source_data.get("columns")
            or ""
        )
        keys = parse_columns(target_data.get("keys") or transform_data.get("keys") or "")

        now = lambda: datetime.now(timezone.utc)

        if mode not in ("full", "delta"):
            raise ValueError(f"Неизвестный mode для transformation: {mode}")

        batches = get_transformation_batches(
            conn=journal_conn,
            journal_table=JOURNAL_TABLE,
            source_table=source_table,
            target_table=target_table,
            mode=mode,
        )

        if recalculate and batches:
            staging_table = '"belt_stage_' + uuid4().hex + '"'

        for request_id, batch_id, batch_column, batch_from, batch_to, to_inclusive in batches:
            target_delta_column = (target_data.get("target_delta_column") or "").strip() or batch_column
            # Input windows exclude the end; measured MIN/MAX include it.
            upper_op = "<=" if to_inclusive else "<"
            if batch_from is not None and batch_to is not None and batch_column:
                where_cond_source = f"""
                    {batch_column} >= '{batch_from}'
                    AND {batch_column} {upper_op} '{batch_to}'
                    AND tech_request_id = '{request_id}'
                    AND tech_batch_id = {batch_id}
                """
                where_cond_target = f"""
                    WHERE {target_delta_column} >= '{batch_from}'
                    AND {target_delta_column} {upper_op} '{batch_to}'
                    AND tech_request_id = '{request_id}'
                    AND tech_batch_id = {batch_id}
                """
            else:
                where_cond_source = f"""
                    tech_request_id = '{request_id}'
                    AND tech_batch_id = {batch_id}
                """
                where_cond_target = f"""
                    WHERE tech_request_id = '{request_id}'
                    AND tech_batch_id = {batch_id}
                """

            meta_info = {
                "watermarks": {
                    "column": target_delta_column if batch_from and batch_to else None,
                    "from": batch_from,
                    "to": batch_to,
                },
                "chain_id": parsed_flow.get("chain_id"),
                "chain_run_id": parsed_flow.get("chain_run_id"),
                "flow_id": parsed_flow.get("flow_id"),
                "flow_run_id": parsed_flow.get("flow_run_id"),
                "flow_type": "transformation",
                "target_connection_id": parsed_flow.get("target_connection_id"),
                "target_connection_type": parsed_flow.get("target_connection_type"),
            }

            if to_inclusive:
                meta_info["watermarks"]["to_inclusive"] = True

            user_message = target_data.get("add_info")
            if user_message is not None and str(user_message).strip() != "":
                meta_info["message"] = user_message

            pg.flow(
                conn=conn,
                source_table=source_table,
                target_table=target_table,
                source_table_in_jurnal=source_table,
                columns=columns,
                keys=keys,
                on_conflict=target_data.get("on_conflict") or "nothing",
                journal_table=journal_table,
                request_id=request_id,
                batch_id=batch_id,
                mode=mode,
                now=now,
                pg_version=int(target_data.get("pg_version") or 15),
                user_sql=user_sql,
                where_cond_source=where_cond_source,
                meta_info=meta_info,
                where_cond_target=where_cond_target,
                main_journal_conn=journal_conn,
                main_journal_table=JOURNAL_TABLE,
                staging_table=staging_table,
                target_delta_column=target_delta_column,
            )

        return

    finally:
        if journal_conn:
            journal_conn.close()
        if conn:
            conn.close()