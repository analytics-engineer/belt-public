"""Table introspection and validated table creation."""
import re
from contextlib import closing
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import sql
from fastapi import HTTPException
from pydantic import BaseModel, Field

from backend.operations_clickhouse import get_clickhouse_client


class InspectTableRequest(BaseModel):
    catalog_name: Optional[str] = None
    schema_name: Optional[str] = None
    table_name: str = Field(min_length=1)


def postgres_connection_params(config):
    keys = ("host", "port", "dbname", "database", "user", "password",
            "sslmode", "connect_timeout")
    params = {k: config[k] for k in keys if config.get(k) not in (None, "")}
    database = params.pop("database", None)
    if "dbname" not in params and database:
        params["dbname"] = database
    return params


def _result(engine, catalog, schema, table, table_type):
    return dict(connection_type=engine, catalog_name=catalog, schema_name=schema,
                table_name=table, table_type=table_type, columns=[],
                keys=dict(primary=[], unique=[], foreign=[]), indexes=[],
                partitioning={}, storage={}, native={})


def inspect_postgres(config, request):
    if not request.schema_name:
        raise HTTPException(400, "PostgreSQL requires schema_name")
    with closing(psycopg2.connect(**postgres_connection_params(config))) as conn:
        conn.set_session(readonly=True)
        with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT pg_catalog.current_database() AS name")
            database = cur.fetchone()["name"]
            if request.catalog_name and request.catalog_name != database:
                raise HTTPException(400, "catalog_name does not match the PostgreSQL connection database")
            cur.execute("""
                SELECT c.oid, c.relkind, c.relpersistence, c.reloptions,
                       pg_catalog.obj_description(c.oid, 'pg_class') AS comment,
                       t.spcname AS tablespace
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                LEFT JOIN pg_catalog.pg_tablespace t ON t.oid = c.reltablespace
                WHERE n.nspname = %s AND c.relname = %s
                  AND c.relkind IN ('r', 'p', 'v', 'm')
            """, (request.schema_name, request.table_name))
            table = cur.fetchone()
            if not table:
                raise HTTPException(404, "PostgreSQL object not found")
            oid = table["oid"]
            result = _result("postgres", database, request.schema_name,
                             request.table_name, {"r": "table", "p": "partitioned table",
                                                  "v": "view", "m": "materialized view"}[table["relkind"]])
            cur.execute("""
                SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                       NOT (a.attnotnull OR t.typnotnull) AS nullable,
                       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default,
                       a.attnum AS position,
                       NULLIF(pg_catalog.to_jsonb(a)->>'attgenerated', '') AS generated,
                       NULLIF(pg_catalog.to_jsonb(a)->>'attidentity', '') AS identity,
                       pg_catalog.col_description(a.attrelid, a.attnum) AS comment
                FROM pg_catalog.pg_attribute a
                JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
                LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE a.attrelid = %s AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY a.attnum
            """, (oid,))
            result["columns"] = [dict(row) for row in cur.fetchall()]
            for column in result["columns"]:
                column["generated"] = {"s": "stored", "v": "virtual"}.get(column["generated"])
                column["identity"] = {"a": "always", "d": "by default"}.get(column["identity"])
            cur.execute("""
                SELECT c.conname AS name, c.contype,
                       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition,
                       ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num, pos)
                             JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num
                             ORDER BY k.pos) AS columns,
                       n.nspname AS referenced_schema, r.relname AS referenced_table,
                       ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num, pos)
                             JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num
                             ORDER BY k.pos) AS referenced_columns
                FROM pg_catalog.pg_constraint c
                LEFT JOIN pg_catalog.pg_class r ON r.oid = c.confrelid
                LEFT JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
                WHERE c.conrelid = %s AND c.contype IN ('p', 'u', 'f') ORDER BY c.conname
            """, (oid,))
            for row in cur.fetchall():
                key = dict(row)
                kind = key.pop("contype")
                if kind != "f":
                    for field in ("referenced_schema", "referenced_table", "referenced_columns"):
                        key.pop(field)
                result["keys"][{"p": "primary", "u": "unique", "f": "foreign"}[kind]].append(key)
            cur.execute("""
                SELECT c.relname AS name, i.indisunique AS unique, i.indisprimary AS primary,
                       i.indisvalid AS valid, pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
                FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
                WHERE i.indrelid = %s ORDER BY c.relname
            """, (oid,))
            result["indexes"] = [dict(row) for row in cur.fetchall()]
            if table["relkind"] == "p":
                cur.execute("SELECT pg_catalog.pg_get_partkeydef(%s) AS key", (oid,))
                result["partitioning"]["key"] = cur.fetchone()["key"]
                cur.execute("""
                    SELECT n.nspname AS schema_name, c.relname AS table_name,
                           pg_catalog.pg_get_expr(c.relpartbound, c.oid) AS bound
                    FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE i.inhparent = %s ORDER BY n.nspname, c.relname
                """, (oid,))
                result["partitioning"]["partitions"] = [dict(row) for row in cur.fetchall()]
            result["storage"] = {k: table[k] for k in ("tablespace", "relpersistence", "reloptions")}
            result["native"] = {"comment": table["comment"]}
            return result


