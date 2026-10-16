from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBearer
from psycopg2.extras import RealDictCursor, Json
from psycopg2 import sql
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from croniter import croniter
from dotenv import load_dotenv
import os, sys, subprocess, pytz, psycopg2, json
from time import monotonic
from pathlib import Path

from urllib3 import request
from worker.tasks import run_flow_task
from worker.chain_compiler import start_chain_canvas

from backend.operations_clickhouse import (
    get_clickhouse_client,
    delete_selected_from_clickhouse,
    truncate_clickhouse_target,
    test_clickhouse_connection,
)
from backend.secret_crypto import decrypt_secret, encrypt_secret_value

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
ENV_PATH = PROJECT_ROOT / ".env"

from backend.routers.python_workspace import router as python_workspace_router

load_dotenv(ENV_PATH)

from backend.auth import (
    authenticate_request,
    require_reader,
    require_analyst,
    require_developer,
    require_deploy,
    verifier,
    get_token_identity,
    find_app_user_id,
    get_or_create_app_user_id,
)

from backend.routers.transfer_packages import router as transfer_packages_router

if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

from myetl.parser.meta_db import load_connection_config
from backend.table_metadata import InspectTableRequest, inspect_table, postgres_connection_params, create_table

print("PROJECT_ROOT =", PROJECT_ROOT)
print("ENV_PATH =", ENV_PATH)
print("ENV EXISTS =", ENV_PATH.exists())
print("ROUTE_SCRIPT_PATH =", os.getenv("ROUTE_SCRIPT_PATH"))


API_DOCS_ENABLED = os.getenv("BELT_API_DOCS_ENABLED", "false").strip().lower() == "true"

app = FastAPI(
    # Expose token input in Swagger; middleware still verifies tokens and roles.
    dependencies=[Depends(HTTPBearer(auto_error=False))],
    docs_url="/docs" if API_DOCS_ENABLED else None,
    openapi_url="/openapi.json" if API_DOCS_ENABLED else None,
    redoc_url=None,
    swagger_ui_oauth2_redirect_url="/docs/oauth2-redirect" if API_DOCS_ENABLED else None,
)
app.state.PROJECT_ROOT = PROJECT_ROOT

PUBLIC_DOCS_PATHS = (
    {app.docs_url, app.openapi_url, app.swagger_ui_oauth2_redirect_url}
    if API_DOCS_ENABLED else set()
)


@app.middleware("http")
async def oidc_authentication_middleware(request: Request, call_next):
    # Uvicorn includes root_path in the request path when running behind nginx.
    path = request.scope["path"]
    root_path = request.scope.get("root_path", "").rstrip("/")
    if root_path and path.startswith(root_path + "/"):
        path = path[len(root_path):]
    if request.method == "OPTIONS" or path == "/health":
        return await call_next(request)
    if request.method in {"GET", "HEAD"} and path in PUBLIC_DOCS_PATHS:
        return await call_next(request)

    try:
        authenticate_request(request)
    except HTTPException as exc:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )

    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    python_workspace_router,
    dependencies=[Depends(require_developer)],
)

app.include_router(transfer_packages_router)

DSN = (
    f"dbname={os.getenv('META_DB_NAME')} "
    f"user={os.getenv('META_DB_USER')} "
    f"password={os.getenv('META_DB_PASSWORD')} "
    f"port={os.getenv('META_DB_PORT')} "
    f"host={os.getenv('META_DB_HOST')}"
)

PYTHON_EXECUTABLE = os.getenv("PYTHON_EXECUTABLE")
ROUTE_SCRIPT_PATH = os.getenv("ROUTE_SCRIPT_PATH")
JOURNAL_TABLE = os.getenv("JOURNAL_TABLE", "public.journal_table")
SQL_PREVIEW_MAX_ROWS = 200

def get_limit_offset_and_filters(request: Request, default_limit: int = 100, max_limit: int = 1000):
    params_dict = dict(request.query_params)
    limit_raw = params_dict.pop("limit", default_limit)
    offset_raw = params_dict.pop("offset", 0)

    params_dict.pop("_ts", None)
    params_dict.pop("filters", None)
    params_dict.pop("with_count", None)

    try:
        limit = int(limit_raw)
    except Exception:
        limit = default_limit

    try:
        offset = int(offset_raw)
    except Exception:
        offset = 0

    limit = max(1, min(limit, max_limit))
    offset = max(0, offset)

    return params_dict, limit, offset

def need_total_count(request: Request):
    value = str(request.query_params.get("with_count", "0")).lower()
    return value in ("1", "true", "yes")


def table_identifier(table_name: str):
    parts = [p.strip() for p in table_name.split(".") if p.strip()]
    if len(parts) == 1:
        return sql.Identifier(parts[0])
    if len(parts) == 2:
        return sql.Identifier(parts[0], parts[1])
    raise HTTPException(status_code=400, detail="Некорректное имя таблицы")

def parse_grid_filters(request: Request):
    raw_filters = request.query_params.get("filters")

    if not raw_filters:
        return {}

    try:
        parsed = json.loads(raw_filters)
    except Exception:
        raise HTTPException(status_code=400, detail="Некорректный filters JSON")

    if not isinstance(parsed, dict):
        return {}

    return parsed


def build_one_grid_filter(column_name: str, model: dict):
    if not isinstance(model, dict):
        return None, []

    if model.get("operator") and model.get("condition1") and model.get("condition2"):
        left_sql, left_values = build_one_grid_filter(column_name, model["condition1"])
        right_sql, right_values = build_one_grid_filter(column_name, model["condition2"])

        if not left_sql or not right_sql:
            return None, []

        operator = sql.SQL(" OR ") if model.get("operator") == "OR" else sql.SQL(" AND ")

        return (
            sql.SQL("(") + left_sql + operator + right_sql + sql.SQL(")"),
            left_values + right_values
        )

    filter_type = model.get("filterType")
    filter_operator = model.get("type", "contains")

    value = model.get("filter")
    value_to = model.get("filterTo")

    if value is None:
        value = model.get("dateFrom")

    if value_to is None:
        value_to = model.get("dateTo")

    column_sql = sql.Identifier(column_name)

    if filter_operator == "blank":
        return (
            sql.SQL("({} IS NULL OR {}::text = '')").format(column_sql, column_sql),
            []
        )

    if filter_operator == "notBlank":
        return (
            sql.SQL("({} IS NOT NULL AND {}::text <> '')").format(column_sql, column_sql),
            []
        )

    if value is None:
        return None, []

    if filter_type == "date":
        if filter_operator == "equals":
            return (
                sql.SQL("{} >= %s::timestamptz AND {} < (%s::timestamptz + interval '1 day')").format(column_sql, column_sql),
                [value, value]
            )

        if filter_operator == "notEqual":
            return (
                sql.SQL("NOT ({} >= %s::timestamptz AND {} < (%s::timestamptz + interval '1 day'))").format(column_sql, column_sql),
                [value, value]
            )

        if filter_operator == "greaterThan":
            return sql.SQL("{} > %s::timestamptz").format(column_sql), [value]

        if filter_operator == "lessThan":
            return sql.SQL("{} < %s::timestamptz").format(column_sql), [value]

        if filter_operator == "inRange" and value_to is not None:
            return (
                sql.SQL("{} >= %s::timestamptz AND {} <= %s::timestamptz").format(column_sql, column_sql),
                [value, value_to]
            )

    if filter_operator == "equals":
        return sql.SQL("{}::text = %s").format(column_sql), [str(value)]

    if filter_operator == "notEqual":
        return sql.SQL("{}::text <> %s").format(column_sql), [str(value)]

    if filter_operator == "contains":
        return sql.SQL("{}::text ILIKE %s").format(column_sql), [f"%{value}%"]

    if filter_operator == "notContains":
        return sql.SQL("{}::text NOT ILIKE %s").format(column_sql), [f"%{value}%"]

    if filter_operator == "startsWith":
        return sql.SQL("{}::text ILIKE %s").format(column_sql), [f"{value}%"]

    if filter_operator == "endsWith":
        return sql.SQL("{}::text ILIKE %s").format(column_sql), [f"%{value}"]

    if filter_operator == "greaterThan":
        return sql.SQL("{} > %s").format(column_sql), [value]

    if filter_operator == "lessThan":
        return sql.SQL("{} < %s").format(column_sql), [value]

    if filter_operator == "greaterThanOrEqual":
        return sql.SQL("{} >= %s").format(column_sql), [value]

    if filter_operator == "lessThanOrEqual":
        return sql.SQL("{} <= %s").format(column_sql), [value]

    if filter_operator == "inRange" and value_to is not None:
        return (
            sql.SQL("{} >= %s AND {} <= %s").format(column_sql, column_sql),
            [value, value_to]
        )

    return sql.SQL("{}::text ILIKE %s").format(column_sql), [f"%{value}%"]


def build_where_sql(params_dict: dict, grid_filters: dict, allowed_filter_columns=None):
    conditions = []
    values = []

    for key, value in params_dict.items():
        conditions.append(
            sql.SQL("{}::text = %s").format(sql.Identifier(key))
        )
        values.append(value)

    for column_name, model in (grid_filters or {}).items():
        if allowed_filter_columns is not None and column_name not in allowed_filter_columns:
            continue

        condition_sql, condition_values = build_one_grid_filter(column_name, model)

        if condition_sql:
            conditions.append(condition_sql)
            values.extend(condition_values)

    if not conditions:
        return sql.SQL(""), []

    return sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions), values


class Flow(BaseModel):
    name: str
    data: dict

@app.get("/flows", dependencies=[Depends(require_reader)])
def list_flows():
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT id, name FROM flows order by name asc")
                return cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.get("/flows/{flow_id}", dependencies=[Depends(require_reader)])
