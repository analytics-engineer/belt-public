import json
import os
from datetime import datetime
from html import escape
from typing import Any, Dict, Iterable, List, Optional, Set

import psycopg2
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from psycopg2.extras import RealDictCursor


router = APIRouter(prefix="/auto-docs", tags=["auto-docs"])


def get_meta_db_params() -> Dict[str, Any]:
    params = {
        "host": os.getenv("META_DB_HOST"),
        "port": os.getenv("META_DB_PORT"),
        "dbname": os.getenv("META_DB_NAME"),
        "user": os.getenv("META_DB_USER"),
        "password": os.getenv("META_DB_PASSWORD"),
    }

    missing = [key for key, value in params.items() if value in (None, "")]
    if missing:
        raise RuntimeError(f"Missing metadata DB settings: {', '.join(missing)}")

    return params


def safe_int(value: Any) -> Optional[int]:
    try:
        if value in (None, ""):
            return None

        return int(value)
    except Exception:
        return None


def as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    return {}


def html_value(value: Any) -> str:
    if value is None:
        return ""

    if isinstance(value, (dict, list)):
        return escape(json.dumps(value, ensure_ascii=False), quote=True)

    return escape(str(value), quote=True)


def ids_to_attr(ids: Iterable[Any]) -> str:
    clean_ids = []

    for value in ids or []:
        int_value = safe_int(value)
        if int_value is not None:
            clean_ids.append(int_value)

    return ",".join(str(value) for value in sorted(set(clean_ids)))


def get_node_object(node_data: Dict[str, Any]) -> str:
    table_name = (
        node_data.get("target_table")
        or node_data.get("table_name")
        or ""
    )

    schema_name = node_data.get("schema_name") or ""

    object_name = (
        node_data.get("object_name")
        or node_data.get("source_object")
        or node_data.get("target_object")
        or node_data.get("script_path")
        or ".".join([part for part in [schema_name, table_name] if part])
    )

    return object_name or ""


def get_node_connection_id(node_data: Dict[str, Any]) -> Optional[int]:
    return safe_int(node_data.get("connection_id"))


def get_flow_type(flow_data: Dict[str, Any]) -> str:
    return (
        flow_data.get("flow_type")
        or flow_data.get("type")
        or ""
    )


def get_chain_type(chain_data: Dict[str, Any]) -> str:
    return (
        chain_data.get("chain_type")
        or chain_data.get("type")
        or "process_chain"
    )


def get_chain_node_step_type(node_data: Dict[str, Any]) -> str:
    return (
        node_data.get("step_type")
        or node_data.get("object_type")
        or node_data.get("type")
        or ""
    )


def get_chain_node_object_id(node_data: Dict[str, Any]) -> Optional[int]:
    step_type = get_chain_node_step_type(node_data)

    if step_type == "flow":
        return safe_int(node_data.get("flow_id"))

    return safe_int(node_data.get("object_id"))


def get_chain_flow_ids(chain_data: Dict[str, Any]) -> Set[int]:
    flow_ids: Set[int] = set()

    for node in chain_data.get("nodes", []) or []:
        node_data = node.get("data") or {}
        step_type = get_chain_node_step_type(node_data)

        if step_type != "flow":
            continue

        flow_id = safe_int(node_data.get("flow_id"))

        if flow_id is not None:
            flow_ids.add(flow_id)

    return flow_ids


