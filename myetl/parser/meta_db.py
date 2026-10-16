import os
import psycopg2
from dotenv import load_dotenv
from backend.secret_crypto import decrypt_secret

PARSER_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(PARSER_DIR, "..", ".."))
ENV_PATH = os.path.join(ROOT_DIR, ".env")

if os.path.exists(ENV_PATH):
    load_dotenv(ENV_PATH)

META_DB = {
    "host": os.getenv("META_DB_HOST"),
    "port": os.getenv("META_DB_PORT"),
    "dbname": os.getenv("META_DB_NAME"),
    "user": os.getenv("META_DB_USER"),
    "password": os.getenv("META_DB_PASSWORD"),
}

def get_meta_conn():
    return psycopg2.connect(**META_DB)

JOURNAL_TABLE = "public.journal_table"
JOURNAL_TABLE = os.getenv("JOURNAL_TABLE", "public.journal_table")

class PreviousRequestFailedError(Exception):
    code = "E-001"

def get_journal_conn():
    return get_meta_conn()

def load_flow(flow_id):
    with get_meta_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT data FROM flows WHERE id = %s",
                (flow_id,)
            )
            row = cur.fetchone()

    if not row:
        raise ValueError(f"Flow id={flow_id} не найден")

    return row[0]

def load_connection_config(connection_id):
    with get_meta_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT config, secret, connection_type FROM connections WHERE id = %s",
                (connection_id,)
            )
            row = cur.fetchone()

    if not row:
        raise ValueError(f"Connection id={connection_id} не найден")

    config = row[0] or {}
    secret = decrypt_secret(row[1] or {})
    connection_type = row[2]

    return {**config,  **secret, "connection_type": connection_type }

def load_connection_raw(connection_id):
    with get_meta_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name, connection_type, config, secret
                FROM connections
                WHERE id = %s
                """,
                (connection_id,)
            )
            row = cur.fetchone()

    if not row:
        raise ValueError(f"Connection id={connection_id} не найден")

    return {
        "id": row[0],
        "name": row[1],
        "connection_type": row[2],
        "config": row[3] or {},
        "secret": decrypt_secret(row[4] or {}),
    }

def load_chain(chain_id):
    conn = get_meta_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT data, version
        FROM public.process_chains
        WHERE id = %s
    """, (chain_id,))

    row = cur.fetchone()

    cur.close()
    conn.close()

    if not row:
        raise ValueError(f"Process chain id={chain_id} не найден")

    return {
        "data": row[0],
        "version": row[1],
    }

def create_chain_run(chain_id, version, started_by=None):
    with get_meta_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                insert into public.chain_run (
                    chain_id,
                    version,
                    started_by
                )
                values (%s, %s, %s)
                returning id
            """, (chain_id, version, started_by))

            return cur.fetchone()[0]

def finish_chain_run(chain_run_id, status="success", error_text=None, stdout=None, stderr=None):
    with get_meta_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                update public.chain_run
                set finished_at = now(),
                    status = %s,
                    error_text = %s,
                    stdout = %s,
                    stderr = %s,
                    updated_at = now()
                where id = %s
            """, (status, error_text, stdout, stderr, chain_run_id))

def create_flow_run(flow_id, chain_id=None, chain_run_id=None, started_by=None):
    with get_meta_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                insert into public.flow_run (
                    chain_run_id,
                    chain_id,
                    flow_id,
                    status,
                    started_by
                )
                values (%s, %s, %s, 'running', coalesce(%s, (
                            select started_by  from public.chain_run  where id = %s
                            )))
                returning id
            """, (chain_run_id, chain_id, flow_id, started_by, chain_run_id ))

            return cur.fetchone()[0]

def finish_flow_run(flow_run_id, status="success", error_text=None, stdout=None, stderr=None):
    with get_meta_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                update public.flow_run
                set finished_at = now(),
                    status = %s,
                    error_text = %s,
                    stdout = %s,
                    stderr = %s,
                    updated_at = now()
                where id = %s
            """, (status, error_text, stdout, stderr, flow_run_id))

def assert_no_last_failed_batch(target_connection_id, target):
    if target_connection_id in (None, "") or not target:
        return

    with get_journal_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                select
                    id,
                    etl_type,
                    status,
                    request_id::text,
                    batch_id
                from {JOURNAL_TABLE}
                where target_connection_id = %s
                  and target = %s
                order by coalesce(end_at, start_at) desc, id desc
                limit 1
            """, (target_connection_id, target))

            row = cur.fetchone()

    if not row:
        return

    status = str(row[2] or "").lower()

    if status not in ("fail", "error"):
        return

    raise PreviousRequestFailedError(
        "E-001 Previous request failed. "
        f"Target: {target}. "
        f"Status: {row[2] or 'N/A'}. "
        f"Request ID: {row[3] or 'N/A'}. "
        f"Batch ID: {row[4] or 'N/A'}. "
    )