def get_flow(flow_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT id, name, data FROM flows WHERE id = %s", (flow_id,))
                result = cur.fetchone()
                if not result:
                    raise HTTPException(status_code=404, detail="Flow not found")
                return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

@app.post("/flows", dependencies=[Depends(require_developer)],)
def create_flow(flow: Flow, request: Request):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                app_user_id = get_or_create_app_user_id(request, cur)
                cur.execute(
                    "INSERT INTO flows (name, data, updated_by) VALUES (%s, %s,%s) RETURNING id",
                    (flow.name, Json(flow.data), app_user_id)
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {"id": new_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Insert error: {str(e)}")

@app.get("/connections", dependencies=[Depends(require_reader)])
def list_connections():
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT id, name, config, connection_type FROM connections")
                return cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connections error: {str(e)}")

class ConnectionCreate(BaseModel):
    name: str
    connection_type: str
    config: dict

@app.post("/connections", dependencies=[Depends(require_developer)],)
def create_connection(conn_data: ConnectionCreate, request: Request):
    try:
        raw_config = dict(conn_data.config)
        secret = raw_config.pop("secret", {})
        encrypted_secret = {
            key: encrypt_secret_value(value)
            for key, value in secret.items()
        }

        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                app_user_id = get_or_create_app_user_id(request, cur)
                cur.execute(
                    "INSERT INTO connections (name, config, secret, connection_type, updated_by) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (conn_data.name, Json(raw_config), Json(encrypted_secret), conn_data.connection_type, app_user_id)
                )
                new_id = cur.fetchone()[0]
                conn.commit()
                return {"id": new_id}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.put("/flows/{flow_id}", dependencies=[Depends(require_developer)],)
def update_flow(flow_id: int, flow: Flow, request: Request):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                app_user_id = get_or_create_app_user_id(request, cur)
                cur.execute(
                    "UPDATE flows SET name = %s, data = %s, updated_by = %s WHERE id = %s",
                    (flow.name, Json(flow.data), app_user_id, flow_id)
                )
                conn.commit()
                return {"status": "updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/flows/{flow_id}", dependencies=[Depends(require_developer)],)
def delete_flow(flow_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM flows WHERE id = %s", (flow_id,))
                conn.commit()
                return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Получение данных одного соединения для редактирования
@app.get("/connections/{conn_id}", dependencies=[Depends(require_reader)])
def get_connection(conn_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, name, config, secret, connection_type FROM connections WHERE id = %s",
                    (conn_id,)
                )
                result = cur.fetchone()

                if not result:
                    raise HTTPException(status_code=404, detail="Connection not found")

                config = result["config"] or {}
                secret = result["secret"] or {}

                config["secret"] = {k: "***" for k in secret.keys()}

                return {
                    "id": result["id"],
                    "name": result["name"],
                    "connection_type": result["connection_type"],
                    "config": config
                }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Универсальное удаление соединения
@app.delete("/connections/{conn_id}", dependencies=[Depends(require_developer)],)
def delete_connection(conn_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM connections WHERE id = %s", (conn_id,))
                conn.commit()
                return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/connections/{conn_id}", dependencies=[Depends(require_analyst)],)
def update_connection(conn_id: int, conn_data: ConnectionCreate, request: Request):
    try:
        raw_config = dict(conn_data.config)
        incoming_secret = raw_config.pop("secret", {})

        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                app_user_id = get_or_create_app_user_id(request, cur)
                cur.execute(
                    "SELECT secret FROM connections WHERE id = %s",
                    (conn_id,)
                )
                old_row = cur.fetchone()

                if not old_row:
                    raise HTTPException(status_code=404, detail="Connection not found")

                old_secret = old_row[0] or {}
                merged_secret = dict(old_secret)
                secret_changed = False

                for k, v in incoming_secret.items():
                    if v not in ("***", "", None):
                        merged_secret[k] = encrypt_secret_value(v)
                        secret_changed = True

                if secret_changed:
                    cur.execute(
                        "UPDATE connections SET name = %s, config = %s, secret = %s, connection_type = %s, updated_by = %s WHERE id = %s",
                        (conn_data.name, Json(raw_config), Json(merged_secret), conn_data.connection_type, app_user_id, conn_id)
                    )
                else:
                    cur.execute(
                        "UPDATE connections SET name = %s, config = %s, connection_type = %s, updated_by = %s WHERE id = %s",
                        (conn_data.name, Json(raw_config), conn_data.connection_type, app_user_id, conn_id)
                    )

                conn.commit()
                return {"status": "updated"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
#TEST CONNECTIONS-------------------------
class ConnectionTestPayload(BaseModel):
    connection_id: Optional[int] = None
    connection_type: str
    config: dict


class TransformationSqlPreviewPayload(BaseModel):
    connection_id: int
    connection_type: str
    sql: str


def split_preview_sql(user_sql: str):
    pre_hook_start = "-- @pre_hook_start"
    pre_hook_end = "-- @pre_hook_end"
    has_start = pre_hook_start in user_sql
    has_end = pre_hook_end in user_sql

    if has_start != has_end:
        raise ValueError("Нужно указать оба маркера pre-hook")

    if not has_start:
        return None, user_sql.strip()

    before_raw, rest = user_sql.split(pre_hook_start, 1)
    raw_part, after_raw = rest.split(pre_hook_end, 1)
    select_sql = (before_raw + after_raw).strip()

    if not select_sql:
        raise ValueError("После pre-hook должен остаться SQL-запрос")

    return raw_part.strip(), select_sql


@app.post("/transformation/preview-sql", dependencies=[Depends(require_developer)])
def preview_transformation_sql(payload: TransformationSqlPreviewPayload):
    if payload.connection_type != "postgres":
        raise HTTPException(
            status_code=400,
            detail="SQL preview с pre-hook поддерживается только для PostgreSQL"
        )

    user_sql = (payload.sql or "").strip()
    if not user_sql:
        raise HTTPException(status_code=400, detail="SQL-запрос пуст")

    try:
        pre_hook_sql, select_sql = split_preview_sql(user_sql)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        with psycopg2.connect(DSN) as main_conn:
            with main_conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT config, secret FROM connections WHERE id = %s", (payload.connection_id,))
                connection = cur.fetchone()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        config = connection["config"] or {}
        secret = decrypt_secret(connection["secret"] or {})
        db_name = config.get("dbname") or config.get("database")
        db_user = config.get("user") or config.get("username")
        db_host = config.get("host", "localhost")
        db_port = config.get("port", 5432)
        db_pass = secret.get("password") or config.get("password")

        with psycopg2.connect(
            dbname=db_name,
            user=db_user,
            password=db_pass,
            host=db_host,
            port=db_port,
            connect_timeout=10,
        ) as remote_conn:
            with remote_conn.cursor(cursor_factory=RealDictCursor) as cur:
                preview_deadline = monotonic() + 60
                cur.execute("SET LOCAL statement_timeout = %s", (60000,))

                if pre_hook_sql:
                    cur.execute(pre_hook_sql)

                remaining_ms = max(1, int((preview_deadline - monotonic()) * 1000))
                cur.execute("SET LOCAL statement_timeout = %s", (remaining_ms,))
                preview_select_sql = select_sql.rstrip().rstrip(";").strip() + "\n"
                cur.execute(
                    "SELECT * FROM ({}) AS sql_preview LIMIT %s".format(preview_select_sql),
                    (SQL_PREVIEW_MAX_ROWS,)
                )
                rows = cur.fetchall()
                columns = [column.name for column in cur.description or []]

            remote_conn.rollback()

        return {"rows": rows, "columns": columns}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Ошибка выполнения SQL preview: {exc}")

def test_postgres_connection(config: dict):
    secret = config.get("secret") or {}

    db_name = config.get("dbname") or config.get("database")
    db_user = config.get("user") or config.get("username")
    db_host = config.get("host", "localhost")
    db_port = config.get("port", 5432)
    db_pass = secret.get("password") or config.get("password")

    if not db_name:
        raise HTTPException(status_code=400, detail="Не указан dbname/database")

    if not db_user:
        raise HTTPException(status_code=400, detail="Не указан user/username")

    try:
        with psycopg2.connect(
            dbname=db_name,
            user=db_user,
            password=db_pass,
            host=db_host,
            port=db_port,
            connect_timeout=5
        ) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()

        return {"status": "ok", "message": "Connection OK"}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Postgres connection error: {str(e)}")

def merge_secret_for_test(connection_id: Optional[int], config: dict):
    if not connection_id:
        return config

    config = dict(config)
    incoming_secret = config.get("secret") or {}

    with psycopg2.connect(DSN) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT secret FROM connections WHERE id = %s",
                (connection_id,)
            )
            row = cur.fetchone()

    old_secret = decrypt_secret(row["secret"] if row else {})
    merged_secret = dict(old_secret or {})

    for k, v in incoming_secret.items():
        if v not in ("***", "", None):
            merged_secret[k] = v

    config["secret"] = merged_secret
    return config

@app.post("/connections/test", dependencies=[Depends(require_analyst)])
def test_connection(payload: ConnectionTestPayload):
    config = merge_secret_for_test(payload.connection_id, payload.config)
    #conn_type = config.get("type")
    conn_type = payload.connection_type

    if not conn_type:
        raise HTTPException(status_code=400, detail="Не указан type подключения")
    if conn_type == "postgres":
        return test_postgres_connection(config)
    elif conn_type == "clickhouse":
        return test_clickhouse_connection(config)

    raise HTTPException(
        status_code=400,
        detail=f"Тест подключения для типа '{conn_type}' пока не поддержан"
    )

def run_worker(object_type: str, object_id: int):
    try:
        result = subprocess.run(
            [
                PYTHON_EXECUTABLE,
                ROUTE_SCRIPT_PATH,
                object_type,
                str(object_id),
            ],
            capture_output=True,
            text=True
        )

        if result.returncode != 0:
            print(f"Ошибка в воркере для {object_type} {object_id}:")
            print(result.stderr)
            print(result.stdout)
        else:
            print(f"{object_type} {object_id} успешно завершен:")
            print(result.stdout)

    except Exception as e:
        print(f"Критическая ошибка запуска воркера: {e}")

def check_chain_not_running(chain_id: int):
    with psycopg2.connect(DSN) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                select id, status, started_at
                from public.chain_run
                where chain_id = %s
                order by id desc
                limit 1
            """, (chain_id,))

            row = cur.fetchone()

    if row and row["status"] == "running":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Chain {chain_id} is already running. "
                f"Last chain_run_id={row['id']}, started_at={row['started_at']}"
            )
        )

@app.post("/run-object", dependencies=[Depends(require_analyst)],)
async def start_object(payload: dict, request: Request):
    object_type = payload.get("object_type")
    object_id = payload.get("object_id")

    if object_type not in ("flow", "chain"):
        raise HTTPException(
            status_code=400,
            detail="object_type должен быть 'flow' или 'chain'"
        )

    if object_id is None:
        raise HTTPException(
            status_code=400,
            detail="object_id не передан"
        )

    object_id = int(object_id)
    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            app_user_id = get_or_create_app_user_id(request, cur)

    if object_type == "flow":
        task = run_flow_task.apply_async(
            kwargs={
                "flow_id": object_id,
                "started_by": app_user_id
            }
        )

        return {
            "status": "started",
            "type": "flow",
            "id": object_id,
            "celery_task_id": task.id,
            "message": "Flow запущен через Celery"
        }

    if object_type == "chain":
        check_chain_not_running(object_id)

        try:
            started = start_chain_canvas(object_id, started_by=app_user_id)
        except RuntimeError as e:
            detail = str(e)
            status_code = 400 if detail.startswith("E002") else 503

            raise HTTPException(
                status_code=status_code,
                detail=detail
            )

        return {
            "status": "started",
            "type": "chain",
            "id": object_id,
            "chain_run_id": started["chain_run_id"],
            "celery_result_id": started["celery_result_id"],
            "message": "Chain запущен через Celery"
        }

@app.get("/get_remote_data/{conn_id}/{table_name}", dependencies=[Depends(require_reader)])
def get_remote_data(conn_id: int, table_name: str, request: Request):
    params_dict, limit, offset = get_limit_offset_and_filters(request)

    try:
        with psycopg2.connect(DSN) as main_conn:
            with main_conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT config, secret FROM connections WHERE id = %s", (conn_id,))
                result = cur.fetchone()

                if not result:
                    raise HTTPException(status_code=404, detail="Connection not found")

                config = result["config"]
                secret = decrypt_secret(result.get("secret") or {})

        db_name = config.get("dbname") or config.get("database")
        db_user = config.get("user") or config.get("username")
        db_host = config.get("host", "localhost")
        db_port = config.get("port", 5432)
        db_pass = secret.get("password") or config.get("password")

        if not db_name:
            raise HTTPException(status_code=500, detail="Ключ 'dbname' или 'database' не найден в конфиге")

        remote_dsn = f"host={db_host} dbname={db_name} user={db_user} password={db_pass} port={db_port}"

        table_sql = table_identifier(table_name)

        grid_filters = parse_grid_filters(request)
        where_sql, values = build_where_sql(params_dict, grid_filters)

        count_query = sql.SQL("SELECT count(*) AS total FROM {}{}").format(
            table_sql,
            where_sql
        )

        data_query = sql.SQL("SELECT * FROM {}{} ORDER BY {} DESC LIMIT %s OFFSET %s").format(
            table_sql,
            where_sql,
            sql.Identifier("id")
        )

        with psycopg2.connect(remote_dsn) as remote_conn:
            with remote_conn.cursor(cursor_factory=RealDictCursor) as cur:
                total = None
                if need_total_count(request):
                    cur.execute(count_query, values)
                    total = cur.fetchone()["total"]
                cur.execute(data_query, values + [limit, offset])
                rows = cur.fetchall()

                return {
                    "rows": rows,
                    "total": total
                }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка подключения: {str(e)}")

@app.get("/process-chains", dependencies=[Depends(require_reader)])
def list_process_chains():
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT id, name FROM process_chains ORDER BY id")
                return cur.fetchall()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Process chains error: {str(e)}")

@app.get("/process-chains/{chain_id}", dependencies=[Depends(require_reader)])
def get_process_chain(chain_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, name, data FROM process_chains WHERE id = %s",
                    (chain_id,)
                )
                result = cur.fetchone()

                if not result:
                    raise HTTPException(status_code=404, detail="Process chain not found")

                return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/process-chains", dependencies=[Depends(require_developer)],)
def create_process_chain(payload: dict, request: Request):
    name = payload.get("name")
    data = payload.get("data")

    if not name:
        raise HTTPException(status_code=400, detail="name не передан")

    if data is None:
        raise HTTPException(status_code=400, detail="data не передан")

    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                app_user_id = get_or_create_app_user_id(request, cur)
                cur.execute(
                    """
                    INSERT INTO public.process_chains (name, data, version, updated_by)
                    VALUES (%s, %s, 1, %s)
                    RETURNING id, version
                    """,
                    (name, Json(data), app_user_id)
                )

                new_id, version = cur.fetchone()

                cur.execute(
                    """
                    INSERT INTO public.process_chain_history (
                        chain_id,
                        version,
                        data,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (new_id, version, Json(data), None)
                )

                conn.commit()

                return {
                    "id": new_id,
                    "version": version
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Insert process chain error: {str(e)}")


@app.put("/process-chains/{chain_id}", dependencies=[Depends(require_developer)],)
def update_process_chain(chain_id: int, payload: dict, request: Request):
    data = payload.get("data")

    if data is None:
        raise HTTPException(status_code=400, detail="data не передан")

    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT data, version
                    FROM public.process_chains
                    WHERE id = %s
                    FOR UPDATE
                    """,
                    (chain_id,)
                )

                row = cur.fetchone()

                if not row:
                    raise HTTPException(status_code=404, detail="Process chain not found")

                old_data = row["data"] or {}
                old_version = row["version"] or 1

                if old_data == data:
                    return {
                        "status": "not_changed",
                        "version": old_version
                    }
                
                app_user_id = get_or_create_app_user_id(request, cur)
                new_version = old_version + 1

                cur.execute(
                    """
                    UPDATE public.process_chains
                    SET data = %s, version = %s, updated_by = %s
                    WHERE id = %s
                    """,
                    (Json(data), new_version, app_user_id, chain_id)
                )

                cur.execute(
                    """
                    INSERT INTO public.process_chain_history (
                        chain_id,
                        version,
                        data,
                        created_by
                    )
                    VALUES (%s, %s, %s, %s)
                    """,
                    (chain_id, new_version, Json(data), None)
                )

                conn.commit()

                return {
                    "status": "updated",
                    "version": new_version
                }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/process-chains/{chain_id}", dependencies=[Depends(require_developer)],)
def delete_process_chain(chain_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM process_chains WHERE id = %s", (chain_id,))
                conn.commit()
                return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ChainSchedulePayload(BaseModel):
    cron_expr: str
    timezone: Optional[str] = "Europe/Moscow"


def calc_next_run_at(cron_expr: str, timezone_str: str):
    if not croniter.is_valid(cron_expr):
        raise HTTPException(status_code=400, detail="Некорректное cron выражение")

    try:
        tz = pytz.timezone(timezone_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Некорректный timezone")

    now = datetime.now(tz)
    return croniter(cron_expr, now).get_next(datetime)

@app.get("/process-chain-schedules/{chain_id}", dependencies=[Depends(require_reader)])
def get_process_chain_schedule(chain_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT id, chain_id, cron_expr, timezone, enabled, next_run_at
                    FROM public.process_chain_schedules
                    WHERE chain_id = %s
                """, (chain_id,))

                row = cur.fetchone()

                if not row:
                    return {
                        "configured": False,
                        "chain_id": chain_id,
                        "cron_expr": "",
                        "timezone": "Europe/Moscow",
                        "enabled": False,
                        "next_run_at": None
                    }

                row["configured"] = True
                return row

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/process-chain-schedules/{chain_id}", dependencies=[Depends(require_analyst)],)
def save_process_chain_schedule(chain_id: int, payload: ChainSchedulePayload, request: Request):
    next_run_at = calc_next_run_at(payload.cron_expr, payload.timezone)

    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                app_user_id = get_or_create_app_user_id(request, cur)
                cur.execute("""
                    INSERT INTO public.process_chain_schedules
                        (chain_id, cron_expr, timezone, enabled, next_run_at, updated_by)
                    VALUES
                        (%s, %s, %s, false, %s, %s)
                    ON CONFLICT (chain_id)
                    DO UPDATE SET
                        cron_expr = EXCLUDED.cron_expr,
                        timezone = EXCLUDED.timezone,
                        next_run_at = EXCLUDED.next_run_at,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = now()
                    RETURNING id, chain_id, cron_expr, timezone, enabled, next_run_at
                """, (
                    chain_id,
                    payload.cron_expr,
                    payload.timezone,
                    next_run_at,
                    app_user_id
                ))

                row = cur.fetchone()
                conn.commit()
                row["configured"] = True
                return row

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/process-chain-schedules/{chain_id}/enable", dependencies=[Depends(require_analyst)],)
def enable_process_chain_schedule(chain_id: int, request: Request):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT cron_expr, timezone
                    FROM public.process_chain_schedules
                    WHERE chain_id = %s
                """, (chain_id,))

                schedule = cur.fetchone()

                if not schedule:
                    raise HTTPException(status_code=404, detail="Cron schedule не настроен")
                
                app_user_id = get_or_create_app_user_id(request, cur)

                next_run_at = calc_next_run_at(
                    schedule["cron_expr"],
                    schedule["timezone"]
                )

                cur.execute("""
                    UPDATE public.process_chain_schedules
                    SET enabled = true,
                        next_run_at = %s,  updated_at = now(), updated_by = %s
                    WHERE chain_id = %s
                    RETURNING id, chain_id, cron_expr, timezone, enabled, next_run_at
                """, (next_run_at, app_user_id, chain_id))

                row = cur.fetchone()
                conn.commit()
                row["configured"] = True
                return row

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/process-chain-schedules/{chain_id}/pause", dependencies=[Depends(require_analyst)],)
def pause_process_chain_schedule(chain_id: int, request: Request):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                app_user_id = get_or_create_app_user_id(request, cur)
                cur.execute("""
                    UPDATE public.process_chain_schedules
                    SET enabled = false,
                        updated_at = now(),
                        updated_by = %s
                    WHERE chain_id = %s
                    RETURNING id, chain_id, cron_expr, timezone, enabled, next_run_at
                """, (app_user_id, chain_id,))

                row = cur.fetchone()

                if not row:
                    raise HTTPException(status_code=404, detail="Cron schedule не настроен")

                conn.commit()
                row["configured"] = True
                return row

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/user-settings")
def get_user_settings(request: Request):
    issuer, subject = get_token_identity(request)

    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                user_id = find_app_user_id(cur, issuer, subject)

                if user_id is None:
                    return {
                        "user_id": None,
                        "display_name": "",
                        "theme_code": "dark",
                        "locale_code": "en"
                    }

                cur.execute("""
                    select display_name, theme_code, locale_code
                    from public.user_settings
                    where user_id = %s
                """, (user_id,))

                row = cur.fetchone()

                if not row:
                    return {
                        "user_id": user_id,
                        "display_name": "",
                        "theme_code": "dark",
                        "locale_code": "en"
                    }

                return {
                    "user_id": user_id,
                    "display_name": row[0] or "",
                    "theme_code": row[1] or "dark",
                    "locale_code": row[2] or "en"
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Get user settings error: {str(e)}")


@app.post("/api/user-settings")
def save_user_settings(payload: dict, request: Request):
    issuer, subject = get_token_identity(request)

    display_name = payload.get("display_name")
    theme_code = payload.get("theme_code", "dark")
    locale_code = payload.get("locale_code", "en")

    if locale_code not in ("en", "ru"):
        raise HTTPException(
            status_code=400,
            detail="locale_code должен быть 'en' или 'ru'"
        )

    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor() as cur:
                user_id = get_or_create_app_user_id(request, cur)

                cur.execute("""
                    insert into public.user_settings (
                        user_id,
                        display_name,
                        theme_code,
                        locale_code,
                        updated_at
                    )
                    values (%s, %s, %s, %s, now())
                    on conflict (user_id)
                    do update set
                        display_name = excluded.display_name,
                        theme_code = excluded.theme_code,
                        locale_code = excluded.locale_code,
                        updated_at = now()
                """, (user_id, display_name, theme_code, locale_code))

                conn.commit()
                return {"status": "ok"}

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Save user settings error: {str(e)}"
        )


# @app.get("/get_chain_matrix2/{conn_id}/{chain_id}", dependencies=[Depends(require_reader)])
# def get_chain_matrix2(conn_id: int, chain_id: int):
#     try:
#         # 1. Берем JSON цепочки и config подключения из meta-БД
#         with psycopg2.connect(DSN) as main_conn:
#             with main_conn.cursor(cursor_factory=RealDictCursor) as cur:
#                 cur.execute(
#                     "select data from process_chains where id = %s",
#                     (chain_id,)
#                 )
#                 chain = cur.fetchone()

#                 if not chain:
#                     raise HTTPException(status_code=404, detail="Process chain not found")

#                 chain_data = chain["data"]

#                 cur.execute(
#                     "select config, secret from connections where id = %s",
#                     (conn_id,)
#                 )
#                 conn_row = cur.fetchone()

#                 if not conn_row:
#                     raise HTTPException(status_code=404, detail="Connection not found")

#                 config = conn_row["config"]
#                 secret = decrypt_secret(conn_row.get("secret") or {})

#         # 2. Вытаскиваем flow_id из nodes цепочки
#         nodes = chain_data.get("nodes", [])

#         flow_ids = []
#         for node in nodes:
#             node_data = node.get("data", {})
#             if node_data.get("step_type") == "flow":
#                 flow_id = node_data.get("flow_id")
#                 if flow_id is not None:
#                     flow_ids.append(int(flow_id))

#         if not flow_ids:
#             return []

#         # 3. Подключаемся к целевой БД
#         db_name = config.get("dbname") or config.get("database")
#         db_user = config.get("user") or config.get("username")
#         db_host = config.get("host", "localhost")
#         db_port = config.get("port", 5432)
#         db_pass = secret.get("password") or config.get("password")

#         if not db_name:
#             raise HTTPException(status_code=500, detail="Ключ 'dbname' или 'database' не найден в конфиге")

#         remote_dsn = (
#             f"host={db_host} "
#             f"dbname={db_name} "
#             f"user={db_user} "
#             f"password={db_pass} "
#             f"port={db_port}"
#         )

#         # 4. Читаем журнал по всей цепочке, без ограничения chain_run_id
#         with psycopg2.connect(remote_dsn) as remote_conn:
#             with remote_conn.cursor(cursor_factory=RealDictCursor) as cur:
#                 cur.execute("""
#                     select
#                         chain_run_id,
#                         request_id,
#                         batch_id,
#                         flow_id,
#                         status
#                     from journal_table
#                     where chain_id = %s
#                       and flow_id = any(%s)
#                     order by chain_run_id desc, request_id, batch_id, flow_id
#                 """, (chain_id, flow_ids))

#                 journal_rows = cur.fetchall()

#         # 5. Собираем матрицу
#         matrix = {}

#         for row in journal_rows:
#             key = (
#                 row["chain_run_id"],
#                 row["request_id"],
#                 row["batch_id"]
#             )

#             if key not in matrix:
#                 matrix[key] = {
#                     "chain_run_id": row["chain_run_id"],
#                     "request_id": row["request_id"],
#                     "batch_id": row["batch_id"]
#                 }

#                 for flow_id in flow_ids:
#                     matrix[key][f"flow_{flow_id}"] = None

#             matrix[key][f"flow_{row['flow_id']}"] = row["status"]

#         return list(matrix.values())

#     except Exception as e:
#         raise HTTPException(
#             status_code=500,
#             detail=f"Get chain matrix error: {str(e)}"
#         )

@app.get("/get_metadata_data/{table_name}", dependencies=[Depends(require_reader)])
def get_metadata_data(table_name: str, request: Request):
    params_dict, limit, offset = get_limit_offset_and_filters(request)

    allowed_sources = {
        "journal_table": {
            "source_sql": sql.SQL("""
                SELECT *
                FROM public.journal_table
            """),
            "order_by": sql.SQL("id DESC"),
        },
        "monitor_chains": {
            "source_sql": sql.SQL("""
                SELECT *
                FROM public.monitor_chains
            """),
            "order_by": sql.SQL("id DESC"),
        },
        "journal_chain_flow": {
            "source_sql": sql.SQL("""
                SELECT *
                FROM public.journal_chain_flow
            """),
            "order_by": sql.SQL("id DESC, flow_id"),
        },
        "journal_flow_nodes": {
            "source_sql": sql.SQL("""
                SELECT *
                FROM public.journal_flow_nodes
            """),
            "order_by": sql.SQL("id DESC, flow_id"),
        },
        "monitor_chain_runs": {
            "source_sql": sql.SQL("""
                SELECT cr.id, cr.chain_id, cr.status, cr.started_at, cr.finished_at,
                EXTRACT(EPOCH FROM (COALESCE(cr.finished_at, now()) - cr.started_at))::bigint AS duration,
                cr.error_text, cr.stdout, cr.stderr
                FROM public.monitor_chain_runs cr
            """),
            "order_by": sql.SQL("id DESC"),
        },
        "monitor_flow_runs": {
            "source_sql": sql.SQL("""
                SELECT fr.id, fr.chain_run_id, fr.chain_id, fr.flow_id, fr.status, fr.started_at, fr.finished_at,
                EXTRACT(EPOCH FROM (COALESCE(fr.finished_at, now()) - fr.started_at))::bigint AS duration,
                fr.error_text, fr.stdout, fr.stderr
                FROM flow_run fr
            """),
            "order_by": sql.SQL("id ASC"),
        },
    }

    if table_name not in allowed_sources:
        raise HTTPException(
            status_code=400,
            detail="Недопустимая metadata table"
        )

    try:
        source = allowed_sources[table_name]
        source_sql = source["source_sql"]
        order_by_sql = source.get("order_by", sql.SQL("1"))

        grid_filters = parse_grid_filters(request)
        where_sql, values = build_where_sql(params_dict, grid_filters)

        count_query = sql.SQL("""
            SELECT count(*) AS total
            FROM ({source_sql}) AS src
            {where_sql}
        """).format(
            source_sql=source_sql,
            where_sql=where_sql
        )

        data_query = sql.SQL("""
            SELECT *
            FROM ({source_sql}) AS src
            {where_sql}
            ORDER BY {order_by_sql}
            LIMIT %s OFFSET %s
        """).format(
            source_sql=source_sql,
            where_sql=where_sql,
            order_by_sql=order_by_sql
        )

        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                total = None

                if need_total_count(request):
                    cur.execute(count_query, values)
                    total = cur.fetchone()["total"]

                cur.execute(data_query, values + [limit, offset])
                rows = cur.fetchall()

                return {
                    "rows": rows,
                    "total": total
                }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Metadata data error: {str(e)}"
        )

@app.get("/monitor/flow-runs", dependencies=[Depends(require_reader)])
def get_monitor_flow_runs(request: Request):
    _, limit, offset = get_limit_offset_and_filters(request)

    try:
        grid_filters = parse_grid_filters(request)

        allowed_filter_columns = {
            "flow_run_id",
            "chain_run_id",
            "chain_id",
            "flow_id",
            "flow_name",
            "status",
            "started_at",
            "finished_at",
            "duration",
            "error_text",
        }

        filter_where_sql, filter_values = build_where_sql(
            {},
            grid_filters,
            allowed_filter_columns
        )

        base_query = sql.SQL("""
            from (
                select
                    fr.id as flow_run_id,
                    fr.chain_run_id,
                    fr.chain_id,
                    fr.flow_id,
                    fr.status,
                    fr.started_at,
                    fr.finished_at,
                    EXTRACT(
                        EPOCH FROM (COALESCE(fr.finished_at, now()) - fr.started_at)
                    )::bigint AS duration,
                    fr.error_text,
                    fr.stdout,
                    fr.stderr
                from public.flow_run fr
            ) x
        """)

        count_query = (
            sql.SQL("select count(*) as total ")
            + base_query
            + filter_where_sql
        )

        data_query = (
            sql.SQL("select * ")
            + base_query
            + filter_where_sql
            + sql.SQL(" order by flow_run_id desc limit %s offset %s")
        )

        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                total = None

                if need_total_count(request):
                    cur.execute(count_query, filter_values)
                    total = cur.fetchone()["total"]

                cur.execute(data_query, filter_values + [limit, offset])
                rows = cur.fetchall()

                return {
                    "rows": rows,
                    "total": total
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Monitor flow runs error: {str(e)}")

@app.get("/monitor/flow-run-batches", dependencies=[Depends(require_reader)])
def get_monitor_flow_run_batches(flow_run_id: int, request: Request):
    _, limit, offset = get_limit_offset_and_filters(request)

    try:
        grid_filters = parse_grid_filters(request)

        allowed_filter_columns = {
            "id",
            "flow_run_id",
            "chain_id",
            "flow_id",
            "chain_run_id",
            "etl_type",
            "flow_type",
            "source",
            "target",
            "status",
            "request_id",
            "batch_id",
            "rows_count",
            "text_error",
        }

        filter_where_sql, filter_values = build_where_sql(
            {},
            grid_filters,
            allowed_filter_columns
        )

        base_query = sql.SQL("""
            from (
                select
                    id,
                    flow_run_id,
                    chain_id,
                    flow_id,
                    chain_run_id,
                    etl_type,
                    flow_type,
                    source,
                    target,
                    start_at,
                    end_at,
                    status,
                    request_id,
                    batch_id,
                    rows_count,
                    text_error,
                    add_info
                from {}
                where flow_run_id = %s
            ) x
        """).format(sql.SQL(JOURNAL_TABLE))

        base_values = [flow_run_id]

        count_query = (
            sql.SQL("select count(*) as total ")
            + base_query
            + filter_where_sql
        )

        data_query = (
            sql.SQL("select * ")
            + base_query
            + filter_where_sql
            + sql.SQL(" order by batch_id, id limit %s offset %s")
        )

        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                total = None

                if need_total_count(request):
                    cur.execute(count_query, base_values + filter_values)
                    total = cur.fetchone()["total"]

                cur.execute(data_query, base_values + filter_values + [limit, offset])
                rows = cur.fetchall()

                return {
                    "rows": rows,
                    "total": total
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Monitor flow run batches error: {str(e)}")

@app.get("/operations/connections", dependencies=[Depends(require_reader)])
def get_operations_connections():
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    select distinct
                        j.target_connection_id as id,
                        coalesce(c.name, '') as name,
                        j.target_connection_type as connection_type
                    from {JOURNAL_TABLE} j
                    left join public.connections c
                        on c.id = j.target_connection_id
                    where j.target_connection_id is not null
                    order by j.target_connection_id
                """)
                return cur.fetchall()

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Operations connections error: {str(e)}")
    
@app.get("/operations/objects", dependencies=[Depends(require_reader)])
def get_operations_schemas(connection_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    select distinct target
                    from {JOURNAL_TABLE}
                    where target_connection_id = %s
                      and target is not null
                    order by target
                """, (connection_id,))
                return cur.fetchall()

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Operations schemas error: {str(e)}")

@app.get("/operations/requests", dependencies=[Depends(require_reader)])
def get_operations_requests(connection_id: int, target: str, request: Request):
    _, limit, offset = get_limit_offset_and_filters(request)

    try:
        grid_filters = parse_grid_filters(request)

        allowed_filter_columns = {
            "request_id",
            "etl_type",
            "status",
            "batches",
            "rows",
        }

        filter_where_sql, filter_values = build_where_sql(
            {},
            grid_filters,
            allowed_filter_columns
        )

        base_query = sql.SQL("""
            from (
                select
                    request_id,
                    etl_type,
                    status,
                    count(id) as batches,
                    coalesce(sum(rows_count), 0) as rows
                from {}
                where target_connection_id = %s
                  and target = %s
                group by 1, 2, 3
            ) x
        """).format(sql.SQL(JOURNAL_TABLE))

        base_values = [connection_id, target]

        count_query = (
            sql.SQL("select count(*) as total ")
            + base_query
            + filter_where_sql
        )

        data_query = (
            sql.SQL("select * ")
            + base_query
            + filter_where_sql
            + sql.SQL(" order by request_id desc limit %s offset %s")
        )

        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                total = None

                if need_total_count(request):
                    cur.execute(count_query, base_values + filter_values)
                    total = cur.fetchone()["total"]

                cur.execute(data_query, base_values + filter_values + [limit, offset])
                rows = cur.fetchall()

                return {
                    "rows": rows,
                    "total": total
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Operations requests error: {str(e)}")

@app.get("/operations/request_detailed", dependencies=[Depends(require_reader)])
def get_operations_request_detaled(connection_id: int, target: str, request_id: str):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    SELECT  id, chain_id, flow_id, chain_run_id, etl_type, flow_type,  "source", target,  start_at, end_at,
                            status, request_id, batch_id, rows_count, text_error, add_info
                            FROM {JOURNAL_TABLE}
                    where target_connection_id = %s  and target = %s and request_id = %s
                    group by 1,2 order by request_id desc limit 200
                """, (connection_id, target, request_id))
                return cur.fetchall()

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Operations requests error: {str(e)}")

@app.get("/lineage/request", dependencies=[Depends(require_reader)])
def get_lineage_request(connection_id: int, target: str, request_id: str):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    with anchor as (
                        select distinct
                            request_id,
                            chain_run_id
                        from {JOURNAL_TABLE}
                        where target_connection_id = %s
                          and target = %s
                          and request_id >= %s::timestamptz
                          and request_id <  (%s::timestamptz + interval '1 second')
                    ),
                    lineage_rows as (
                        select
                            j.flow_id,
                            j.flow_run_id,
                            j.chain_id,
                            j.chain_run_id,
                            min(j.source) as source,
                            min(j.target) as target,
                            case
                                when count(*) filter (where j.status in ('fail', 'error')) > 0 then 'fail'
                                when count(*) filter (where j.status = 'running') > 0 then 'running'
                                else 'success'
                            end as status,
                            j.request_id::text as request_id,
                            min(j.batch_id) as first_batch_id,
                            max(j.batch_id) as last_batch_id,
                            count(distinct j.batch_id) as batches,
                            coalesce(sum(j.rows_count), 0) as rows_count,
                            min(j.id) as first_journal_id
                        from {JOURNAL_TABLE} j
                        join anchor a
                          on j.request_id = a.request_id
                         and (
                              j.chain_run_id = a.chain_run_id
                              or (j.chain_run_id is null and a.chain_run_id is null)
                         )
                        where j.flow_id is not null
                        group by
                            j.flow_id,
                            j.flow_run_id,
                            j.chain_id,
                            j.chain_run_id,
                            j.request_id
                    )
                    select
                        lr.flow_id,
                        f.name as flow_name,
                        lr.flow_run_id,
                        lr.chain_id,
                        lr.chain_run_id,
                        lr.source,
                        lr.target,
                        lr.status,
                        lr.request_id,
                        lr.first_batch_id,
                        lr.last_batch_id,
                        lr.batches,
                        lr.rows_count,
                        f.data
                    from lineage_rows lr
                    left join public.flows f
                        on f.id = lr.flow_id
                    order by lr.first_journal_id
                """, (
                    connection_id,
                    target,
                    request_id,
                    request_id
                ))

                rows = cur.fetchall()

        return [
            {
                "flow_id": row["flow_id"],
                "flow_name": row["flow_name"],
                "flow_run_id": row["flow_run_id"],
                "chain_id": row["chain_id"],
                "chain_run_id": row["chain_run_id"],
                "source": row["source"],
                "target": row["target"],
                "status": row["status"],
                "request_id": row["request_id"],
                "first_batch_id": row["first_batch_id"],
                "last_batch_id": row["last_batch_id"],
                "batches": row["batches"],
                "rows_count": row["rows_count"],
                "data": row["data"] or {"nodes": [], "edges": []}
            }
            for row in rows
        ]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lineage request error: {str(e)}")

@app.get("/lineage/objects", dependencies=[Depends(require_reader)])
def get_lineage_objects(connection_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    select connection_type, config
                    from public.connections
                    where id = %s
                """, (connection_id,))

                conn_row = cur.fetchone()

                if not conn_row:
                    raise HTTPException(status_code=404, detail="Connection not found")

                conn_type = str(conn_row["connection_type"] or "").strip().lower()
                config = conn_row["config"] or {}

                if conn_type == "postgres":
                    cur.execute("""
                        select distinct
                            (node_data ->> 'schema_name') || '.' ||
                            coalesce(
                                node_data ->> 'target_table',
                                node_data ->> 'table_name'
                            ) as object_name
                        from public.flows f
                        cross join lateral jsonb_array_elements(f.data::jsonb -> 'nodes') as n(node_json)
                        cross join lateral (
                            select n.node_json -> 'data' as node_data
                        ) x
                        where node_data ->> 'connection_id' = %s
                          and node_data ->> 'schema_name' is not null
                          and coalesce(
                                node_data ->> 'target_table',
                                node_data ->> 'table_name'
                              ) is not null
                        order by object_name
                    """, (str(connection_id),))

                    return cur.fetchall()

                if conn_type == "clickhouse":
                    database = config.get("dbname") or config.get("database")

                    if not database:
                        raise HTTPException(
                            status_code=400,
                            detail="Для ClickHouse connection не указан dbname/database"
                        )

                    cur.execute("""
                        select distinct
                            %s || '.' ||
                            coalesce(
                                node_data ->> 'target_table',
                                node_data ->> 'table_name'
                            ) as object_name
                        from public.flows f
                        cross join lateral jsonb_array_elements(f.data::jsonb -> 'nodes') as n(node_json)
                        cross join lateral (
                            select n.node_json -> 'data' as node_data
                        ) x
                        where node_data ->> 'connection_id' = %s
                          and coalesce(
                                node_data ->> 'target_table',
                                node_data ->> 'table_name'
                              ) is not null
                        order by object_name
                    """, (database, str(connection_id)))

                    return cur.fetchall()

                raise HTTPException(
                    status_code=400,
                    detail=f"Lineage objects для типа '{conn_type}' пока не поддержан"
                )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lineage objects error: {str(e)}")

def get_node_table_name(node_data: dict, is_target: bool = False, connection_map: dict = None):
    connection_map = connection_map or {}

    connection_id = node_data.get("connection_id")
    connection_id = str(connection_id) if connection_id is not None else None

    schema_name = node_data.get("schema_name")

    if is_target:
        table_name = node_data.get("target_table") or node_data.get("table_name")
    else:
        table_name = node_data.get("table_name") or node_data.get("target_table")

    if schema_name and table_name:
        return f"{schema_name}.{table_name}"

    conn_info = connection_map.get(connection_id) or {}
    conn_type = str(conn_info.get("connection_type") or "").strip().lower()
    config = conn_info.get("config") or {}

    if conn_type == "clickhouse" and table_name:
        database = config.get("dbname") or config.get("database")

        if database:
            return f"{database}.{table_name}"

    script_path = node_data.get("script_path")
    if script_path:
        return f"python:{script_path}"

    return None

def extract_flow_io(flow_row, connection_map: dict = None):
    connection_map = connection_map or {}

    data = flow_row["data"] or {}
    nodes = data.get("nodes", [])

    source_node = next((n for n in nodes if n.get("type") == "input"), None)
    target_node = next((n for n in nodes if n.get("type") == "output"), None)

    if not source_node or not target_node:
        return None

    source_data = source_node.get("data", {}) or {}
    target_data = target_node.get("data", {}) or {}

    source_object = get_node_table_name(source_data, is_target=False, connection_map=connection_map)
    target_object = get_node_table_name(target_data, is_target=True, connection_map=connection_map)

    if not source_object or not target_object:
        return None

    return {
        "flow_id": flow_row["id"],
        "flow_name": flow_row["name"],
        "flow_type": data.get("flow_type"),
        "source_object": source_object,
        "target_object": target_object,
        "source_connection_id": str(source_data.get("connection_id")) if source_data.get("connection_id") is not None else None,
        "target_connection_id": str(target_data.get("connection_id")) if target_data.get("connection_id") is not None else None,
        "data": data,
    }

@app.get("/lineage/table", dependencies=[Depends(require_reader)])
def get_table_lineage(connection_id: int, object_name: str):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    select id, name, data
                    from public.flows
                    order by id
                """)
                flow_rows = cur.fetchall()

                cur.execute("""
                    select id, connection_type, config
                    from public.connections
                """)
                connection_rows = cur.fetchall()

        connection_map = {
            str(row["id"]): {
                "connection_type": row["connection_type"],
                "config": row["config"] or {}
            }
            for row in connection_rows
        }

        all_flows = []

        for row in flow_rows:
            flow_info = extract_flow_io(row, connection_map=connection_map)
            if flow_info:
                all_flows.append(flow_info)

        result = []
        visited = set()

        def walk_upstream(current_connection_id, current_object):
            matched_flows = [
                f for f in all_flows
                if f["target_connection_id"] == str(current_connection_id)
                and f["target_object"] == current_object
            ]

            for flow in matched_flows:
                key = (
                    flow["flow_id"],
                    flow["source_connection_id"],
                    flow["source_object"],
                    flow["target_connection_id"],
                    flow["target_object"]
                )

                if key in visited:
                    continue

                visited.add(key)

                walk_upstream(
                    flow["source_connection_id"],
                    flow["source_object"]
                )

                result.append(flow)

        walk_upstream(str(connection_id), object_name)

        return [
            {
                "flow_id": flow["flow_id"],
                "flow_name": flow["flow_name"],
                "flow_type": flow["flow_type"],
                "source": flow["source_object"],
                "target": flow["target_object"],
                "source_connection_id": flow["source_connection_id"],
                "target_connection_id": flow["target_connection_id"],
                "status": "metadata",
                "data": flow["data"] or {"nodes": [], "edges": []}
            }
            for flow in result
        ]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Table lineage error: {str(e)}")

class DeleteRequestsPayload(BaseModel):
    connection_id: int
    target: str
    request_ids: List[str]

class DeleteAllPayload(BaseModel):
    connection_id: int
    target: str

def split_target_name(target: str):
    parts = target.split(".")

    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise HTTPException(status_code=400, detail="target должен быть в формате schema.table")

    return parts[0], parts[1]

def target_table_exists(target_conn, target: str):
    schema_name, table_name = split_target_name(target)

    with target_conn.cursor() as cur:
        cur.execute("""
            select exists (
                select 1
                from information_schema.tables
                where table_schema = %s
                  and table_name = %s
            )
        """, (schema_name, table_name))

        return cur.fetchone()[0]

def get_target_pg_params(connection_id: int):
    conn_config = load_connection_config(connection_id)

    if conn_config.get("connection_type") != "postgres":
        raise HTTPException(status_code=400, detail="Удаление пока поддержано только для postgres target")

    return postgres_connection_params(conn_config)

def get_top_request_ids(cur, connection_id: int, target: str, limit_count: int):
    cur.execute(f"""
        select request_id
        from {JOURNAL_TABLE}
        where target_connection_id = %s
          and target = %s
          and request_id is not null
        group by request_id
        order by request_id desc
        limit %s
    """, (connection_id, target, limit_count))

    return [row["request_id"] for row in cur.fetchall()]

def validate_top_requests(cur, connection_id: int, target: str, request_ids: List[str]):
    selected_ids = list(dict.fromkeys([str(x) for x in request_ids if x is not None]))

    if not selected_ids:
        raise HTTPException(status_code=400, detail="Не выбраны request_ids")

    cur.execute(f"""
        with selected as (
            select distinct unnest(%s::timestamptz[]) as request_id
        ),
        top_req as (
            select request_id
            from {JOURNAL_TABLE}
            where target_connection_id = %s
              and target = %s
              and request_id is not null
            group by request_id
            order by request_id desc
            limit (select count(*) from selected)
        ),
        diff as (
            select request_id from selected
            except
            select request_id from top_req

            union all

            select request_id from top_req
            except
            select request_id from selected
        )
        select
            (select count(*) from diff) as diff_count,
            (select array_agg(request_id::text order by request_id desc) from selected) as selected_ids,
            (select array_agg(request_id::text order by request_id desc) from top_req) as top_ids
    """, (selected_ids, connection_id, target))

    row = cur.fetchone()

    if row["diff_count"] != 0:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Можно удалять только самый верхний реквест или несколько верхних подряд",
                "selected_ids": row["selected_ids"],
                "top_ids": row["top_ids"],
            }
        )

    return selected_ids

def get_journal_rows_for_delete(cur, connection_id: int, target: str, request_ids: List[str]):
    cur.execute(f"""
        select
            id,
            request_id::text as request_id,
            batch_id,
            add_info
        from {JOURNAL_TABLE}
        where target_connection_id = %s
          and target = %s
          and request_id = any(%s::timestamptz[])
        order by request_id desc, batch_id desc, id desc
    """, (connection_id, target, request_ids))

    rows = cur.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="Реквесты не найдены в журнале")

    return rows

def build_watermark_conditions(add_info: dict):
    watermarks = (add_info or {}).get("watermarks") or {}

    conditions = []

    # вариант 1: один диапазон
    if watermarks.get("column") and watermarks.get("from") and watermarks.get("to"):
        conditions.append({
            "column": watermarks["column"],
            "from": watermarks["from"],
            "to": watermarks["to"],
        })

    # вариант 2: несколько диапазонов, если позже положишь массив в JSON
    for item in watermarks.get("items") or []:
        if item.get("column") and item.get("from") and item.get("to"):
            conditions.append({
                "column": item["column"],
                "from": item["from"],
                "to": item["to"],
            })

    return conditions

def delete_selected_from_target(target_conn, target: str, journal_rows):
    schema_name, table_name = split_target_name(target)
    deleted_rows = 0

    with target_conn.cursor() as cur:
        for row in journal_rows:
            delete_sql = sql.SQL("""
                delete from {}.{}
                where tech_request_id = %s::timestamptz
                and tech_batch_id = %s
            """).format(
                sql.Identifier(schema_name),
                sql.Identifier(table_name)
            )

            params = [
                row["request_id"],
                row["batch_id"],
            ]

            for condition in build_watermark_conditions(row.get("add_info") or {}):
                col_name = str(condition["column"]).replace('"', '').strip()

                delete_sql += sql.SQL("""
                  and (
                    ({} >= %s and {} < %s)
                    or {} is null
                    )
                """).format(
                    sql.Identifier(col_name),
                    sql.Identifier(col_name),
                    sql.Identifier(col_name)
                )

                params.extend([
                    condition["from"],
                    condition["to"],
                ])

            cur.execute(delete_sql, params)
            deleted_rows += cur.rowcount

    return deleted_rows

def delete_selected_from_journal(meta_conn, journal_ids: List[int]):
    with meta_conn.cursor() as cur:
        cur.execute(f"""
            delete from {JOURNAL_TABLE}
            where id = any(%s)
        """, (journal_ids,))

        return cur.rowcount

@app.post("/operations/delete-requests", dependencies=[Depends(require_analyst)],)
def delete_operations_requests(payload: DeleteRequestsPayload):
    conn_config = load_connection_config(payload.connection_id)
    conn_type = str(conn_config.get("connection_type") or "").strip().lower()

    meta_conn = None
    target_conn = None

    try:
        meta_conn = psycopg2.connect(DSN)
        meta_conn.autocommit = False

        with meta_conn.cursor(cursor_factory=RealDictCursor) as cur:
            request_ids = validate_top_requests(
                cur=cur,
                connection_id=payload.connection_id,
                target=payload.target,
                request_ids=payload.request_ids
            )

            journal_rows = get_journal_rows_for_delete(
                cur=cur,
                connection_id=payload.connection_id,
                target=payload.target,
                request_ids=request_ids
            )

        journal_ids = [row["id"] for row in journal_rows]

        if conn_type == "postgres":
            target_params = get_target_pg_params(payload.connection_id)
            target_conn = psycopg2.connect(**target_params)
            target_conn.autocommit = False

            target_exists = target_table_exists(target_conn, payload.target)

            if target_exists:
                target_deleted = delete_selected_from_target(
                    target_conn=target_conn,
                    target=payload.target,
                    journal_rows=journal_rows
                )
                target_status = "deleted"
            else:
                target_deleted = 0
                target_status = "target_table_not_found"

        elif conn_type == "clickhouse":
            target_conn = get_clickhouse_client(conn_config)

            target_deleted = delete_selected_from_clickhouse(
                ch_client=target_conn,
                target=payload.target,
                journal_rows=journal_rows
            )
            target_status = "deleted"

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Удаление для типа '{conn_type}' пока не поддержано"
            )

        journal_deleted = delete_selected_from_journal(
            meta_conn=meta_conn,
            journal_ids=journal_ids
        )

        if conn_type == "postgres" and target_conn:
            target_conn.commit()

        meta_conn.commit()

        return {
            "status": "deleted",
            "target_deleted": target_deleted,
            "target_status": target_status,
            "journal_deleted": journal_deleted
        }

    except HTTPException:
        if conn_type == "postgres" and target_conn:
            target_conn.rollback()
        if meta_conn:
            meta_conn.rollback()
        raise

    except Exception as e:
        if conn_type == "postgres" and target_conn:
            target_conn.rollback()
        if meta_conn:
            meta_conn.rollback()
        raise HTTPException(status_code=500, detail=f"Delete requests error: {str(e)}")

    finally:
        if target_conn:
            target_conn.close()
        if meta_conn:
            meta_conn.close()

@app.post("/operations/delete-all", dependencies=[Depends(require_analyst)],)
def delete_operations_all(payload: DeleteAllPayload):
    conn_config = load_connection_config(payload.connection_id)
    conn_type = str(conn_config.get("connection_type") or "").strip().lower()

    meta_conn = None
    target_conn = None

    try:
        meta_conn = psycopg2.connect(DSN)
        meta_conn.autocommit = False

        if conn_type == "postgres":
            schema_name, table_name = split_target_name(payload.target)

            target_params = get_target_pg_params(payload.connection_id)
            target_conn = psycopg2.connect(**target_params)
            target_conn.autocommit = False

            target_exists = target_table_exists(target_conn, payload.target)

            if target_exists:
                with target_conn.cursor() as cur:
                    cur.execute(
                        sql.SQL("truncate table {}.{} restart identity").format(
                            sql.Identifier(schema_name),
                            sql.Identifier(table_name)
                        )
                    )
                target_deleted = "truncated"
                target_status = "truncated"
            else:
                target_deleted = 0
                target_status = "target_table_not_found"

        elif conn_type == "clickhouse":
            target_conn = get_clickhouse_client(conn_config)

            truncate_clickhouse_target(
                ch_client=target_conn,
                target=payload.target
            )

            target_deleted = "truncated"
            target_status = "truncated"

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Удаление для типа '{conn_type}' пока не поддержано"
            )

        with meta_conn.cursor() as cur:
            cur.execute(f"""
                delete from {JOURNAL_TABLE}
                where target_connection_id = %s
                  and target = %s
            """, (
                payload.connection_id,
                payload.target
            ))

            journal_deleted = cur.rowcount

        if conn_type == "postgres" and target_conn:
            target_conn.commit()

        meta_conn.commit()

        return {
            "status": "deleted_all",
            "target_deleted": target_deleted,
            "target_status": target_status,
            "journal_deleted": journal_deleted
        }

    except HTTPException:
        if conn_type == "postgres" and target_conn:
            target_conn.rollback()
        if meta_conn:
            meta_conn.rollback()
        raise

    except Exception as e:
        if conn_type == "postgres" and target_conn:
            target_conn.rollback()
        if meta_conn:
            meta_conn.rollback()
        raise HTTPException(status_code=500, detail=f"Delete all error: {str(e)}")

    finally:
        if target_conn:
            target_conn.close()
        if meta_conn:
            meta_conn.close()

