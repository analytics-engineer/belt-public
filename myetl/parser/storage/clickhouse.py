from uuid import uuid4
import clickhouse_connect

from meta_db import load_connection_config, get_journal_conn, JOURNAL_TABLE
from myetl.pg.core import add_journal_dual


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


def quote_ident(name):
    return "`" + str(name).replace("`", "") + "`"


def quote_table(table_name):
    parts = [p.strip() for p in str(table_name).split(".") if p.strip()]
    return ".".join(quote_ident(p) for p in parts)


def ch_string(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def open_target(parsed_flow):
    target_data = parsed_flow["target_data"]
    conn_config = load_connection_config(target_data["connection_id"])

    return clickhouse_connect.get_client(
        host=conn_config.get("host", "localhost"),
        port=int(conn_config.get("port") or 8123),
        username=conn_config.get("username") or conn_config.get("user") or "default",
        password=conn_config.get("password") or "",
        database=conn_config.get("database") or conn_config.get("dbname") or "default",
        secure=parse_bool(conn_config.get("secure", "false")),
    )


def load_batch(parsed_flow, batch, target_resource, buf,
               request_id, t_start, meta_info, now):
    if not buf:
        return

    source_data = parsed_flow["source_data"]
    target_data = parsed_flow["target_data"]

    source_table = parsed_flow["source_name"]
    target_table = parsed_flow["target_name"]

    columns = parse_columns(source_data.get("columns", ""))
    ch_columns = columns + ["tech_request_id", "tech_batch_id"]

    batch_meta_info = dict(meta_info)

    if batch.get("mode") == "delta":
        batch_meta_info["watermarks"] = {
            "column": batch["watermark_column"],
            "from": batch["watermark_from"],
            "to": batch["watermark_to"],
        }

    with get_journal_conn() as journal_conn:
        try:
            if parse_bool(target_data.get("truncate_table_before_load", "false")):
                target_resource.command(f"TRUNCATE TABLE {quote_table(target_table)}")

                add_journal_dual(
                    None, None,
                    journal_conn, JOURNAL_TABLE,
                    "clear", batch_meta_info,
                    None, target_table,
                    t_start, now(),
                    "success", None,
                    None, None,
                    0, None
                )

            target_resource.raw_insert(
                table=target_table,
                column_names=ch_columns,
                insert_block=buf,
                fmt="TSV"
            )

            request_id_value = ch_string(request_id)

            result = target_resource.query(f"""
                SELECT count()
                FROM {quote_table(target_table)}
                WHERE tech_request_id = parseDateTime64BestEffort({request_id_value}, 3, 'UTC')
                  AND tech_batch_id = {int(batch["batch_id"])}
            """)

            rows = result.result_rows[0][0]
            end_at = now()

            add_journal_dual(
                None, None,
                journal_conn, JOURNAL_TABLE,
                batch["mode"], batch_meta_info,
                source_table, target_table,
                t_start, end_at,
                "success", None,
                request_id, batch["batch_id"],
                rows, None
            )

        except Exception as e:
            add_journal_dual(
                None, None,
                journal_conn, JOURNAL_TABLE,
                batch["mode"], batch_meta_info,
                source_table, target_table,
                t_start, now(),
                "fail", None,
                request_id, batch["batch_id"],
                0, str(e)
            )
            raise

from datetime import datetime, timezone


def get_transformation_batches(conn, journal_table, source_table, target_table, mode):
    if mode == "full":
        query = f"""
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
        query = f"""
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
        raise ValueError(f"Unknown mode for transformation: {mode}")

    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    conn.commit()
    return rows


def validate_transformation_columns(columns):
    system_cols = {"tech_request_id", "tech_batch_id"}

    bad_cols = [
        c for c in columns
        if c.strip().lower().replace("`", "").replace('"', "") in system_cols
    ]

    if bad_cols:
        raise ValueError(
            "Technical fields cannot be specified in the Columns field: "
            + ", ".join(bad_cols)
            + ". Specify only business columns. "
            + "tech_request_id and tech_batch_id are added automatically by the system."
        )

    business_cols = [c.strip().replace("`", "").replace('"', "") for c in columns if c.strip()]

    if not business_cols:
        raise ValueError("Business columns must be specified in target Columns for ClickHouse transformation")

    return business_cols


def ch_datetime_value(value):
    return f"parseDateTime64BestEffort({ch_string(value)}, 3, 'UTC')"

def build_ch_where_cond(request_id, batch_id, batch_column, batch_from, batch_to,
                        to_inclusive=False):
    if batch_from is not None and batch_to is not None and batch_column:
        column_sql = quote_ident(batch_column)
        # Input windows exclude the end; measured MIN/MAX include it.
        upper_op = "<=" if to_inclusive else "<"

        return f"""
            {column_sql} >= {ch_datetime_value(batch_from)}
            AND {column_sql} {upper_op} {ch_datetime_value(batch_to)}
            AND tech_request_id = {ch_datetime_value(request_id)}
            AND tech_batch_id = {int(batch_id)}
        """

    return f"""
        tech_request_id = {ch_datetime_value(request_id)}
        AND tech_batch_id = {int(batch_id)}
    """

def run_transformation(parsed_flow):
    if parsed_flow.get("source_type") != "clickhouse":
        raise NotImplementedError("ClickHouse transformation currently supports only ClickHouse source")

    source_data = parsed_flow["source_data"]
    transform_data = parsed_flow["transform_data"]
    target_data = parsed_flow["target_data"]
    mode = parsed_flow["mode"]

    ch_client = None
    journal_conn = None
    staging_table = None
    recalculate = mode == "delta" and parse_bool(
        target_data.get("recalculate_target_delta_boundaries", True)
    )

    try:
        ch_client = open_target(parsed_flow)
        journal_conn = get_journal_conn()

        source_table = parsed_flow["source_name"]
        target_table = parsed_flow["target_name"]

        user_sql = transform_data.get("sql") or source_data.get("sql")
        if not user_sql:
            raise ValueError("SQL is not specified for ClickHouse transformation")

        columns = parse_columns(
            target_data.get("columns")
            or transform_data.get("columns")
            or source_data.get("columns")
            or ""
        )

        business_cols = validate_transformation_columns(columns)

        now = lambda: datetime.now(timezone.utc)

        if mode not in ("full", "delta"):
            raise ValueError(f"Unknown mode for ClickHouse transformation: {mode}")

        batches = get_transformation_batches(
            conn=journal_conn,
            journal_table=JOURNAL_TABLE,
            source_table=source_table,
            target_table=target_table,
            mode=mode
        )

        insert_cols = business_cols + ["tech_request_id", "tech_batch_id"]
        insert_cols_sql = ", ".join(quote_ident(c) for c in insert_cols)
        if recalculate and batches:
            database = target_table.rsplit(".", 1)[0]
            staging_table = database + ".belt_stage_" + uuid4().hex
            ch_client.command(f"""
                CREATE TABLE {quote_table(staging_table)}
                ENGINE = MergeTree ORDER BY (tech_request_id, tech_batch_id)
                AS SELECT {insert_cols_sql} FROM {quote_table(target_table)} WHERE 0
            """)

        for request_id, batch_id, batch_column, batch_from, batch_to, to_inclusive in batches:
            t_start = now()
            target_delta_column = (target_data.get("target_delta_column") or "").strip() or batch_column

            where_cond_source = build_ch_where_cond(
                request_id=request_id,
                batch_id=batch_id,
                batch_column=batch_column,
                batch_from=batch_from,
                batch_to=batch_to,
                to_inclusive=to_inclusive,
            )

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

            select_cols_sql = ", ".join(f"q.{quote_ident(c)}" for c in business_cols)

            user_select_sql = user_sql.format(where_cond_source=where_cond_source)

            try:
                if staging_table and target_delta_column not in business_cols:
                    raise ValueError("Target delta column must be present in Columns")
                insert_sql = f"""
                    INSERT INTO {quote_table(staging_table or target_table)} ({insert_cols_sql})
                    SELECT
                        {select_cols_sql},
                        {ch_datetime_value(request_id)} AS tech_request_id,
                        {int(batch_id)} AS tech_batch_id
                    FROM (
                        {user_select_sql}
                    ) q
                """

                ch_client.command(insert_sql, settings={"async_insert": 0})

                batch_filter = f"""
                    tech_request_id = {ch_datetime_value(request_id)}
                    AND tech_batch_id = {int(batch_id)}
                """
                if staging_table:
                    delta_col_sql = quote_ident(target_delta_column)
                    result = ch_client.query(f"""
                        SELECT count(), minOrNull({delta_col_sql}), maxOrNull({delta_col_sql})
                        FROM {quote_table(staging_table)} WHERE {batch_filter}
                    """)
                    rows_count, delta_min, delta_max = result.result_rows[0]
                    meta_info["watermarks"] = {
                        "column": target_delta_column,
                        "from": delta_min,
                        "to": delta_max,
                        "to_inclusive": True,
                    }
                    ch_client.command(f"""
                        INSERT INTO {quote_table(target_table)} ({insert_cols_sql})
                        SELECT {insert_cols_sql} FROM {quote_table(staging_table)}
                        WHERE {batch_filter}
                    """, settings={"async_insert": 0})
                else:
                    result = ch_client.query(f"""
                        SELECT count() FROM {quote_table(target_table)}
                        WHERE {batch_filter}
                    """)
                    rows_count = result.result_rows[0][0]

                add_journal_dual(
                    None, None,
                    journal_conn, JOURNAL_TABLE,
                    mode, meta_info,
                    source_table, target_table,
                    t_start, now(),
                    "success", None,
                    request_id, batch_id,
                    rows_count, None
                )

            except Exception as e:
                add_journal_dual(
                    None, None,
                    journal_conn, JOURNAL_TABLE,
                    mode, meta_info,
                    source_table, target_table,
                    t_start, now(),
                    "fail", None,
                    request_id, batch_id,
                    0, str(e)
                )
                raise

    finally:
        try:
            if ch_client and staging_table:
                ch_client.command(f"DROP TABLE IF EXISTS {quote_table(staging_table)} SYNC")
        finally:
            if journal_conn:
                journal_conn.close()
            if ch_client:
                ch_client.close()