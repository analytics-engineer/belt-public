import sys
from pathlib import Path
import traceback

from worker.celery_app import celery_app

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PARSER_DIR = PROJECT_ROOT / "myetl" / "parser"

for path in (PROJECT_ROOT, PARSER_DIR):
    if str(path) not in sys.path:
        sys.path.append(str(path))

from route import run_flow
from meta_db import finish_chain_run


@celery_app.task(name="run_flow_task")
def run_flow_task(flow_id, chain_id=None, chain_run_id=None, started_by=None):
    try:
        result = run_flow(
            flow_id=flow_id, chain_id=chain_id, chain_run_id=chain_run_id, started_by=started_by,
        )

        if isinstance(result, dict) and result.get("status") == "blocked":
            error_text = result.get("error_text") or "Flow blocked"
            raise RuntimeError(error_text)

        return result

    except Exception as e:
        if chain_run_id is not None:
            finish_chain_run(
                chain_run_id=chain_run_id,
                status="error",
                error_text=str(e),
                stderr=traceback.format_exc()
            )

        raise

@celery_app.task(name="finish_chain_success_task")
def finish_chain_success_task(chain_run_id):
    finish_chain_run(
        chain_run_id=chain_run_id,
        status="success",
    )