@app.get("/get_chain_matrix/{chain_id}", dependencies=[Depends(require_reader)])
def get_chain_matrix(chain_id: int, request: Request):
    try:
        params_dict, limit, offset = get_limit_offset_and_filters(request)
        grid_filters = parse_grid_filters(request)

        allowed_chain_columns = {
            "chain_run_id",
            "chain_status",
            "started_at",
            "duration_sec",
            "error_text",
        }

        where_parts = []
        where_values = []

        for column_name, model in (grid_filters or {}).items():
            if column_name in allowed_chain_columns:
                condition_sql, condition_values = build_one_grid_filter(column_name, model)
                if condition_sql:
                    where_parts.append(condition_sql)
                    where_values.extend(condition_values)

            elif column_name.startswith("flow_"):
                try:
                    flow_id = int(column_name.replace("flow_", "", 1))
                except Exception:
                    continue

                filter_operator = model.get("type", "contains")
                value = model.get("filter")

                if filter_operator == "blank":
                    where_parts.append(sql.SQL("""
                        not exists (
                            select 1
                            from public.flow_run frf
                            where frf.chain_run_id = x.chain_run_id
                              and frf.flow_id = %s
                              and frf.status is not null
                        )
                    """))
                    where_values.append(flow_id)

                elif filter_operator == "notBlank":
                    where_parts.append(sql.SQL("""
                        exists (
                            select 1
                            from public.flow_run frf
                            where frf.chain_run_id = x.chain_run_id
                              and frf.flow_id = %s
                              and frf.status is not null
                        )
                    """))
                    where_values.append(flow_id)

                elif value is not None:
                    if filter_operator == "equals":
                        where_parts.append(sql.SQL("""
                            exists (
                                select 1
                                from public.flow_run frf
                                where frf.chain_run_id = x.chain_run_id
                                  and frf.flow_id = %s
                                  and frf.status::text = %s
                            )
                        """))
                        where_values.extend([flow_id, str(value)])

                    elif filter_operator == "notEqual":
                        where_parts.append(sql.SQL("""
                            not exists (
                                select 1
                                from public.flow_run frf
                                where frf.chain_run_id = x.chain_run_id
                                  and frf.flow_id = %s
                                  and frf.status::text = %s
                            )
                        """))
                        where_values.extend([flow_id, str(value)])

                    else:
                        where_parts.append(sql.SQL("""
                            exists (
                                select 1
                                from public.flow_run frf
                                where frf.chain_run_id = x.chain_run_id
                                  and frf.flow_id = %s
                                  and frf.status::text ilike %s
                            )
                        """))
                        where_values.extend([flow_id, f"%{value}%"])

        where_sql = sql.SQL("")
        if where_parts:
            where_sql = sql.SQL(" where ") + sql.SQL(" and ").join(where_parts)

        base_query = sql.SQL("""
            from (
                select
                    id as chain_run_id,
                    chain_id,
                    status as chain_status,
                    started_at,
                    extract(epoch from (coalesce(finished_at, now()) - started_at))::int as duration_sec,
                    error_text
                from public.chain_run
                where chain_id = %s
            ) x
        """)

        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    select distinct flow_id
                    from public.flow_run
                    where chain_id = %s
                    order by flow_id
                """, (chain_id,))

                flow_ids = [int(row["flow_id"]) for row in cur.fetchall()]

                total = None

                if need_total_count(request):
                    count_query = (
                        sql.SQL("select count(*) as total ")
                        + base_query
                        + where_sql
                    )
                    cur.execute(count_query, [chain_id] + where_values)
                    total = cur.fetchone()["total"]

                data_query = (
                    sql.SQL("""
                        with page_runs as (
                            select *
                    """)
                    + base_query
                    + where_sql
                    + sql.SQL("""
                            order by chain_run_id desc
                            limit %s offset %s
                        )
                        select
                            cr.chain_run_id,
                            cr.chain_status,
                            cr.started_at,
                            cr.duration_sec,
                            cr.error_text as chain_error_text,
                            fr.flow_id,
                            fr.status as flow_status
                        from page_runs cr
                        left join public.flow_run fr
                            on fr.chain_run_id = cr.chain_run_id
                           and fr.chain_id = cr.chain_id
                        order by cr.chain_run_id desc, fr.flow_id
                    """)
                )

                cur.execute(data_query, [chain_id] + where_values + [limit, offset])
                rows = cur.fetchall()

        matrix = {}

        for row in rows:
            key = row["chain_run_id"]

            if key not in matrix:
                matrix[key] = {
                    "chain_run_id": row["chain_run_id"],
                    "chain_status": row["chain_status"],
                    "started_at": row["started_at"],
                    "duration_sec": row["duration_sec"],
                    "error_text": row["chain_error_text"],
                }

                for flow_id in flow_ids:
                    matrix[key][f"flow_{flow_id}"] = None

            if row["flow_id"] is not None:
                matrix[key][f"flow_{row['flow_id']}"] = row["flow_status"]

        return {
            "rows": list(matrix.values()),
            "total": total
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Get chain matrix error: {str(e)}")

class ChainRunSetStatusPayload(BaseModel):
    status: str
    error_text: Optional[str] = None

@app.post("/chain-runs/{chain_run_id}/set-status", dependencies=[Depends(require_analyst)],)
def set_chain_run_status(chain_run_id: int, payload: ChainRunSetStatusPayload):
    new_status = str(payload.status or "").strip().lower()

    if new_status not in ("success", "error"):
        raise HTTPException(
            status_code=400,
            detail="status должен быть success или error"
        )

    comment = payload.error_text or f"Manually set to {new_status}"

    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    update public.chain_run
                    set status = %s,
                        error_text = %s,
                        updated_at = now()
                    where id = %s
                      and status = 'running'
                """, (new_status, comment, chain_run_id))

                chain_updated = cur.rowcount

                cur.execute("""
                    update public.flow_run
                    set status = %s,
                        error_text = %s,
                        updated_at = now()
                    where chain_run_id = %s
                      and status = 'running'
                """, (new_status, comment, chain_run_id))

                flow_updated = cur.rowcount

                if chain_updated == 0 and flow_updated == 0:
                    raise HTTPException(
                        status_code=409,
                        detail="Нет running chain/flow для изменения"
                    )

                conn.commit()

                return {
                    "status": "ok",
                    "new_status": new_status,
                    "chain_updated": chain_updated,
                    "flow_updated": flow_updated
                }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Set chain run status error: {str(e)}"
        )

