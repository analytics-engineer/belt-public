from meta_db import load_connection_config

def parse_flow(flow_json: dict) -> dict:
    flow_type = flow_json.get("flow_type")

    if flow_type == "integration":
        return parse_integration_flow(flow_json)

    if flow_type == "transformation":
        return parse_transformation_flow(flow_json)

    raise ValueError(f"Unknown flow_type: {flow_type}")

def build_target_name(target_type, target_data, target_conn):
    table_name = target_data.get("target_table") or target_data.get("table_name")

    if target_type == "postgres":
        schema_name = target_data.get("schema_name")
        if not schema_name or not table_name:
            raise ValueError("Postgres target requires schema_name and target_table")
        return f"{schema_name}.{table_name}"

    if target_type == "clickhouse":
        database = (
            target_data.get("schema_name")
            or target_data.get("database")
            or target_conn.get("dbname")
            or target_conn.get("database")
        )
        if not database or not table_name:
            raise ValueError("ClickHouse target requires database/dbname and target_table")
        return f"{database}.{table_name}"

    raise ValueError(f"Unknown target_type: {target_type}")

def build_source_name(source_type, source_data, source_conn):
    table_name = source_data.get("table_name") or source_data.get("target_table")

    if source_type == "postgres":
        schema_name = source_data.get("schema_name")
        if not schema_name or not table_name:
            raise ValueError("Postgres source requires schema_name and table_name")
        return f"{schema_name}.{table_name}"

    if source_type == "clickhouse":
        database = (
            source_data.get("database")
            or source_data.get("schema_name")
            or source_conn.get("dbname")
            or source_conn.get("database")
        )
        if not database or not table_name:
            raise ValueError("ClickHouse source requires database/dbname and table_name")
        return f"{database}.{table_name}"

    raise ValueError(f"Unknown source_type: {source_type}")

def parse_integration_flow(flow_json: dict) -> dict:
    edges = flow_json.get("edges", [])
    nodes = flow_json.get("nodes", [])

    if len(edges) != 1:
        raise ValueError("Integration currently requires a single source -> target connection")

    edge = edges[0]

    source_node_id = edge["source"]
    target_node_id = edge["target"]

    source_node = next((node for node in nodes if node.get("id") == source_node_id), None)
    target_node = next((node for node in nodes if node.get("id") == target_node_id), None)

    if not source_node:
        raise ValueError(f"Source node not found: {source_node_id}")

    if not target_node:
        raise ValueError(f"Target node not found: {target_node_id}")

    source_data = source_node.get("data", {})
    target_data = target_node.get("data", {})

    source_conn = load_connection_config(source_data["connection_id"])
    target_conn = load_connection_config(target_data["connection_id"])

    source_type = source_conn["connection_type"]
    target_type = target_conn["connection_type"]

    if source_type == "postgres":
        source_name = source_data["schema_name"] + "." + source_data["table_name"]
    elif source_type == "python":
        source_name = source_data.get("script_path")
        if not source_name:
            raise ValueError("script_path is not specified for python source")
    else:
        raise ValueError(f"Unknown source_type: {source_type}")

    mode = source_data.get("mode", "full")

    if mode not in ("full", "delta"):
        raise ValueError(f"Unknown mode: {mode}")
    
    target_name = build_target_name(target_type, target_data, target_conn)

    return {
        "flow_type": "integration",

        "source_node": source_node,
        "target_node": target_node,

        "source_data": source_data,
        "target_data": target_data,
        
        "source_name": source_name,
        "target_name": target_name,

        "source_type": source_type,
        "target_type": target_type,

        "target_connection_id": int(target_data["connection_id"]),
        "target_connection_type": target_type,

        # mode comes only from the source node
        "mode": mode,
    }

def parse_transformation_flow(flow_json: dict) -> dict:
    edges = flow_json.get("edges", [])
    nodes = flow_json.get("nodes", [])

    source_node = next((node for node in nodes if node.get("type") == "input"), None)
    transform_node = next((node for node in nodes if node.get("type") == "default"), None)
    target_node = next((node for node in nodes if node.get("type") == "output"), None)

    if not source_node:
        raise ValueError("Source node type=input not found for transformation")

    if not transform_node:
        raise ValueError("Transform node type=default not found for transformation")

    if not target_node:
        raise ValueError("Target node type=output not found for transformation")

    source_id = source_node["id"]
    transform_id = transform_node["id"]
    target_id = target_node["id"]

    has_source_to_transform = any(
        edge.get("source") == source_id and edge.get("target") == transform_id
        for edge in edges
    )

    has_transform_to_target = any(
        edge.get("source") == transform_id and edge.get("target") == target_id
        for edge in edges
    )

    if not has_source_to_transform:
        raise ValueError("No source -> transform connection for transformation")

    if not has_transform_to_target:
        raise ValueError("No transform -> target connection for transformation")

    source_data = source_node.get("data", {})
    transform_data = transform_node.get("data", {})
    target_data = target_node.get("data", {})

    source_conn = load_connection_config(source_data["connection_id"])
    target_conn = load_connection_config(target_data["connection_id"])

    source_type = source_conn["connection_type"]
    target_type = target_conn["connection_type"]

    source_name = build_source_name(source_type, source_data, source_conn)
    target_name = build_target_name(target_type, target_data, target_conn)

    mode = source_data.get("mode", "full")

    if mode not in ("full", "delta"):
        raise ValueError(f"Unknown mode: {mode}")

    return {
        "flow_type": "transformation",

        "source_node": source_node,
        "transform_node": transform_node,
        "target_node": target_node,

        "source_data": source_data,
        "transform_data": transform_data,
        "target_data": target_data,

        "source_type": source_type,
        "target_type": target_type,
        "source_name": source_name,
        "target_name": target_name,

        "target_connection_id": int(target_data["connection_id"]),
        "target_connection_type": target_type,

        # mode comes only from the source node
        "mode": mode,
    }