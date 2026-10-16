import sys
from pathlib import Path
from collections import deque

from celery import chain as celery_chain
from celery import group as celery_group
from celery import chord as celery_chord

from worker.tasks import run_flow_task, finish_chain_success_task
from worker.celery_app import celery_app

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PARSER_DIR = PROJECT_ROOT / "myetl" / "parser"

for path in (PROJECT_ROOT, PARSER_DIR):
    if str(path) not in sys.path:
        sys.path.append(str(path))

from meta_db import load_chain, create_chain_run, finish_chain_run

def check_celery_worker_alive():
    response = celery_app.control.inspect(timeout=1).ping()

    if not response:
        raise RuntimeError("Celery worker is not running")

def load_chain_graph(chain_id: int):
    chain = load_chain(chain_id)
    data = chain["data"] or {}

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    node_by_id = {node["id"]: node for node in nodes}
    children_by_node = {node["id"]: [] for node in nodes}
    parents_by_node = {node["id"]: [] for node in nodes}

    for edge in edges:
        source = edge["source"]
        target = edge["target"]

        if source not in node_by_id:
            raise ValueError(f"Edge source not found: {source}")

        if target not in node_by_id:
            raise ValueError(f"Edge target not found: {target}")

        children_by_node[source].append(target)
        parents_by_node[target].append(source)

    start_nodes = [
        node_id for node_id in node_by_id
        if not parents_by_node[node_id]
    ]

    finish_nodes = [
        node_id for node_id in node_by_id
        if not children_by_node[node_id]
    ]

    if not start_nodes:
        raise ValueError("Chain has no start node")

    if not finish_nodes:
        raise ValueError("Chain has no finish node")

    return {
        "chain": chain,
        "nodes": nodes,
        "edges": edges,
        "node_by_id": node_by_id,
        "children_by_node": children_by_node,
        "parents_by_node": parents_by_node,
        "start_nodes": start_nodes,
        "finish_nodes": finish_nodes,
    }

def validate_chain_graph(graph):
    node_by_id = graph["node_by_id"]
    children_by_node = graph["children_by_node"]

    visiting = set()
    visited = set()

    def dfs(node_id):
        if node_id in visiting:
            raise ValueError(f"Cycle detected at node: {node_id}")

        if node_id in visited:
            return

        visiting.add(node_id)

        for child_id in children_by_node[node_id]:
            dfs(child_id)

        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in node_by_id:
        dfs(node_id)

    for node_id, node in node_by_id.items():
        data = node.get("data") or {}
        flow_id = data.get("flow_id")

        if not flow_id:
            raise ValueError(f"Node has no flow_id: {node_id}")

    return True

def get_flow_id_from_node(node):
    data = node.get("data") or {}
    return int(data["flow_id"])

def make_chain(signatures):
    if not signatures:
        return None

    if len(signatures) == 1:
        return signatures[0]

    return celery_chain(*signatures)

def get_distances_from(start_node_id, children_by_node):
    distances = {start_node_id: 0}
    queue = deque([start_node_id])

    while queue:
        node_id = queue.popleft()

        for child_id in children_by_node[node_id]:
            if child_id not in distances:
                distances[child_id] = distances[node_id] + 1
                queue.append(child_id)

    return distances

def find_join_node(branch_start_ids, children_by_node, parents_by_node):
    distance_maps = [
        get_distances_from(branch_start_id, children_by_node)
        for branch_start_id in branch_start_ids
    ]

    common_nodes = set(distance_maps[0].keys())

    for distances in distance_maps[1:]:
        common_nodes &= set(distances.keys())

    join_candidates = [
        node_id for node_id in common_nodes
        if len(parents_by_node[node_id]) > 1
    ]

    if not join_candidates:
        return None

    return min(
        join_candidates,
        key=lambda node_id: (
            max(distances[node_id] for distances in distance_maps),
            sum(distances[node_id] for distances in distance_maps),
        )
    )