@app.get("/timezones")
def get_timezones():
    # Динамический вариант на будущее:
#
# @app.get("/timezones")
# def get_timezones():
#     return sorted(pytz.all_timezones)
    HARDCODED_TIMEZONES =  [
  "UTC",
  "Europe/Moscow",
  "Europe/Malta",
  "Europe/Berlin",
  "Asia/Almaty"
]
    return HARDCODED_TIMEZONES

class ColumnsRequest(BaseModel):
    schema_name: Optional[str] = None
    table_name: Optional[str] = None

def clean_optional_string(value):
    if value in (None, "", "undefined", "null"):
        return None
    return str(value).strip()

def get_postgres_columns(conn_config: dict, schema_name: str, table_name: str):
    if not schema_name:
        raise HTTPException(status_code=400, detail="Для Postgres не указан schema_name")

    if not table_name:
        raise HTTPException(status_code=400, detail="Не указан table_name")

    allowed_keys = [
        "host", "port", "dbname", "database", "user", "password",
        "sslmode", "connect_timeout"
    ]

    params = {
        k: v
        for k, v in conn_config.items()
        if k in allowed_keys and v not in ("", None)
    }

    if "database" in params and "dbname" not in params:
        params["dbname"] = params.pop("database")

    with psycopg2.connect(**params) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                select column_name
                from information_schema.columns
                where table_schema = %s
                  and table_name = %s
                order by ordinal_position
            """, (schema_name, table_name))

            return [row[0] for row in cur.fetchall()]

def get_clickhouse_columns(conn_config: dict, schema_name: str, table_name: str):
    if not table_name:
        raise HTTPException(status_code=400, detail="Не указан table_name")

    database = schema_name or conn_config.get("dbname") or conn_config.get("database")

    if "." in table_name:
        database_part, table_part = table_name.split(".", 1)

        if not schema_name:
            database = database_part

        table_name = table_part

    if not database:
        raise HTTPException(
            status_code=400,
            detail="Для ClickHouse не указан database/schema_name"
        )

    ch_client = get_clickhouse_client(conn_config)

    try:
        result = ch_client.query("""
            select name
            from system.columns
            where database = {database:String}
              and table = {table_name:String}
            order by position
        """, parameters={
            "database": database,
            "table_name": table_name
        })

        rows = result.result_rows

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"No columns found in ClickHouse: database={database}, table={table_name}"
            )

        return [row[0] for row in rows]

    finally:
        close = getattr(ch_client, "close", None)
        if callable(close):
            close()

@app.post(
    "/connections/{conn_id}/create-table",
    status_code=201,
    dependencies=[Depends(require_developer)],
    responses={409: {"description": "Table already exists"},
               422: {"description": "Invalid field: loc, msg, type"},
               502: {"description": "Target database error"}},
)
def create_connection_table(conn_id: int, payload: dict):
    """Create a table from a JSON description; raw SQL is not accepted.

    Required: schema_name, table_name, columns [{name, type, nullable=false}].
    PostgreSQL: optional primary_key (column names).
    Optional partition_by: {"method": "RANGE" | "LIST" | "HASH", "columns": ["name"]}.
    Creates the partitioned parent only; child partitions are created separately.
    ClickHouse: engine=MergeTree, optional order_by (column names).
    numeric/Decimal require precision and scale; varchar requires length.
    """
    try:
        config = load_connection_config(conn_id)
    except ValueError:
        raise HTTPException(404, "Connection not found") from None
    except Exception:
        raise HTTPException(503, "Failed to load connection") from None
    return create_table(config, payload)


@app.post("/connections/{conn_id}/inspect-table", dependencies=[Depends(require_analyst)])
def inspect_connection_table(conn_id: int, payload: InspectTableRequest):
    try:
        conn_config = load_connection_config(conn_id)
        return inspect_table(conn_config, payload)
    except HTTPException:
        raise
    except Exception:
        # Driver errors can include connection secrets; do not expose them to clients.
        raise HTTPException(status_code=500, detail="Cant read table structure") from None


@app.post("/connections/{conn_id}/columns", dependencies=[Depends(require_reader)])
def get_connection_columns(conn_id: int, payload: ColumnsRequest):
    try:
        conn_config = load_connection_config(conn_id)
        conn_type = str(conn_config.get("connection_type") or "").strip().lower()

        schema_name = clean_optional_string(payload.schema_name)
        table_name = clean_optional_string(payload.table_name)

        if conn_type == "postgres":
            return get_postgres_columns(
                conn_config=conn_config,
                schema_name=schema_name,
                table_name=table_name
            )

        if conn_type == "clickhouse":
            return get_clickhouse_columns(
                conn_config=conn_config,
                schema_name=schema_name,
                table_name=table_name
            )

        raise HTTPException(
            status_code=400,
            detail=f"Columns loading для типа '{conn_type}' пока не поддержан"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/process-chains/{chain_id}/runs", dependencies=[Depends(require_reader)])
def get_process_chain_runs(chain_id: int, date_from: str, date_to: str):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    select
                        id,
                        chain_id,
                        started_at,
                        finished_at,
                        status,
                        error_text
                    from public.chain_run
                    where chain_id = %s
                      and started_at >= %s::timestamptz
                      and started_at < %s::timestamptz
                    order by started_at asc
                """, (chain_id, date_from, date_to))

                return cur.fetchall()

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Get process chain runs error: {str(e)}")

