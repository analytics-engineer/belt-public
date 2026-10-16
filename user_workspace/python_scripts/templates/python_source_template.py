"""
Python Source template

Contract:
    def run(params, context):
        return list[dict]  # or pandas.DataFrame

Python script returns only business columns.
Framework adds technical columns automatically:
    tech_request_id
    tech_batch_id

In Python Source node set:
    Function name: you_name
"""

from datetime import datetime


def run(params, context):
    """
    params  - values from Params JSON field in Python Source node
    context - runtime object provided by system

    Available context fields/methods:
        context.batch
        context.request_id
        context.flow_id
        context.chain_id
        context.chain_run_id
        context.workspace_dir
        context.get_connection(connection_id)
        context.log(message)
    """

    params = params or {}

    # ------------------------------------------------------------
    # 1. Params JSON example
    # ------------------------------------------------------------
    # Params JSON in node:
    # {
    #   "limit": 100,
    #   "connection_id": 3,
    #   "only_active": true
    # }
    #
    # limit = params.get("limit", 100)
    # only_active = params.get("only_active", False)

    # ------------------------------------------------------------
    # 2. Get application connection by id
    # ------------------------------------------------------------
    # Option A: connection id from Params JSON
    #
    # conn = context.get_connection(params["connection_id"])
    #
    # Option B: hardcoded connection id
    #
    # conn = context.get_connection(3)
    #
    # Returned structure for exmp (depends what you have added in conn):
    #
    # conn = {
    #     "id": 3,
    #     "name": "my_connection",
    #     "connection_type": "postgres",
    #     "config": {
    #         "host": "...",
    #         "port": 5432,
    #         "dbname": "...",
    #         "user": "..."
    #     },
    #     "secret": {
    #         "password": "..."
    #     }
    # }
    #
    # config = conn["config"]
    # secret = conn["secret"]
    #
    # host = config.get("host")
    # port = config.get("port")
    # dbname = config.get("dbname") or config.get("database")
    # user = config.get("user") or config.get("username")
    # password = secret.get("password")

    # ------------------------------------------------------------
    # 3. Delta batch context
    # ------------------------------------------------------------
    # In full mode context.batch usually looks like:
    #
    # {
    #   "batch_id": 1,
    #   "mode": "full"
    # }
    #
    # In delta mode context.batch usually looks like:
    #
    # {
    #   "batch_id": 1,
    #   "mode": "delta",
    #   "watermark_column": "created_at",
    #   "watermark_from": "2026-05-14 00:00:00+03:00",
    #   "watermark_to": "2026-05-15 00:00:00+03:00"
    # }

    batch = context.batch or {}

    if batch.get("mode") == "delta":
        watermark_from = batch.get("watermark_from")
        watermark_to = batch.get("watermark_to")

        context.log(
            f"Delta batch {batch.get('batch_id')}: "
            f"{watermark_from} -> {watermark_to}"
        )

        # Use watermark_from / watermark_to in your API request,
        # SQL query, file filter, etc.
        #
        # Example:
        # url = f"https://api.example.com/data?from={watermark_from}&to={watermark_to}"

    else:
        context.log("Full mode")

    # ------------------------------------------------------------
    # 4. Runtime ids
    # ------------------------------------------------------------
    # request_id is the current framework request id.
    # batch_id is the current batch id.
    #
    # request_id = context.request_id
    # batch_id = batch.get("batch_id")
    # flow_id = context.flow_id
    # chain_id = context.chain_id
    # chain_run_id = context.chain_run_id

    # ------------------------------------------------------------
    # 5. Logging
    # ------------------------------------------------------------
    #Not obligatory
    # Logs go to flow_run.stdout.
    # context.log("Start loading data")
    # context.log("Loaded rows: 10")

    # ------------------------------------------------------------
    # 6. Return data
    # ------------------------------------------------------------
    # Return list[dict].
    # Keys must match Columns field in Python Source node.
    #
    # Example Columns:
    #   id,name,value,created_at

    rows = [
        {
            "id": 1,
            "name": "A",
            "value": 100,
            "created_at": datetime.utcnow().isoformat(sep=" ", timespec="seconds"),
        },
        {
            "id": 2,
            "name": "B",
            "value": 200,
            "created_at": datetime.utcnow().isoformat(sep=" ", timespec="seconds"),
        },
    ]

    context.log(f"Rows: {len(rows)}")

    return rows


# ------------------------------------------------------------
# Alternative: return pandas.DataFrame
# ------------------------------------------------------------
#
# import pandas as pd
#
#
# def run(params, context):
#     rows = [
#         {"id": 1, "name": "A"},
#         {"id": 2, "name": "B"},
#     ]
#
#     return pd.DataFrame(rows)


# ------------------------------------------------------------
# Example: call HTTP API
# ------------------------------------------------------------
#
# import json
# from urllib.request import Request, urlopen
#
#
# def run(params, context):
#     conn = context.get_connection(params["connection_id"])
#
#     base_url = conn["config"]["base_url"]
#     token = conn["secret"]["token"]
#
#     request = Request(
#         base_url,
#         headers={
#             "Authorization": f"Bearer {token}",
#             "User-Agent": "Belt-Visual-SQL-ELT/1.0",
#         }
#     )
#
#     with urlopen(request, timeout=30) as response:
#         data = json.loads(response.read().decode("utf-8"))
#
#     return data["items"]