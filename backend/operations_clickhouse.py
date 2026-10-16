import clickhouse_connect


def get_clickhouse_client(conn_config: dict):
    secret = conn_config.get("secret") or {}

    return clickhouse_connect.get_client(
        host=conn_config.get("host", "localhost"),
        port=int(conn_config.get("port") or 8123),
        username=conn_config.get("username") or conn_config.get("user") or "default",
        password=secret.get("password") or conn_config.get("password") or "",
        database=conn_config.get("database") or conn_config.get("dbname") or "default",
        secure=str(conn_config.get("secure", "false")).lower() == "true",
        connect_timeout=10,
    )

def test_clickhouse_connection(config: dict):
    client = get_clickhouse_client(config)

    try:
        result = client.query("SELECT 1")
        value = result.result_rows[0][0]

        if value != 1:
            raise ValueError("ClickHouse SELECT 1 вернул неожиданный результат")

        return {"status": "ok", "message": "ClickHouse connection OK"}

    finally:
        client.close()

def ch_quote_ident(name: str):
    return "`" + str(name).replace("`", "") + "`"


def ch_quote_table(target: str):
    parts = [p.strip() for p in str(target).split(".") if p.strip()]
    if len(parts) != 2:
        raise ValueError(f"ClickHouse target должен быть в формате database.table, получено: {target}")

    database_name, table_name = parts
    return f"{ch_quote_ident(database_name)}.{ch_quote_ident(table_name)}"


def ch_quote_string(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def ch_datetime_value(value):
    return f"parseDateTime64BestEffort({ch_quote_string(value)}, 6, 'UTC')"


def build_clickhouse_delete_conditions(row: dict):
    conditions = [
        f"tech_request_id = {ch_datetime_value(row['request_id'])}",
        f"tech_batch_id = {int(row['batch_id'])}",
    ]

    add_info = row.get("add_info") or {}
    watermarks = add_info.get("watermarks") or {}

    column = watermarks.get("column")
    value_from = watermarks.get("from")
    value_to = watermarks.get("to")

    if column and value_from and value_to:
        column_name = str(column).replace("`", "").replace('"', "").strip()

        conditions.append(
            "("
            f"{ch_quote_ident(column_name)} >= {ch_datetime_value(value_from)} "
            f"AND {ch_quote_ident(column_name)} < {ch_datetime_value(value_to)}"
            ")"
        )

    return conditions


def delete_selected_from_clickhouse(ch_client, target: str, journal_rows):
    target_sql = ch_quote_table(target)

    for row in journal_rows:
        conditions = build_clickhouse_delete_conditions(row)

        delete_sql = f"""
            DELETE FROM {target_sql}
            WHERE {' AND '.join(conditions)}
        """

        ch_client.command(delete_sql)

    return len(journal_rows)


def truncate_clickhouse_target(ch_client, target: str):
    target_sql = ch_quote_table(target)
    ch_client.command(f"TRUNCATE TABLE {target_sql}")