def inspect_clickhouse(config, request):
    table_name = request.table_name
    qualified_database = None
    if "." in table_name:
        qualified_database, table_name = table_name.split(".", 1)
        if not qualified_database or not table_name:
            raise HTTPException(400, "table_name is expected in database.table format")
    database = (request.schema_name or request.catalog_name or qualified_database
                or config.get("database") or config.get("dbname") or "default")
    if qualified_database and qualified_database != database:
        raise HTTPException(400, "The database in table_name does not match schema_name/catalog_name")
    client = get_clickhouse_client(config)
    try:
        parameters = {"database": database, "table": table_name}

        def query(sql):
            data = client.query(sql, parameters=parameters)
            return [dict(zip(data.column_names, row)) for row in data.result_rows]

        tables = query("""SELECT engine, sorting_key, partition_key, primary_key,
                          sampling_key, create_table_query FROM system.tables
                          WHERE database = {database:String} AND name = {table:String}""")
        if not tables:
            raise HTTPException(404, "ClickHouse object not found")
        table = tables[0]
        result = _result("clickhouse", request.catalog_name, database, table_name,
                         {"View": "view", "MaterializedView": "materialized view"}.get(table["engine"], "table"))
        columns = query("""SELECT name, type, position, default_kind, default_expression,
                           comment, compression_codec FROM system.columns
                           WHERE database = {database:String} AND table = {table:String}
                           ORDER BY position""")
        for column in columns:
            data_type = column.pop("type")
            column.update(data_type=data_type,
                          nullable=data_type.startswith(("Nullable(", "LowCardinality(Nullable(")),
                          default=column["default_expression"] or None,
                          generated=column["default_kind"] if column["default_kind"] in ("ALIAS", "MATERIALIZED") else None,
                          identity=None)
            result["columns"].append(column)
        if table["primary_key"]:
            result["keys"]["primary"] = [{"expression": table["primary_key"]}]
        result["partitioning"] = {"key": table["partition_key"]}
        result["storage"] = {"engine": table["engine"], "order_by": table["sorting_key"],
                             "primary_key": table["primary_key"], "sampling_key": table["sampling_key"]}
        available = query("""SELECT name FROM system.tables
                             WHERE database = 'system' AND name = 'data_skipping_indices'""")
        if available:
            result["indexes"] = query("""SELECT name, type, type_full, expr AS expression, granularity
                FROM system.data_skipping_indices
                WHERE database = {database:String} AND table = {table:String} ORDER BY name""")
        result["native"] = {"create_table_query": table["create_table_query"],
                            "data_skipping_indexes_available": bool(available)}
        return result
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


ADAPTERS = {"postgres": inspect_postgres, "clickhouse": inspect_clickhouse}


def inspect_table(config, request):
    engine = str(config.get("connection_type") or "").strip().lower()
    adapter = ADAPTERS.get(engine)
    if adapter is None:
        raise HTTPException(400, f"Reading structure for connection type '{engine}' is not yet supported")
    if not request.table_name.strip() or "\x00" in request.table_name:
        raise HTTPException(400, "Invalid table_name")
    return adapter(config, request)


# DDL accepts descriptions only. Never interpolate caller-supplied SQL/types.
_CREATE_TYPES = {
    "postgres": {
        "smallint", "integer", "bigint", "real", "double precision", "boolean",
        "text", "varchar", "numeric", "date", "timestamp", "timestamptz",
        "uuid", "json", "jsonb", "bytea",
    },
    "clickhouse": {
        "Int8", "Int16", "Int32", "Int64", "UInt8", "UInt16", "UInt32",
        "UInt64", "Float32", "Float64", "Bool", "String", "Date", "Date32",
        "DateTime", "DateTime64", "UUID", "Decimal",
    },
}