@app.get("/process-chain-runs/{chain_run_id}", dependencies=[Depends(require_reader)])
def get_process_chain_run_details(chain_run_id: int):
    try:
        with psycopg2.connect(DSN) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    select
                        id,
                        chain_id,
                        version,
                        started_at,
                        finished_at,
                        status,
                        error_text
                    from public.chain_run
                    where id = %s
                """, (chain_run_id,))

                run = cur.fetchone()

                if not run:
                    raise HTTPException(status_code=404, detail="Chain run not found")

                if run["version"] is not None:
                    cur.execute("""
                        select data
                        from public.process_chain_history
                        where chain_id = %s
                          and version = %s
                    """, (run["chain_id"], run["version"]))
                else:
                    cur.execute("""
                        select data
                        from public.process_chains
                        where id = %s
                    """, (run["chain_id"],))

                chain_row = cur.fetchone()

                if not chain_row:
                    raise HTTPException(status_code=404, detail="Process chain version not found")

                cur.execute("""
                    select
                        id as flow_run_id,
                        flow_id,
                        status,
                        started_at,
                        finished_at,
                        error_text
                    from public.flow_run
                    where chain_run_id = %s
                    order by id
                """, (chain_run_id,))

                flow_runs = cur.fetchall()

                return {
                    "chain_run": {
                        "id": run["id"],
                        "chain_id": run["chain_id"],
                        "started_at": run["started_at"],
                        "finished_at": run["finished_at"],
                        "status": run["status"],
                        "error_text": run["error_text"],
                    },
                    "data": chain_row["data"],
                    "flow_runs": flow_runs,
                }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Get process chain run details error: {str(e)}")

@app.get("/auto-docs/html", response_class=HTMLResponse, dependencies=[Depends(require_reader)])
def get_auto_docs_html():
    from backend.routers.auto_docs import get_auto_docs_html as build_auto_docs_html

    return build_auto_docs_html()