def compile_path_from_node(
    node_id,
    graph,
    chain_id: int,
    chain_run_id: int,
    stop_at=None,
):
    node_by_id = graph["node_by_id"]
    children_by_node = graph["children_by_node"]
    parents_by_node = graph["parents_by_node"]

    current_node_id = node_id
    signatures = []

    while current_node_id:
        if current_node_id == stop_at:
            break

        node = node_by_id[current_node_id]
        flow_id = get_flow_id_from_node(node)

        signatures.append(
            run_flow_task.si(flow_id, chain_id, chain_run_id)
        )

        children = children_by_node[current_node_id]

        if not children:
            if stop_at is not None:
                raise ValueError(f"Branch did not reach join node: {stop_at}")

            break

        if len(children) == 1:
            current_node_id = children[0]
            continue


        join_node_id = find_join_node(
            branch_start_ids=children,
            children_by_node=children_by_node,
            parents_by_node=parents_by_node,
        )

        branch_signatures = []

        for child_id in children:
            branch_signature = compile_path_from_node(
                node_id=child_id,
                graph=graph,
                chain_id=chain_id,
                chain_run_id=chain_run_id,
                stop_at=join_node_id,
            )

            if branch_signature is None:
                if join_node_id is None:
                    raise ValueError(f"Empty branch from node: {child_id}")
                raise ValueError(f"Empty branch before join node: {join_node_id}")

            branch_signatures.append(branch_signature)

        if join_node_id is None:
            signatures.append(
                celery_group(branch_signatures)
            )

            return make_chain(signatures)

        after_join_signature = compile_path_from_node(
            node_id=join_node_id,
            graph=graph,
            chain_id=chain_id,
            chain_run_id=chain_run_id,
            stop_at=stop_at,
        )

        if after_join_signature is None:
            raise ValueError(f"Join node has no executable path: {join_node_id}")

        signatures.append(
            celery_chord(
                celery_group(branch_signatures),
                after_join_signature,
            )
        )

        return make_chain(signatures)

    return make_chain(signatures)

def compile_chain_to_canvas(chain_id: int, chain_run_id: int):
    graph = load_chain_graph(chain_id)
    validate_chain_graph(graph)

    start_nodes = graph["start_nodes"]

    if len(start_nodes) != 1:
        raise ValueError("Only one start node is supported")

    main_signature = compile_path_from_node(
        node_id=start_nodes[0],
        graph=graph,
        chain_id=chain_id,
        chain_run_id=chain_run_id,
    )

    if main_signature is None:
        raise ValueError("Chain has no executable tasks")

    return celery_chain(
        main_signature,
        finish_chain_success_task.si(chain_run_id),
    )

def compile_linear_chain_to_canvas(chain_id: int, chain_run_id: int):
    return compile_chain_to_canvas(chain_id, chain_run_id)

def start_chain_canvas_old(chain_id: int, started_by=None):
    check_celery_worker_alive()
    chain = load_chain(chain_id)
    chain_run_id = create_chain_run(chain_id, chain["version"], started_by=started_by)

    canvas = compile_chain_to_canvas(chain_id, chain_run_id)
    result = canvas.apply_async()

    return {
        "chain_run_id": chain_run_id,
        "celery_result_id": result.id,
    }

def start_chain_canvas(chain_id: int, started_by=None):
    chain = load_chain(chain_id)
    chain_run_id = create_chain_run(chain_id, chain["version"], started_by=started_by)

    try:
        check_celery_worker_alive()

        canvas = compile_chain_to_canvas(chain_id, chain_run_id)
        result = canvas.apply_async()

        return {
            "chain_run_id": chain_run_id,
            "celery_result_id": result.id,
        }

    except ValueError as e:
        error_text = f"E002 Chain compile error. {str(e)}"

        finish_chain_run(
            chain_run_id=chain_run_id,
            status="error",
            error_text=error_text
        )

        raise RuntimeError(error_text) from e

    except Exception as e:
        error_text = f"E003 Chain start error. {str(e)}"

        finish_chain_run(
            chain_run_id=chain_run_id,
            status="error",
            error_text=error_text
        )

        raise RuntimeError(error_text) from e


