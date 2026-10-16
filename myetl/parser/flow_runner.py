from datetime import datetime, timezone
from meta_db import assert_no_last_failed_batch

def close_if_possible(obj):
    if obj and hasattr(obj, "close"):
        obj.close()

def check_previous_failed_batch(parsed_flow):
    target_connection_id = parsed_flow.get("target_connection_id")
    target = parsed_flow.get("target_name")

    if not target_connection_id or not target:
        return

    assert_no_last_failed_batch(
        target_connection_id=target_connection_id,
        target=target
    )

def run_parsed_flow(parsed_flow):
    flow_type = parsed_flow["flow_type"]
    check_previous_failed_batch(parsed_flow)

    if flow_type == "integration":
        return run_integration_flow(parsed_flow)

    if flow_type == "transformation":
        return run_transformation_flow(parsed_flow)

    raise ValueError(f"Неизвестный flow_type: {flow_type}")

def run_integration_flow(parsed_flow):
    source_type = parsed_flow["source_type"]
    target_type = parsed_flow["target_type"]

    if source_type == "postgres":
        from storage import postgres as source_storage
    elif source_type == "python":
        from storage import python as source_storage
    else:
        raise NotImplementedError(f"Источник {source_type} пока не реализован")

    if target_type == "postgres":
        from storage import postgres as target_storage
    elif target_type == "clickhouse":
        from storage import clickhouse as target_storage
    else:
        raise NotImplementedError(f"Цель {target_type} пока не реализована")

    source_data = parsed_flow["source_data"]
    target_data = parsed_flow["target_data"]

    #timezone = source_data.get("timezone") or "UTC"
    #tz = pytz.timezone(timezone)
    #now = lambda: datetime.now(tz)
    now = lambda: datetime.now(timezone.utc)

    request_id = now()
    request_id = request_id.replace(microsecond=(request_id.microsecond // 1000) * 1000)

    #meta_info = {
    #    "message": target_data.get("add_info")
    #}
    meta_info = {
    "chain_id": parsed_flow.get("chain_id"),
    "chain_run_id": parsed_flow.get("chain_run_id"),
    "flow_id": parsed_flow.get("flow_id"),
    "flow_run_id": parsed_flow.get("flow_run_id"),
    "flow_type": "integration",
    "target_connection_id": parsed_flow.get("target_connection_id"),
    "target_connection_type": parsed_flow.get("target_connection_type"),
    }

    user_message = target_data.get("add_info")
    if user_message is not None and str(user_message).strip() != "":
        meta_info["message"] = user_message

    source_resource = None
    target_resource = None
    buf = None

    try:
        source_resource = source_storage.open_source(parsed_flow)
        target_resource = target_storage.open_target(parsed_flow)

        batches = source_storage.build_batches(
            parsed_flow=parsed_flow,
            request_id=request_id,
            now=now,
        )

        for batch in batches:
            t_start = now()

            buf = source_storage.extract_batch(
                parsed_flow=parsed_flow,
                batch=batch,
                source_resource=source_resource,
                target_resource=target_resource,
                request_id=request_id,
                t_start=t_start,
                meta_info=meta_info,
                now=now,
            )

            if buf:
                try:
                    target_storage.load_batch(
                        parsed_flow=parsed_flow,
                        batch=batch,
                        target_resource=target_resource,
                        buf=buf,
                        request_id=request_id,
                        t_start=t_start,
                        meta_info=meta_info,
                        now=now,
                    )
                finally:
                    close_if_possible(buf)
                    buf = None

    finally:
        close_if_possible(buf)
        close_if_possible(source_resource)
        close_if_possible(target_resource)

def run_transformation_flow(parsed_flow):
    target_type = parsed_flow["target_type"]

    if target_type == "postgres":
        from storage import postgres
        return postgres.run_transformation(parsed_flow)

    if target_type == "clickhouse":
        from storage import clickhouse
        return clickhouse.run_transformation(parsed_flow)

    raise NotImplementedError(
        f"Transformation для target_type={target_type} пока не реализован"
    )