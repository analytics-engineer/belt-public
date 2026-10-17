import json, pytz, io
from datetime import datetime, timezone

def add_journal(conn, journal_table, etl_type, add_info, source, target,
                start_at, end_at, status, source_request_id, request_id,
                batch_id, rows_count, text_error):
    add_info = add_info or {}
    chain_id = add_info.get("chain_id")
    flow_id = add_info.get("flow_id")
    flow_run_id = add_info.get("flow_run_id")
    chain_run_id = add_info.get("chain_run_id")
    flow_type = add_info.get("flow_type", "")
    target_connection_id = add_info.get("target_connection_id")
    target_connection_type = add_info.get("target_connection_type")
    journal_add_info = {
    k: v
    for k, v in add_info.items()
    if k not in {
        "chain_id",
        "flow_id",
        "flow_run_id",
        "chain_run_id",
        "flow_type",
        "target_connection_id",
        "target_connection_type",
    }
}

    with conn.cursor() as c:
        c.execute(
            f"""insert into {journal_table}
                (chain_id, flow_id, chain_run_id, flow_run_id, etl_type, flow_type, add_info, target_connection_id,
                  target_connection_type, source, target,
                 start_at, end_at, status, source_request_id, request_id,
                 batch_id, rows_count, text_error)
                values (%s,%s,%s,%s, %s, %s,%s::jsonb,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (chain_id, flow_id, chain_run_id, flow_run_id, etl_type, flow_type, json.dumps(journal_add_info, default=str),
             target_connection_id, target_connection_type, source, target, start_at, end_at, status,
              source_request_id, request_id, batch_id, rows_count, text_error)
        )
    conn.commit()

def add_journal_dual(local_conn, local_journal_table, main_conn, main_journal_table,
                     etl_type, add_info, source, target, start_at, end_at, status,
                     source_request_id, request_id, batch_id, rows_count, text_error):
    if local_conn is not None:
        if local_journal_table:
            add_journal(local_conn, local_journal_table, etl_type, add_info, source, target,
                        start_at, end_at, status, source_request_id, request_id,
                        batch_id, rows_count, text_error)
        else:
            local_conn.commit()

    if main_conn is not None and main_journal_table:
        add_journal(main_conn, main_journal_table, etl_type, add_info, source, target,
                    start_at, end_at, status, source_request_id, request_id,
                    batch_id, rows_count, text_error)

def execute_ddl(conn, sql):
    try:
        with conn.cursor() as c:
            c.execute(sql)
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e

def clear_target_table(conn, target_table, journal_table, meta_info,
                       main_journal_conn=None, main_journal_table=None):
    start_at = datetime.now(timezone.utc)
    try:
        with conn.cursor() as c:
            c.execute("SET lock_timeout = '20s';")
            c.execute(f"TRUNCATE TABLE {target_table} RESTART IDENTITY;")

        add_journal_dual(conn, journal_table, main_journal_conn, main_journal_table,
                         "clear", meta_info, None, target_table, start_at,
                         datetime.now(timezone.utc), "success", None, None, None, 0, None)

    except Exception as e:
        conn.rollback()
        try:
            add_journal_dual(conn, journal_table, main_journal_conn, main_journal_table,
                             "clear", meta_info, None, target_table, start_at,
                             datetime.now(timezone.utc), "fail", None, None, None, 0, str(e))
        except Exception:
            conn.rollback()
        raise

def extract_from_pg(mode, src_conn, trg_conn, source_table, target_table, columns,
                    batch_id, batch_cond, meta_info, request_id, start_at,
                    journal_table, now, source_sql=None,
                    main_journal_conn=None, main_journal_table=None):
    cols_str = ",".join(f'"{c}"' for c in columns)
    buf = io.BytesIO()

    try:
        source_sql = (source_sql or "").strip()

        if source_sql:
            if "{where_cond_source}" not in source_sql:
                raise ValueError("Source SQL must contain the {where_cond_source} placeholder")
            
            rendered_source_sql = source_sql.replace(
                "{where_cond_source}",
                batch_cond
            ).strip()

            rendered_source_sql = rendered_source_sql.rstrip(";").strip()

            copy_sql = f"""
                COPY (
                    SELECT {cols_str},
                           '{request_id}'::timestamptz AS "tech_request_id",
                           {batch_id}::int AS tech_batch_id
                    FROM (
                        {rendered_source_sql}
                    ) AS belt_source_sql
                ) TO STDOUT WITH (FORMAT TEXT, NULL '\\N')
            """
        else:
            copy_sql = f"""
                COPY (
                    SELECT {cols_str},
                           '{request_id}'::timestamptz AS "tech_request_id",
                           {batch_id}::int AS tech_batch_id
                    FROM {source_table}
                    WHERE {batch_cond}
                ) TO STDOUT WITH (FORMAT TEXT, NULL '\\N')
            """

        with src_conn.cursor() as c:
            c.copy_expert(copy_sql, buf)

        src_conn.commit()

        if buf.tell() > 0:
            buf.seek(0)
            return buf

        return None

    except Exception as e:
        src_conn.rollback()
        end_at = now()
        add_journal_dual(
            trg_conn,
            journal_table,
            main_journal_conn,
            main_journal_table,
            mode,
            meta_info,
            source_table,
            target_table,
            start_at,
            end_at,
            "fail",
            None,
            request_id,
            batch_id,
            0,
            str(e)
        )
        raise

def extract_to_pg(mode, trg_conn, source_table, target_table, buf, columns,
                  batch_id, meta_info, request_id, start_at, journal_table, now,
                  main_journal_conn=None, main_journal_table=None):
    if not buf:
        return

    all_cols = ",".join(f'"{c}"' for c in columns + ["tech_request_id", "tech_batch_id"])

    with trg_conn.cursor() as c:
        try:
            copy_sql = f"COPY {target_table} ({all_cols}) FROM STDIN WITH (FORMAT TEXT, NULL '\\N')"
            c.copy_expert(copy_sql, buf)

            c.execute(f"""
                SELECT count(*) FROM {target_table}
                WHERE tech_request_id = %s AND tech_batch_id = %s
            """, (request_id, batch_id))

            rows = c.fetchone()[0]
            end_at = now()

            add_journal_dual(trg_conn, journal_table, main_journal_conn, main_journal_table,
                             mode, meta_info, source_table, target_table, start_at,
                             end_at, "success", None, request_id, batch_id, rows, None)

        except Exception as e:
            trg_conn.rollback()
            end_at = now()

            add_journal_dual(trg_conn, journal_table, main_journal_conn, main_journal_table,
                             mode, meta_info, source_table, target_table, start_at,
                             end_at, "fail", None, request_id, batch_id, 0, str(e))
            raise

def get_last_dt(conn, target_table, date_column):
    with conn.cursor() as c:
        c.execute(
            f"SELECT max({date_column}) FROM {target_table}"
        )
        value = c.fetchone()[0]
   # print(value)
    return value  # may be None

def get_first_dt(conn, target_table, date_column):
    with conn.cursor() as c:
        c.execute(
            f"SELECT min({date_column}) FROM {target_table}"
        )
        value = c.fetchone()[0]
    #print(value)
    return value  # may be None

def split_sql_hooks(user_sql, where_cond_source):
    pre_hook_start = "-- @pre_hook_start"
    pre_hook_end = "-- @pre_hook_end"

    has_pre_hook_start = pre_hook_start in user_sql
    has_pre_hook_end = pre_hook_end in user_sql

    if has_pre_hook_start != has_pre_hook_end:
        raise ValueError("Both markers must be specified: -- @pre_hook_start -- @pre_hook_end")

    if not has_pre_hook_start:
        return None, user_sql.format(where_cond_source=where_cond_source)

    before_raw, rest = user_sql.split(pre_hook_start, 1)
    raw_part, after_raw = rest.split(pre_hook_end, 1)

    raw_sql = raw_part.strip().format(where_cond_source=where_cond_source)
    select_sql = (before_raw + after_raw).strip().format(where_cond_source=where_cond_source)

    if not select_sql:
        raise ValueError("A SELECT for loading into target must remain after pre_hook")

    return raw_sql, select_sql

def flow(conn, source_table, target_table, source_table_in_jurnal,
         columns, keys, on_conflict, journal_table, request_id, batch_id, mode,
         now, pg_version, user_sql, where_cond_source, meta_info,
         where_cond_target, main_journal_conn=None, main_journal_table=None,
         staging_table=None, target_delta_column=None):
    start_at = now()

    system_cols = {"tech_request_id", "tech_batch_id"}

    bad_cols = [
        c for c in columns
        if c.strip().lower().replace('"', "") in system_cols
    ]

    if bad_cols:
        raise ValueError(
            "Technical fields cannot be specified in the Columns field: "
            + ", ".join(bad_cols)
            + ". Specify only business columns. "
            + "tech_request_id and tech_batch_id are added automatically by the system."
        )

    business_cols = [c.strip().replace('"', "") for c in columns if c.strip()]

    if not business_cols:
        raise ValueError("Business columns must be specified in target Columns for transformation")

    use_on_conflict = (pg_version > 10) and bool(keys)
    clean_keys = [k.strip().replace('"', "") for k in keys if k.strip()]
    conflict_cols = ",".join(f'"{k}"' for k in clean_keys)

    if on_conflict == "update":
        update_cols_list = business_cols + ["tech_request_id", "tech_batch_id"]
        update_cols = ",".join(
            f'"{c}" = EXCLUDED."{c}"'
            for c in update_cols_list
            if c not in clean_keys
        )

        if not update_cols:
            conflict_sql = "DO NOTHING"
        else:
            conflict_sql = f"DO UPDATE SET {update_cols}"
    else:
        conflict_sql = "DO NOTHING"

    insert_cols = business_cols + ["tech_request_id", "tech_batch_id"]
    insert_cols_sql = ",".join(f'"{c}"' for c in insert_cols)
    select_cols_sql = ",".join(f'q."{c}"' for c in business_cols)

    pre_hook_sql, user_select_sql = split_sql_hooks(user_sql, where_cond_source)

    try:
        with conn.cursor() as c:

            if pre_hook_sql:
                c.execute(pre_hook_sql)

            if staging_table:
                if target_delta_column not in business_cols:
                    raise ValueError("Target delta column should be included in Columns")
                c.execute(f"""
                    CREATE TEMP TABLE IF NOT EXISTS {staging_table}
                    ON COMMIT PRESERVE ROWS AS
                    SELECT {insert_cols_sql} FROM {target_table} WITH NO DATA
                """)

            sql = f"""
                INSERT INTO {staging_table or target_table} ({insert_cols_sql})
                SELECT
                    {select_cols_sql},
                    %s::timestamptz AS tech_request_id,
                    %s::int AS tech_batch_id
                FROM (
                    {user_select_sql}
                ) q
            """

            if staging_table:
                c.execute(sql, (request_id, batch_id))
                delta_col_sql = '"' + target_delta_column.replace('"', '""') + '"'
                c.execute(f"""
                    SELECT count(*), min({delta_col_sql}), max({delta_col_sql})
                    FROM {staging_table}
                    WHERE tech_request_id = %s AND tech_batch_id = %s
                """, (request_id, batch_id))
                rows, delta_min, delta_max = c.fetchone()
                meta_info["watermarks"] = {
                    "column": target_delta_column,
                    "from": delta_min,
                    "to": delta_max,
                    "to_inclusive": True,
                }
                sql = f"""
                    INSERT INTO {target_table} ({insert_cols_sql})
                    SELECT {insert_cols_sql} FROM {staging_table}
                    WHERE tech_request_id = %s AND tech_batch_id = %s
                """

            if use_on_conflict and clean_keys:
                sql += f" ON CONFLICT ({conflict_cols}) {conflict_sql}"

            c.execute(sql, (request_id, batch_id))
            if staging_table:
                # Do not count rows skipped by ON CONFLICT DO NOTHING.
                rows = c.rowcount

        conn.commit()

        if not staging_table:
            with conn.cursor() as c:
                c.execute(f"SELECT count(*) FROM {target_table} {where_cond_target}")
                rows = c.fetchone()[0]

        add_journal_dual(conn, journal_table, main_journal_conn, main_journal_table,
                         mode, meta_info, source_table_in_jurnal, target_table,
                         start_at, now(), "success", None, request_id, batch_id, rows, None)

    except Exception as e:
        conn.rollback()
        add_journal_dual(conn, journal_table, main_journal_conn, main_journal_table,
                         mode, meta_info, source_table_in_jurnal, target_table,
                         start_at, now(), "fail", None, request_id, batch_id, 0, str(e))
        raise