def load_auto_doc_metadata() -> Dict[str, List[Dict[str, Any]]]:
    with psycopg2.connect(**get_meta_db_params()) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                select id, connection_type, name
                from public.connections
                order by id
            """)
            connections = cur.fetchall()

            cur.execute("""
                select id, name, data
                from public.flows
                order by id
            """)
            flows = cur.fetchall()

            cur.execute("""
                select id, name, data
                from public.process_chains
                order by id
            """)
            chains = cur.fetchall()

    return {
        "connections": list(connections),
        "flows": list(flows),
        "chains": list(chains),
    }


def build_indexes(
    flows: List[Dict[str, Any]],
    chains: List[Dict[str, Any]],
) -> Dict[str, Any]:
    flow_name_by_id: Dict[int, str] = {}
    flow_data_by_id: Dict[int, Dict[str, Any]] = {}
    connection_ids_by_flow_id: Dict[int, Set[int]] = {}

    for flow_row in flows:
        flow_id = safe_int(flow_row.get("id"))
        if flow_id is None:
            continue

        flow_data = as_dict(flow_row.get("data"))
        flow_name_by_id[flow_id] = flow_row.get("name") or ""
        flow_data_by_id[flow_id] = flow_data
        connection_ids_by_flow_id[flow_id] = set()

        for node in flow_data.get("nodes", []) or []:
            node_data = node.get("data") or {}
            connection_id = get_node_connection_id(node_data)

            if connection_id is not None:
                connection_ids_by_flow_id[flow_id].add(connection_id)

    chain_data_by_id: Dict[int, Dict[str, Any]] = {}
    flow_ids_by_chain_id: Dict[int, Set[int]] = {}

    for chain_row in chains:
        chain_id = safe_int(chain_row.get("id"))
        if chain_id is None:
            continue

        chain_data = as_dict(chain_row.get("data"))
        chain_data_by_id[chain_id] = chain_data
        flow_ids_by_chain_id[chain_id] = get_chain_flow_ids(chain_data)

    chain_ids_by_flow_id: Dict[int, Set[int]] = {}
    connection_ids_by_chain_id: Dict[int, Set[int]] = {}
    flow_ids_by_connection_id: Dict[int, Set[int]] = {}
    chain_ids_by_connection_id: Dict[int, Set[int]] = {}

    for chain_id, flow_ids in flow_ids_by_chain_id.items():
        connection_ids_by_chain_id[chain_id] = set()

        for flow_id in flow_ids:
            chain_ids_by_flow_id.setdefault(flow_id, set()).add(chain_id)

            for connection_id in connection_ids_by_flow_id.get(flow_id, set()):
                connection_ids_by_chain_id[chain_id].add(connection_id)
                chain_ids_by_connection_id.setdefault(connection_id, set()).add(chain_id)

    for flow_id, connection_ids in connection_ids_by_flow_id.items():
        for connection_id in connection_ids:
            flow_ids_by_connection_id.setdefault(connection_id, set()).add(flow_id)

    return {
        "flow_name_by_id": flow_name_by_id,
        "flow_data_by_id": flow_data_by_id,
        "connection_ids_by_flow_id": connection_ids_by_flow_id,
        "chain_data_by_id": chain_data_by_id,
        "flow_ids_by_chain_id": flow_ids_by_chain_id,
        "chain_ids_by_flow_id": chain_ids_by_flow_id,
        "connection_ids_by_chain_id": connection_ids_by_chain_id,
        "flow_ids_by_connection_id": flow_ids_by_connection_id,
        "chain_ids_by_connection_id": chain_ids_by_connection_id,
    }


def build_connection_doc_rows(
    connections: List[Dict[str, Any]],
    indexes: Dict[str, Any],
) -> List[Dict[str, Any]]:
    rows = []

    flow_ids_by_connection_id = indexes["flow_ids_by_connection_id"]
    chain_ids_by_connection_id = indexes["chain_ids_by_connection_id"]

    for connection in connections:
        connection_id = safe_int(connection.get("id"))

        rows.append({
            "attrs": {
                "connection_ids": ids_to_attr([connection_id]),
                "flow_ids": ids_to_attr(flow_ids_by_connection_id.get(connection_id, set())),
                "chain_ids": ids_to_attr(chain_ids_by_connection_id.get(connection_id, set())),
            },
            "cells": {
                "ID": connection_id,
                "Type": connection.get("connection_type") or "",
                "Name": connection.get("name") or "",
            },
        })

    return rows


def build_flow_doc_rows(
    flows: List[Dict[str, Any]],
    indexes: Dict[str, Any],
) -> List[Dict[str, Any]]:
    rows = []

    chain_ids_by_flow_id = indexes["chain_ids_by_flow_id"]

    for flow_row in flows:
        flow_id = safe_int(flow_row.get("id"))
        if flow_id is None:
            continue

        flow_data = as_dict(flow_row.get("data"))
        flow_type = get_flow_type(flow_data)
        nodes = flow_data.get("nodes", []) or []
        chain_ids = chain_ids_by_flow_id.get(flow_id, set())

        if not nodes:
            rows.append({
                "attrs": {
                    "connection_ids": "",
                    "flow_ids": ids_to_attr([flow_id]),
                    "chain_ids": ids_to_attr(chain_ids),
                },
                "cells": {
                    "Flow ID": flow_id,
                    "Flow Type": flow_type,
                    "Flow Name": flow_row.get("name") or "",
                    "Node Type": "",
                    "Object": "",
                    "Connection ID": "",
                },
            })
            continue

        for node in nodes:
            node_data = node.get("data") or {}
            connection_id = get_node_connection_id(node_data)

            rows.append({
                "attrs": {
                    "connection_ids": ids_to_attr([connection_id]),
                    "flow_ids": ids_to_attr([flow_id]),
                    "chain_ids": ids_to_attr(chain_ids),
                },
                "cells": {
                    "Flow ID": flow_id,
                    "Flow Type": flow_type,
                    "Flow Name": flow_row.get("name") or "",
                    "Node Type": node.get("type") or node_data.get("node_type") or "",
                    "Object": get_node_object(node_data),
                    "Connection ID": connection_id,
                },
            })

    return rows


def build_chain_doc_rows(
    chains: List[Dict[str, Any]],
    indexes: Dict[str, Any],
) -> List[Dict[str, Any]]:
    rows = []

    flow_name_by_id = indexes["flow_name_by_id"]
    connection_ids_by_flow_id = indexes["connection_ids_by_flow_id"]

    for chain_row in chains:
        chain_id = safe_int(chain_row.get("id"))
        if chain_id is None:
            continue

        chain_data = as_dict(chain_row.get("data"))
        chain_type = get_chain_type(chain_data)
        nodes = chain_data.get("nodes", []) or []

        if not nodes:
            rows.append({
                "attrs": {
                    "connection_ids": "",
                    "flow_ids": "",
                    "chain_ids": ids_to_attr([chain_id]),
                },
                "cells": {
                    "Chain ID": chain_id,
                    "Chain Type": chain_type,
                    "Chain Name": chain_row.get("name") or "",
                    "Object Type": "",
                    "Object ID": "",
                    "Object Name": "",
                },
            })
            continue

        for node in nodes:
            node_data = node.get("data") or {}
            step_type = get_chain_node_step_type(node_data)
            object_type = node_data.get("object_type") or step_type or node.get("type") or ""
            object_id = get_chain_node_object_id(node_data)

            row_flow_ids = set()
            row_connection_ids = set()

            if step_type == "flow" and object_id is not None:
                row_flow_ids.add(object_id)
                row_connection_ids.update(connection_ids_by_flow_id.get(object_id, set()))

            object_name = (
                node_data.get("object_name")
                or node_data.get("name")
                or node_data.get("label")
                or ""
            )

            if step_type == "flow" and object_id is not None:
                object_name = flow_name_by_id.get(object_id, object_name)

            rows.append({
                "attrs": {
                    "connection_ids": ids_to_attr(row_connection_ids),
                    "flow_ids": ids_to_attr(row_flow_ids),
                    "chain_ids": ids_to_attr([chain_id]),
                },
                "cells": {
                    "Chain ID": chain_id,
                    "Chain Type": chain_type,
                    "Chain Name": chain_row.get("name") or "",
                    "Object Type": object_type,
                    "Object ID": object_id,
                    "Object Name": object_name,
                },
            })

    return rows


def unique_filter_options(
    rows: List[Dict[str, Any]],
    id_column: str,
    label_column: Optional[str] = None,
) -> List[Dict[str, str]]:
    options: Dict[str, str] = {}

    for row in rows:
        cells = row.get("cells") or {}
        item_id = cells.get(id_column)

        if item_id in (None, ""):
            continue

        item_id_str = str(item_id)
        label = cells.get(label_column) if label_column else ""

        if item_id_str not in options:
            options[item_id_str] = str(label or "")

    return sorted(
        [
            {"id": item_id, "label": label}
            for item_id, label in options.items()
        ],
        key=lambda item: int(item["id"]) if item["id"].isdigit() else item["id"],
    )


def render_checkbox_filter(
    title: str,
    filter_name: str,
    options: List[Dict[str, str]],
) -> str:
    options_html = ""

    for option in options:
        label = (
            f"{option['id']} / {option['label']}"
            if option.get("label")
            else option["id"]
        )

        options_html += f"""
            <label class="checkbox-row">
                <input
                    type="checkbox"
                    name="{html_value(filter_name)}"
                    value="{html_value(option["id"])}"
                />
                <span>{html_value(label)}</span>
            </label>
        """

    if not options_html:
        options_html = "<div class='checkbox-empty'>No values</div>"

    return f"""
        <details class="filter-dropdown">
            <summary>
                <span>{html_value(title)}</span>
                <span class="filter-count" data-filter-count="{html_value(filter_name)}"></span>
            </summary>
            <div class="dropdown-panel">
                {options_html}
            </div>
        </details>
    """


def render_table(title: str, headers: List[str], rows: List[Dict[str, Any]]) -> str:
    header_html = "".join(f"<th>{html_value(header)}</th>" for header in headers)

    body_html = ""

    for row in rows:
        attrs = row.get("attrs") or {}
        cells = row.get("cells") or {}

        body_html += f"""
            <tr
                data-doc-row="1"
                data-connection-ids="{html_value(attrs.get("connection_ids", ""))}"
                data-flow-ids="{html_value(attrs.get("flow_ids", ""))}"
                data-chain-ids="{html_value(attrs.get("chain_ids", ""))}"
            >
        """

        for header in headers:
            body_html += f"<td>{html_value(cells.get(header))}</td>"

        body_html += "</tr>"

    empty_display = "" if not rows else "display:none;"

    body_html += f"""
        <tr data-empty-row="1" style="{empty_display}">
            <td class="empty" colspan="{len(headers)}">No data for selected filters</td>
        </tr>
    """

    return f"""
        <section class="doc-section">
            <h2>{html_value(title)}</h2>
            <table>
                <thead>
                    <tr>{header_html}</tr>
                </thead>
                <tbody>
                    {body_html}
                </tbody>
            </table>
        </section>
    """


def render_auto_docs_html(
    connection_rows: List[Dict[str, Any]],
    flow_rows: List[Dict[str, Any]],
    chain_rows: List[Dict[str, Any]],
) -> str:
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    connection_options = unique_filter_options(connection_rows, "ID", "Name")
    flow_options = unique_filter_options(flow_rows, "Flow ID", "Flow Name")
    chain_options = unique_filter_options(chain_rows, "Chain ID", "Chain Name")

    css = """
        <style>
            body {
                margin: 0;
                padding: 32px;
                font-family: Arial, sans-serif;
                background: #f5f7fb;
                color: #111827;
            }

            .page {
                max-width: 1280px;
                margin: 0 auto;
            }

            h1 {
                margin: 0 0 8px;
                font-size: 28px;
            }

            .meta {
                color: #6b7280;
                margin-bottom: 24px;
                font-size: 13px;
            }

            .filters {
                display: flex;
                flex-wrap: wrap;
                align-items: flex-start;
                gap: 12px;
                padding: 16px;
                margin-bottom: 24px;
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            }

            button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 36px;
                padding: 0 14px;
                border: 1px solid #111827;
                border-radius: 8px;
                background: #111827;
                color: #ffffff;
                font-size: 14px;
                cursor: pointer;
            }

            button.secondary {
                background: #ffffff;
                color: #111827;
            }

            .filter-dropdown {
                position: relative;
            }

            .filter-dropdown summary {
                min-width: 190px;
                height: 36px;
                padding: 0 12px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                background: #ffffff;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                font-size: 14px;
                list-style: none;
            }

            .filter-dropdown summary::-webkit-details-marker {
                display: none;
            }

            .filter-count {
                color: #6b7280;
                font-size: 12px;
            }

            .dropdown-panel {
                position: absolute;
                z-index: 10;
                top: 42px;
                left: 0;
                width: 280px;
                max-height: 280px;
                overflow: auto;
                padding: 8px;
                background: #ffffff;
                border: 1px solid #d1d5db;
                border-radius: 10px;
                box-shadow: 0 8px 20px rgba(0,0,0,0.12);
            }

            .checkbox-row {
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 8px;
                padding: 6px 8px;
                font-size: 13px;
                color: #111827;
                cursor: pointer;
            }

            .checkbox-row input {
                width: auto;
            }

            .checkbox-row:hover {
                background: #f3f4f6;
                border-radius: 6px;
            }

            .checkbox-empty {
                padding: 8px;
                color: #6b7280;
                font-size: 13px;
            }

            .doc-section {
                margin-bottom: 28px;
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            }

            h2 {
                margin: 0;
                padding: 16px;
                font-size: 18px;
                border-bottom: 1px solid #e5e7eb;
                background: #f9fafb;
            }

            table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
            }

            th,
            td {
                padding: 10px 12px;
                border-bottom: 1px solid #e5e7eb;
                text-align: left;
                vertical-align: top;
            }

            th {
                background: #f3f4f6;
                font-weight: 700;
                color: #374151;
            }

            tr:last-child td {
                border-bottom: none;
            }

            .empty {
                color: #6b7280;
                font-style: italic;
            }

            @media print {
                body {
                    background: #ffffff;
                    padding: 16px;
                }

                .filters {
                    display: none;
                }

                .doc-section {
                    box-shadow: none;
                    break-inside: avoid;
                }
            }
        </style>
    """

    script = """
        <script>
            function splitIds(value) {
                return String(value || '')
                    .split(',')
                    .map(function (item) { return item.trim(); })
                    .filter(Boolean);
            }

            function getCheckedValues(filterName) {
                return Array.from(document.querySelectorAll('input[name="' + filterName + '"]:checked'))
                    .map(function (item) { return item.value; });
            }

            function rowMatchesFilter(row, selectedValues, datasetKey) {
                if (!selectedValues.length) return true;

                var rowValues = splitIds(row.dataset[datasetKey]);

                return selectedValues.some(function (value) {
                    return rowValues.includes(value);
                });
            }

            function updateFilterCounts() {
                ['connection-filter', 'flow-filter', 'chain-filter'].forEach(function (filterName) {
                    var count = getCheckedValues(filterName).length;
                    var countElement = document.querySelector('[data-filter-count="' + filterName + '"]');

                    if (countElement) {
                        countElement.textContent = count ? '(' + count + ')' : '';
                    }
                });
            }

            function updateEmptyRows() {
                document.querySelectorAll('tbody').forEach(function (tbody) {
                    var rows = Array.from(tbody.querySelectorAll('tr[data-doc-row="1"]'));
                    var hasVisibleRows = rows.some(function (row) {
                        return row.style.display !== 'none';
                    });

                    var emptyRow = tbody.querySelector('tr[data-empty-row="1"]');
                    if (emptyRow) {
                        emptyRow.style.display = hasVisibleRows ? 'none' : '';
                    }
                });
            }

            function applyFilters() {
                var connectionIds = getCheckedValues('connection-filter');
                var flowIds = getCheckedValues('flow-filter');
                var chainIds = getCheckedValues('chain-filter');

                document.querySelectorAll('tr[data-doc-row="1"]').forEach(function (row) {
                    var isVisible =
                        rowMatchesFilter(row, connectionIds, 'connectionIds') &&
                        rowMatchesFilter(row, flowIds, 'flowIds') &&
                        rowMatchesFilter(row, chainIds, 'chainIds');

                    row.style.display = isVisible ? '' : 'none';
                });

                updateFilterCounts();
                updateEmptyRows();
            }

            function resetFilters() {
                document.querySelectorAll('.filters input[type="checkbox"]').forEach(function (checkbox) {
                    checkbox.checked = false;
                });

                applyFilters();
            }

            document.addEventListener('DOMContentLoaded', function () {
                document.querySelectorAll('.filters input[type="checkbox"]').forEach(function (checkbox) {
                    checkbox.addEventListener('change', applyFilters);
                });

                document.addEventListener('click', function (event) {
                    document.querySelectorAll('.filter-dropdown[open]').forEach(function (dropdown) {
                        if (!dropdown.contains(event.target)) {
                            dropdown.removeAttribute('open');
                        }
                    });
                });

                updateFilterCounts();
                updateEmptyRows();
            });
        </script>
    """

    return f"""
        <!doctype html>
        <html>
            <head>
                <meta charset="utf-8" />
                <title>Belt Project Documentation</title>
                {css}
            </head>
            <body>
                <div class="page">
                    <h1>Belt Project Documentation</h1>
                    <div class="meta">Generated at {html_value(generated_at)}</div>

                    <div class="filters">
                        {render_checkbox_filter("Connection ID", "connection-filter", connection_options)}
                        {render_checkbox_filter("Flow ID", "flow-filter", flow_options)}
                        {render_checkbox_filter("Chain ID", "chain-filter", chain_options)}

                        <button class="secondary" type="button" onclick="resetFilters()">Reset</button>
                        <button class="secondary" type="button" onclick="window.print()">Print / Save PDF</button>
                    </div>

                    {render_table(
                        "Connections",
                        ["ID", "Type", "Name"],
                        connection_rows
                    )}

                    {render_table(
                        "Flows",
                        ["Flow ID", "Flow Type", "Flow Name", "Node Type", "Object", "Connection ID"],
                        flow_rows
                    )}

                    {render_table(
                        "Chain",
                        ["Chain ID", "Chain Type", "Chain Name", "Object Type", "Object ID", "Object Name"],
                        chain_rows
                    )}
                </div>

                {script}
            </body>
        </html>
    """


@router.get("/html", response_class=HTMLResponse)
def get_auto_docs_html():
    try:
        metadata = load_auto_doc_metadata()
        indexes = build_indexes(metadata["flows"], metadata["chains"])

        connection_rows = build_connection_doc_rows(
            metadata["connections"],
            indexes,
        )
        flow_rows = build_flow_doc_rows(
            metadata["flows"],
            indexes,
        )
        chain_rows = build_chain_doc_rows(
            metadata["chains"],
            indexes,
        )

        html = render_auto_docs_html(
            connection_rows,
            flow_rows,
            chain_rows,
        )

        return HTMLResponse(content=html)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Auto documentation error: {str(e)}",
        )