def _validate_create_table(engine, payload):
    errors = []

    def error(path, message):
        errors.append({"loc": ["body", *path], "msg": message, "type": "value_error"})

    def identifier(value, path):
        # Deliberately narrow first-version identifier grammar; no SQL fragments.
        limit = 63 if engine == "postgres" else 255
        if (not isinstance(value, str)
                or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value)
                or len(value.encode("utf-8")) > limit):
            error(path, f"Expected an identifier starting with A-Z/a-z or _, containing only A-Z/a-z, digits and _, up to {limit} bytes")
            return False
        return True

    def integer(value, low, high, path):
        if type(value) is not int or not low <= value <= high:
            error(path, f"Expected an integer between {low} and {high}")
            return False
        return True

    allowed = {"schema_name", "table_name", "columns"}
    allowed |= {"primary_key", "partition_by"} if engine == "postgres" else {"engine", "order_by"}
    for key in payload.keys() - allowed:
        error([key], "Unknown field")
    for key in ("schema_name", "table_name"):
        identifier(payload.get(key), [key])
    schema = payload.get("schema_name")
    if isinstance(schema, str) and (
        (engine == "postgres" and (schema.startswith("pg_") or schema == "information_schema"))
        or (engine == "clickhouse" and schema.lower() in {"system", "information_schema"})
    ):
        error(["schema_name"], "Creating tables in a system schema is not allowed")

    columns = payload.get("columns")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 256:
        error(["columns"], "Expected a list of 1 to 256 columns")
        columns = []
    names, normalized = set(), []
    for index, column in enumerate(columns):
        path = ["columns", index]
        if not isinstance(column, dict):
            error(path, "Expected a column object")
            continue
        name, kind = column.get("name"), column.get("type")
        if identifier(name, [*path, "name"]):
            if name in names:
                error([*path, "name"], "Duplicate column name")
            names.add(name)
        nullable = column.get("nullable", False)
        if type(nullable) is not bool:
            error([*path, "nullable"], "Expected a boolean")
        fields = {"name", "type", "nullable"}
        type_sql = None
        if not isinstance(kind, str) or kind not in _CREATE_TYPES[engine]:
            error([*path, "type"], "Unsupported column type")
        else:
            type_sql = kind
            if kind in {"numeric", "Decimal"}:
                fields |= {"precision", "scale"}
                precision, scale = column.get("precision"), column.get("scale")
                max_precision = 1000 if engine == "postgres" else 76
                valid_precision = integer(precision, 1, max_precision, [*path, "precision"])
                valid_scale = integer(scale, 0, precision if valid_precision else max_precision,
                                      [*path, "scale"])
                if valid_precision and valid_scale:
                    type_sql = f"{kind}({precision}, {scale})"
            elif kind == "varchar":
                fields.add("length")
                length = column.get("length")
                if integer(length, 1, 10485760, [*path, "length"]):
                    type_sql = f"varchar({length})"
            elif kind == "DateTime64":
                fields.add("precision")
                precision = column.get("precision", 3)
                if integer(precision, 0, 9, [*path, "precision"]):
                    type_sql = f"DateTime64({precision})"
        for key in column.keys() - fields:
            error([*path, key], "Field is not supported for this column type")
        normalized.append((name, type_sql, nullable))

    key_field = "primary_key" if engine == "postgres" else "order_by"
    keys = payload.get(key_field, [])
    if not isinstance(keys, list) or len(keys) > 256:
        error([key_field], "Expected a list of at most 256 column names")
        keys = []
    seen = set()
    for index, name in enumerate(keys):
        if not isinstance(name, str) or name not in names:
            error([key_field, index], "Column is not defined in columns")
        elif name in seen:
            error([key_field, index], "Duplicate key column")
        else:
            seen.add(name)
            if any(n == name and nullable is True for n, _, nullable in normalized):
                error([key_field, index], "Key column must have nullable=false")
    partition = None
    if engine == "postgres" and "partition_by" in payload:
        partition = payload["partition_by"]
        if not isinstance(partition, dict):
            error(["partition_by"], "Expected an object with method and columns")
        else:
            for field in partition.keys() - {"method", "columns"}:
                error(["partition_by", field], "Unknown field")
            method = partition.get("method")
            if not isinstance(method, str) or method not in ("RANGE", "LIST", "HASH"):
                error(["partition_by", "method"], "Expected RANGE, LIST or HASH")
            partition_columns = partition.get("columns")
            if not isinstance(partition_columns, list) or not 1 <= len(partition_columns) <= 32:
                error(["partition_by", "columns"], "Expected a list of 1 to 32 column names")
            else:
                if method == "LIST" and len(partition_columns) != 1:
                    error(["partition_by", "columns"], "LIST requires exactly one column")
                partition_seen = set()
                for index, name in enumerate(partition_columns):
                    path = ["partition_by", "columns", index]
                    if not isinstance(name, str) or name not in names:
                        error(path, "Column is not defined in columns")
                    elif name in partition_seen:
                        error(path, "Duplicate partition column")
                    else:
                        partition_seen.add(name)
                        if any(n == name and kind == "json" for n, kind, _ in normalized):
                            error(path, "json cannot be used as a partition key")
                        if keys and name not in keys:
                            error(["primary_key"], "Primary key must include all partition columns")
    if engine == "clickhouse" and payload.get("engine", "MergeTree") != "MergeTree":
        error(["engine"], "Only MergeTree is supported")
    if errors:
        raise HTTPException(422, detail=errors)
    return payload["schema_name"], payload["table_name"], normalized, keys, partition


