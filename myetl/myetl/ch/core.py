import json, io
from datetime import datetime

def ensure_journal_table(client, journal_table):
    client.command(f"""
        CREATE TABLE IF NOT EXISTS {journal_table}
        (
            etl_type String,
            add_info String,
            source String,
            target String,
            start_at DateTime64(3),
            end_at DateTime64(3),
            status String,
            source_request_id DateTime,
            request_id DateTime,
            batch_id UInt32,
            rows_count UInt64,
            text_error String
        )
        ENGINE = MergeTree
        ORDER BY (target, status, request_id, batch_id, start_at)
    """)

# def ensure_target_table(client, table, ddl_core, engine_opts):
#     engine = engine_opts.get('engine', 'MergeTree()')
#     order_by = engine_opts.get('order_by', '(id)')
#     partition_by = engine_opts.get('partition_by')

#     ddl = f"""
#     CREATE TABLE IF NOT EXISTS {table}
#     (
#         {ddl_core.strip().rstrip(',')},
#         tech_request_id DateTime,
#         tech_batch_id UInt32
#     )
#     ENGINE = {engine}
#     ORDER BY {order_by}
#     """
#     if partition_by:
#         ddl += f"\n    PARTITION BY {partition_by}"
#     client.command(ddl)
    
def add_journal(client, **kwargs):
    if isinstance(kwargs.get('add_info'), dict):
        kwargs['add_info'] = json.dumps(kwargs['add_info'])

    col_order = [
        'etl_type', 'add_info', 'source', 'target', 'start_at', 'end_at',
        'status', 'source_request_id', 'request_id', 'batch_id', 'rows_count', 'text_error'
    ]
    row = [kwargs.get(col) for col in col_order]

    client.insert(table=kwargs['journal_table'], data=[row], column_names=col_order)

def clear_ch_table(trg_ch_client, table_name):
    try:
        trg_ch_client.command(f"TRUNCATE TABLE {table_name}")
    except Exception as e:
        print(f"Error truncating table {table_name}: {e}")

# def get_columns_text_pg(conn, table_full, columns_excl):
#     schema, table = table_full.split(".")
#     with conn.cursor() as c:
#         c.execute("""
#             select column_name from information_schema.columns
#             where table_schema = %s and table_name = %s
#             order by ordinal_position
#         """, (schema, table))
#         return [col for (col,) in c.fetchall() if col not in columns_excl]

# def bronze_delta_copy(src_conn, trg_ch_client, source_table, target_table,
#     columns, batches, request_id, now, journal_table, mode):
#     cols_str = ", ".join(f'"{c}"' for c in columns)
#     ch_columns = list(columns) + ['tech_request_id', 'tech_batch_id']

#     for b_idx, batch_cond in enumerate(batches, 1):
#         print(request_id, " batch: ", b_idx, " batch_cond: ", batch_cond)
#         start_at = now().replace(tzinfo=None)
#         rows_count = 0
#         status = "success"
#         error_msg = ""

#         try:
#             with io.BytesIO() as buf:
#                 copy_sql = f"""
#                     COPY (
#                         SELECT
#                             {cols_str}, '{request_id}'::timestamp AS tech_request_id,
#                             {b_idx}::int AS tech_batch_id
#                         FROM {source_table} WHERE {batch_cond}
#                     ) TO STDOUT WITH (FORMAT TEXT, NULL '\\N')
#                 """
#                 #WITH (FORMAT CSV, DELIMITER E'\t', NULL '\\N')
#                 with src_conn.cursor() as c:
#                     c.copy_expert(copy_sql, buf)

#                 if buf.tell() > 0:
#                     buf.seek(0)
#                     trg_ch_client.raw_insert(table=target_table, column_names=ch_columns, 
#                                             insert_block=buf, fmt='TSV')
                    
#                     # Получаем точное кол-во вставленных строк
#                     res = trg_ch_client.query(
#                         f"SELECT count() FROM {target_table} WHERE tech_request_id = %s AND tech_batch_id = %s",
#                         parameters=(request_id, b_idx)
#                     )
#                     rows_count = res.result_rows[0][0]
#         except Exception as e:
#             status = "fail"
#             error_msg = str(e)

#         add_journal(
#             client=trg_ch_client,
#             journal_table=journal_table,
#             etl_type=mode,
#             add_info={"batch": batch_cond},
#             source=source_table,
#             target=target_table,
#             start_at=start_at,
#             end_at=now().replace(tzinfo=None),
#             status=status,
#             source_request_id=datetime(1971, 1, 1),
#             request_id=request_id,
#             batch_id=b_idx,
#             rows_count=rows_count,
#             text_error=error_msg
#         )
#         if status == "fail": raise # Останавливаем ETL при ошибке

