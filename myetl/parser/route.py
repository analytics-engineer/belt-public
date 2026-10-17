import os
import sys
import io
import traceback
from contextlib import redirect_stdout, redirect_stderr

# So that Python can see the myetl package if parser is located inside myetl/parser
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

from meta_db import (load_flow, load_chain, create_chain_run, finish_chain_run, create_flow_run,
    finish_flow_run, PreviousRequestFailedError,
)
from flow_parser import parse_flow
from flow_runner import run_parsed_flow

def run_flow(flow_id, chain_id=None, chain_run_id=None, started_by=None):
    flow_id = int(flow_id)
    chain_id = int(chain_id) if chain_id is not None else None
    chain_run_id = int(chain_run_id) if chain_run_id is not None else None
    started_by = int(started_by) if started_by is not None else None

    flow_run_id = create_flow_run(
        flow_id=flow_id,
        chain_id=chain_id,
        chain_run_id=chain_run_id,
        started_by=started_by,
    )

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            flow_json = load_flow(flow_id)
            parsed_flow = parse_flow(flow_json)

            parsed_flow["flow_id"] = flow_id
            parsed_flow["chain_id"] = chain_id
            parsed_flow["chain_run_id"] = chain_run_id
            parsed_flow["flow_run_id"] = flow_run_id

            run_parsed_flow(parsed_flow)

        finish_flow_run(
            flow_run_id=flow_run_id,
            status="success",
            stdout=stdout_buf.getvalue(),
            stderr=stderr_buf.getvalue(),
        )

        return {
            "status": "success"
        }

    except PreviousRequestFailedError as e:
        message = str(e)

        finish_flow_run(
            flow_run_id=flow_run_id,
            status="error",
            error_text=message,
            stdout=stdout_buf.getvalue(),
            stderr=""
        )

        return {
            "status": "blocked",
            "error_text": message
        }

    except PreviousRequestFailedError as e:
        message = str(e)

        finish_flow_run(
            flow_run_id=flow_run_id,
            status="error",
            error_text=message,
            stdout=stdout_buf.getvalue(),
            stderr=""
        )

        raise

    except Exception as e:
        finish_flow_run(
            flow_run_id=flow_run_id,
            status="error",
            error_text=str(e),
            stdout=stdout_buf.getvalue(),
            stderr=stderr_buf.getvalue() + "\n" + traceback.format_exc(),
        )
        raise

def run_chain(chain_id, started_by=None):
    chain_id = int(chain_id)

    chain = load_chain(chain_id)
    chain_json = chain["data"] or {}
    version = chain["version"]

    chain_run_id = create_chain_run(
        chain_id=chain_id,
        version=version, started_by=started_by
    )

    try:
        nodes = chain_json.get("nodes", [])
        edges = chain_json.get("edges", [])

        node_by_id = {node["id"]: node for node in nodes}

        next_by_source = {}
        target_ids = set()

        for edge in edges:
            source = edge["source"]
            target = edge["target"]

            next_by_source[source] = target
            target_ids.add(target)

        start_nodes = [
            node["id"]
            for node in nodes
            if node["id"] not in target_ids
        ]

        if not start_nodes:
            raise ValueError("Start node not found in process chain")

        current_node_id = start_nodes[0]

        while current_node_id:
            node = node_by_id[current_node_id]
            flow_id = node.get("data", {}).get("flow_id")

            if not flow_id:
                raise ValueError(f"flow_id not found in node {current_node_id}")

            print(f"Running flow_id={flow_id}")
            result = run_flow(flow_id, chain_id=chain_id, chain_run_id=chain_run_id, started_by=started_by)

            if isinstance(result, dict) and result.get("status") == "blocked":
                finish_chain_run(
                    chain_run_id=chain_run_id,
                    status="error",
                    error_text=result.get("error_text"),
                    stdout="",
                    stderr=""
                )
                return chain_run_id
            
            current_node_id = next_by_source.get(current_node_id)

        finish_chain_run(
            chain_run_id=chain_run_id,
            status="success",
        )

        return chain_run_id

    except Exception as e:
        finish_chain_run(
            chain_run_id=chain_run_id,
            status="error",
            error_text=str(e),
            stderr=traceback.format_exc(),
        )
        raise

def main():
    if len(sys.argv) < 3:
        print("Error: type and id must be provided")
        print("Example: python route.py flow 19, chain 1")
        sys.exit(1)

    object_type = sys.argv[1]
    object_id = sys.argv[2]

    if object_type == "flow":
        run_flow(object_id)
    elif object_type == "chain":
        run_chain(object_id)
    else:
        raise ValueError(f"Currently only flow and chain are supported, got: {object_type}")

if __name__ == "__main__":
    main()