def _create_postgres(config, schema, table, columns, keys, partition=None):
    definitions = [
        sql.SQL("{} {}{}").format(sql.Identifier(name), sql.SQL(kind),
                                 sql.SQL("" if nullable else " NOT NULL"))
        for name, kind, nullable in columns
    ]
    if keys:
        definitions.append(sql.SQL("PRIMARY KEY ({})").format(
            sql.SQL(", ").join(map(sql.Identifier, keys))))
    statement = sql.SQL("CREATE TABLE {}.{} ({})").format(
        sql.Identifier(schema), sql.Identifier(table), sql.SQL(", ").join(definitions))
    if partition is not None:
        statement += sql.SQL(" PARTITION BY {} ({})").format(
            sql.SQL(partition["method"]),
            sql.SQL(", ").join(map(sql.Identifier, partition["columns"])))
    params = postgres_connection_params(config)
    params["connect_timeout"] = 10
    try:
        with closing(psycopg2.connect(**params)) as conn:
            with conn, conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = '30s'")
                cur.execute("SET LOCAL lock_timeout = '5s'")
                cur.execute(statement)
    except psycopg2.errors.DuplicateTable:
        raise HTTPException(409, "Table already exists") from None


def _create_clickhouse(config, schema, table, columns, keys, partition=None):
    # All identifiers have passed the restricted grammar above.
    definitions = []
    for name, kind, nullable in columns:
        type_sql = f"Nullable({kind})" if nullable else kind
        definitions.append(f"`{name}` {type_sql}")
    order = "(" + ", ".join(f"`{name}`" for name in keys) + ")" if keys else "tuple()"
    statement = (f"CREATE TABLE `{schema}`.`{table}` ({', '.join(definitions)}) "
                 f"ENGINE = MergeTree ORDER BY {order}")
    client = get_clickhouse_client(config)
    try:
        client.command(statement, settings={"max_execution_time": 30, "lock_acquire_timeout": 5},
                       transport_settings={"timeout": 35})
    except Exception as exc:
        # Match the server's leading error code, never arbitrary query text.
        if re.search(
            r"(?:^|server response: |received ClickHouse error )Code: 57\."
            r"|^Received ClickHouse exception, code: 57,", str(exc)
        ):
            raise HTTPException(409, "Table already exists") from None
        raise
    finally:
        client.close()


CREATE_ADAPTERS = {"postgres": _create_postgres, "clickhouse": _create_clickhouse}


def create_table(config, payload):
    engine = str(config.get("connection_type") or "").strip().lower()
    adapter = CREATE_ADAPTERS.get(engine)
    if adapter is None:
        raise HTTPException(422, detail=[{
            "loc": ["path", "conn_id"], "type": "value_error",
            "msg": "Table creation is supported only for PostgreSQL and ClickHouse",
        }])
    schema, table, columns, keys, partition = _validate_create_table(engine, payload)
    try:
        adapter(config, schema, table, columns, keys, partition)
    except HTTPException:
        raise
    except Exception:
        # Driver messages may contain credentials. Do not expose or log them.
        raise HTTPException(502, "Failed to create table in the target database") from None
    return {"status": "created", "schema_name": schema, "table_name": table}