# def run_bronze_load(mode, src_conn, trg_conn, source_table, target_table, journal_table,
#     columns=None, columns_excl=None, batches=None, timezone="UTC"):

#     columns_excl = list(set((columns_excl or []) + ["tech_request_id", "tech_batch_id"]))
#     tz = pytz.timezone(timezone)
#     now = lambda: datetime.now(tz)
#     request_id = datetime.now(tz).replace(tzinfo=None)
#     # --- AUTO-COLUMNS ---
#     if not columns:
#         columns = get_columns_text_pg(src_conn, source_table, columns_excl)

#     ensure_journal_table(trg_conn, journal_table)

#     if mode == "delta" or mode == "full":
#         batches = batches or ["1=1"]

#         return bronze_delta_copy(src_conn=src_conn, trg_ch_client=trg_conn, 
#                                  source_table=source_table, target_table=target_table, 
#                                  columns=columns, batches=batches, request_id=request_id, 
#                                  now=now, journal_table=journal_table, mode=mode)

def bronze_to_ch(client, source_table, target_table, buf, columns, 
                 batch_id, cond, request_id, start_at, journal_table, now):
    """ПРИЕМНИК: Твой рабочий метод raw_insert с поддержкой дельты."""
    if not buf: return

    # ClickHouse ожидает список имен колонок (основные + технические)
    ch_columns = list(columns) + ["tech_request_id", "tech_batch_id"]
    
    try:
        # 1. Загрузка данных (твой оригинальный быстрый метод)
        client.raw_insert(
            table=target_table, 
            column_names=ch_columns, 
            insert_block=buf, 
            fmt='TSV'
        )
        
        # 2. Точный подсчет вставленных строк через запрос к таблице
        # Используем f-строку для фильтрации по тех-полям
        res = client.query(
            f"SELECT count() FROM {target_table} WHERE tech_request_id = '{request_id}' AND tech_batch_id = {batch_id}"
        )
        rows_count = res.result_rows[0][0]
        
        # 3. Твой ЭТАЛОННЫЙ add_journal
        # Передаем cond в "batch", чтобы дельта работала
        add_journal(
            client=client,
            journal_table=journal_table,
            etl_type="delta",
            add_info={"batch": cond},
            source=source_table,
            target=target_table,
            start_at=start_at.replace(tzinfo=None),
            end_at=now().replace(tzinfo=None),
            status="success",
            source_request_id=datetime(1971, 1, 1),
            request_id=request_id,
            batch_id=batch_id,
            rows_count=rows_count,
            text_error=""
        )

    except Exception as e:
        # Логируем ошибку
        add_journal(
            client=client,
            journal_table=journal_table,
            etl_type="delta",
            add_info={"batch": cond},
            source=source_table,
            target=target_table,
            start_at=start_at.replace(tzinfo=None),
            end_at=now().replace(tzinfo=None),
            status="fail",
            source_request_id=datetime(1971, 1, 1),
            request_id=request_id,
            batch_id=batch_id,
            rows_count=0,
            text_error=str(e)
        )
        raise

def bronze_from_ch(ch_client, trg_conn, source_table, target_table, columns, 
                   batch_id, batch_cond, request_id, start_at, journal_table, now):
    """ДОНОР: Извлекает батч из ClickHouse через raw_query."""
    cols_str = ",".join(columns) 
    buf = io.BytesIO()
    
    try:
        # Формируем запрос
        # ВАЖНО: FORMAT TabSeparated должен быть в конце
        query = f"""
            SELECT 
                {cols_str}, 
                '{request_id}' AS tech_request_id, 
                {batch_id} AS tech_batch_id
            FROM {source_table}
            WHERE {batch_cond}
            FORMAT TabSeparated
        """
        
        # Используем raw_query — он возвращает именно BYTES
        raw_data = ch_client.raw_query(query)
        
        if raw_data:
            buf.write(raw_data)
            buf.seek(0)
            return buf
        add_journal(trg_conn, journal_table, "delta", {"batch": batch_cond}, source_table, target_table,
                    start_at, end_at, "success", None, request_id, batch_id, 0, "No data found")
        return None

    except Exception as e:
        end_at = now()
        # Логируем ошибку в Postgres
        add_journal(trg_conn, journal_table, "delta", {"batch": batch_cond}, source_table, target_table,
                    start_at, end_at, "fail", None, request_id, batch_id, 0, str(e))
        raise