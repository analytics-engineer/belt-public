import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import axios from 'axios';
import useStore from './store';

import 'ag-grid-community/styles/ag-theme-alpine.css';

const PAGE_SIZE = 100;

const UniversalTable = ({
  connId,
  tableName,
  filters = {},
  onOpenRow,
  openButtonText = 'Open',
  onRefreshTable,
  refreshTableLoading = false,
  refreshTableText = 'Refresh table',
  endpointUrl,
  externalRows,
  onOpenRow2,
  selectedRowExternal,
  selectedCellExternal,
  onSelectedRowChange,
  onSelectedCellChange,
  filterModelExternal,
  externalLoading = false,
  preserveSelectionOnRowsChange = false,
  syncOperationsSelection = false,
  openButtonText2 = 'Open 2',

  // For server-side pagination via an external store, later use in Data manage
  totalRows,
  pageLimit = PAGE_SIZE,
  pageOffset = 0,
  onPageChange
}) => {
  const [rowData, setRowData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [countLoading, setCountLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(null);
  const [filterModel, setFilterModel] = useState({});

  const gridApiRef = useRef(null);

  const skipNextFilterEventRef = useRef(false);

  const isSelectedRowControlled = typeof onSelectedRowChange === 'function';
  const isSelectedCellControlled = typeof onSelectedCellChange === 'function';
  const isFilterModelControlled = filterModelExternal !== undefined;

  const effectiveSelectedRow = isSelectedRowControlled ? (selectedRowExternal || null) : selectedRow;
  const effectiveSelectedCell = isSelectedCellControlled ? (selectedCellExternal || null) : selectedCell;

  const setOperationsSelectedRequest = useStore((state) => state.setOperationsSelectedRequest);
  const clearOperationsSelectedRequest = useStore((state) => state.clearOperationsSelectedRequest);

  const filtersKey = useMemo(() => JSON.stringify(filters || {}), [filters]);
  const filterModelKey = useMemo(() => JSON.stringify(filterModel || {}), [filterModel]);
  const filterModelExternalKey = useMemo(() => JSON.stringify(filterModelExternal || {}), [filterModelExternal]);

  const isExternalMode = Array.isArray(externalRows);
  const isExternalPagingMode = isExternalMode && typeof onPageChange === 'function';
  const isServerMode = !isExternalMode && Boolean(endpointUrl || (connId && tableName));

  const currentLimit = pageLimit || PAGE_SIZE;
  const currentOffset = isExternalPagingMode ? (pageOffset || 0) : offset;
  const currentTotal = isExternalPagingMode ? totalRows : total;

  const isOperationsRequestsTable = Boolean(
    syncOperationsSelection || (endpointUrl && endpointUrl.includes('/operations/requests'))
  );

  const getHeaderClass = (key) => {
    const field = String(key || '').toLowerCase();

    if (field.includes('error')) return 'header-error';
    if (field.includes('running')) return 'header-running';
    if (field.includes('success')) return 'header-success';

    return '';
  };

  const getCellClass = (params) => {
    const field = params.colDef.field?.toLowerCase();
    const value = String(params.value ?? '').toLowerCase();

    if (value === 'error' || value === 'fail' || value === 'failed') {
      return 'cell-error';
    }

    if (value === 'running' || value === 'in_progress' || value === 'in progress') {
      return 'cell-running';
    }

    if (value === 'success' || value === 'ok') {
      return 'cell-success';
    }

    if (field?.includes('error') && Number(params.value) > 0) {
      return 'cell-error';
    }

    if (field?.includes('running') && Number(params.value) > 0) {
      return 'cell-running';
    }

    if (field?.includes('success') && Number(params.value) > 0) {
      return 'cell-success';
    }

    return '';
  };

  const buildColumnDefs = useCallback((data) => {
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    return Object.keys(data[0]).map((key) => ({
      field: key,
      headerName: key,
      sortable: true,
      filter: true,
      resizable: true,
      headerClass: getHeaderClass(key),
      cellClass: getCellClass,
      valueFormatter: (params) =>
        typeof params.value === 'object' && params.value !== null
          ? JSON.stringify(params.value)
          : params.value
    }));
  }, []);

  const clearSelectionState = useCallback(() => {
    if (isSelectedRowControlled) {
      onSelectedRowChange(null);
    } else {
      setSelectedRow(null);
    }

    if (isSelectedCellControlled) {
      onSelectedCellChange(null);
    } else {
      setSelectedCell(null);
    }

    if (isOperationsRequestsTable) {
      clearOperationsSelectedRequest();
    }
  }, [
    isOperationsRequestsTable,
    clearOperationsSelectedRequest,
    isSelectedRowControlled,
    isSelectedCellControlled,
    onSelectedRowChange,
    onSelectedCellChange
  ]);

  const setSelectedCellState = (cell) => {
    const value = cell || null;

    if (isSelectedCellControlled) {
      onSelectedCellChange(value);
    } else {
      setSelectedCell(value);
    }
  };

  const setSelectedRequestRow = (row) => {
    const value = row || null;

    if (isSelectedRowControlled) {
      onSelectedRowChange(value);
    } else {
      setSelectedRow(value);
    }

    if (!isOperationsRequestsTable) return;

    if (value) {
      setOperationsSelectedRequest(value);
    } else {
      clearOperationsSelectedRequest();
    }
  };

  const clearGridSelection = () => {
    if (gridApiRef.current) {
      gridApiRef.current.deselectAll();
    }

    clearSelectionState();
  };

  const handleGridContainerClick = (event) => {
    const clickedRow = event.target.closest('.ag-row');
    const clickedHeader = event.target.closest('.ag-header');
    const clickedMenu = event.target.closest('.ag-menu');
    const clickedPaging = event.target.closest('.server-paging-panel');

    if (!clickedRow && !clickedHeader && !clickedMenu && !clickedPaging) {
      clearGridSelection();
    }
  };

  const buildRequestUrl = useCallback((options = {}) => {
    const { withCount = false } = options;
    const baseUrl = endpointUrl || `http://localhost:8000/get_remote_data/${connId}/${tableName}`;
    const url = new URL(baseUrl, window.location.origin);

    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });

    if (filterModel && Object.keys(filterModel).length > 0) {
      url.searchParams.set('filters', JSON.stringify(filterModel));
    } else {
      url.searchParams.delete('filters');
    }

    url.searchParams.set('limit', String(currentLimit));
    url.searchParams.set('offset', String(offset));

    if (withCount) {
      url.searchParams.set('with_count', '1');
    } else {
      url.searchParams.delete('with_count');
    }

    return url.toString();
  }, [endpointUrl, connId, tableName, filtersKey, filterModelKey, currentLimit, offset]);

  const normalizeResponse = (responseData) => {
    if (Array.isArray(responseData)) {
      return {
        rows: responseData,
        total: responseData.length
      };
    }

    return {
      rows: Array.isArray(responseData?.rows) ? responseData.rows : [],
      total: (() => {
        const rawTotal = responseData?.total;

        if (rawTotal === null || rawTotal === undefined || rawTotal === '') {
          return null;
        }

        const parsedTotal = Number(rawTotal);
        return Number.isFinite(parsedTotal) ? parsedTotal : null;
      })()
    };
  };

  useEffect(() => {
    setOffset(0);
  }, [connId, tableName, endpointUrl, filtersKey]);

  useEffect(() => {
    if (!isExternalMode) return;

    const data = Array.isArray(externalRows) ? externalRows : [];

    setLoading(Boolean(externalLoading));
    setRowData(data);
    setColumnDefs(data.length > 0 ? buildColumnDefs(data) : []);

    if (!preserveSelectionOnRowsChange) {
      clearSelectionState();
    }
  }, [externalRows, externalLoading, buildColumnDefs, clearSelectionState, isExternalMode, preserveSelectionOnRowsChange]);

  useEffect(() => {
    if (!isFilterModelControlled) return;

    const nextModel = filterModelExternal || {};
    const currentKey = JSON.stringify(filterModel || {});
    const nextKey = JSON.stringify(nextModel);

    if (currentKey === nextKey) return;

    skipNextFilterEventRef.current = true;
    setFilterModel(nextModel);

    if (gridApiRef.current) {
      gridApiRef.current.setFilterModel(nextModel);
    }
  }, [isFilterModelControlled, filterModelExternalKey]);

  const getRowIdentity = useCallback((row) => {
    if (!row) return '';

    if (row.flow_run_id !== undefined && row.flow_run_id !== null && row.flow_run_id !== '') {
      return `flow_run:${row.flow_run_id}`;
    }

    if (row.id !== undefined && row.id !== null && row.id !== '') {
      return `id:${row.id}`;
    }

    if (
      row.chain_run_id !== undefined && row.chain_run_id !== null && row.chain_run_id !== '' &&
      row.flow_id !== undefined && row.flow_id !== null && row.flow_id !== ''
    ) {
      return `chain_run_flow:${row.chain_run_id}:${row.flow_id}`;
    }

    if (
      row.request_id !== undefined && row.request_id !== null && row.request_id !== '' &&
      row.batch_id !== undefined && row.batch_id !== null && row.batch_id !== ''
    ) {
      return `request_batch:${row.request_id}:${row.batch_id}`;
    }

    if (row.chain_run_id !== undefined && row.chain_run_id !== null && row.chain_run_id !== '') {
      return `chain_run:${row.chain_run_id}`;
    }

    if (row.request_id !== undefined && row.request_id !== null && row.request_id !== '') {
      return `request:${row.request_id}`;
    }

    if (row.batch_id !== undefined && row.batch_id !== null && row.batch_id !== '') {
      return `batch:${row.batch_id}`;
    }

    return JSON.stringify(row);
  }, []);

  useEffect(() => {
    if (!isSelectedRowControlled || !gridApiRef.current) return;

    const api = gridApiRef.current;

    if (!selectedRowExternal) {
      api.deselectAll();
      return;
    }

    const selectedIdentity = getRowIdentity(selectedRowExternal);

    api.forEachNode((node) => {
      node.setSelected(getRowIdentity(node.data) === selectedIdentity);
    });
  }, [isSelectedRowControlled, selectedRowExternal, rowData, getRowIdentity]);

  useEffect(() => {
    if (!isServerMode) return;

    const fetchData = async () => {
      setLoading(true);

      try {
        const url = buildRequestUrl();
        const res = await axios.get(url);
        const normalized = normalizeResponse(res.data);

        setRowData(normalized.rows);
        setTotal((prevTotal) => (
          normalized.total !== null && normalized.total !== undefined
            ? normalized.total
            : prevTotal
        ));

        if (normalized.rows.length > 0) {
          setColumnDefs(buildColumnDefs(normalized.rows));
        }

        clearSelectionState();
      } catch (e) {
        console.error('Error loading table', e);
        setRowData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isServerMode, buildRequestUrl, buildColumnDefs, clearSelectionState]);

  const defaultColDef = useMemo(() => ({
    flex: 1,
    minWidth: 120,
    filter: true,
    filterParams: {
      buttons: ['reset', 'apply'],
      closeOnApply: true
    }
  }), []);

  const handleFilterChanged = useCallback((event) => {
    if (skipNextFilterEventRef.current) {
      skipNextFilterEventRef.current = false;
      return;
    }
    const model = event.api.getFilterModel() || {};

    setFilterModel(model);

    if (isExternalPagingMode) {
      onPageChange({
        limit: currentLimit,
        offset: 0,
        filterModel: model
      });
    } else {
      setOffset(0);
    }
  }, [isExternalPagingMode, onPageChange, currentLimit]);


  const loadTotalCount = async () => {
    if (loading || countLoading) return;

    if (isExternalPagingMode) {
      onPageChange({
        limit: currentLimit,
        offset: currentOffset,
        filterModel,
        withCount: true
      });
      return;
    }

    if (!isServerMode) return;

    try {
      setCountLoading(true);

      const url = buildRequestUrl({ withCount: true });
      const res = await axios.get(url);
      const normalized = normalizeResponse(res.data);

      setTotal(normalized.total);

      if (normalized.rows.length > 0) {
        setRowData(normalized.rows);
        setColumnDefs(buildColumnDefs(normalized.rows));
      }
    } catch (e) {
      console.error('Error counting rows', e);
    } finally {
      setCountLoading(false);
    }
  };

  const goToOffset = (newOffset) => {
    const safeOffset = Math.max(0, newOffset);

    clearSelectionState();

    if (isExternalPagingMode) {
      onPageChange({
        limit: currentLimit,
        offset: safeOffset,
        filterModel
      });
    } else {
      setOffset(safeOffset);
    }
  };

  const showPagingPanel = isServerMode || isExternalPagingMode;

  const showingFrom = rowData.length === 0 ? 0 : currentOffset + 1;
  const showingTo = rowData.length === 0 ? 0 : currentOffset + rowData.length;
  const pageNumber = Math.floor(currentOffset / currentLimit) + 1;
  const totalPages = currentTotal ? Math.max(1, Math.ceil(currentTotal / currentLimit)) : 1;

  const canPrev = currentOffset > 0;
  const canNext = currentTotal === null || currentTotal === undefined
    ? rowData.length === currentLimit
    : currentOffset + currentLimit < currentTotal;

  return (
    <>
      <style>
        {`
.my-grid {
  --ag-background-color: var(--editor-bg);
  --ag-foreground-color: var(--text);
  --ag-header-background-color: var(--workspace-bg);
  --ag-odd-row-background-color: var(--app-bg);
  --ag-row-hover-color: var(--input-bg);
}

.ag-cell {
  font-size: 14px;
  line-height: 22px;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}

.my-grid .cell-error {
  color: var(--danger-text);
  font-weight: 500;
}

.my-grid .cell-running {
  color: var(--warning-text);
  font-weight: 500;
}

.my-grid .cell-success {
  color: var(--success-text);
  font-weight: 500;
}

//.my-grid .header-error .ag-header-cell-label {
//  color: #ff5c5c;
//  font-weight: 500;
//}

//.my-grid .header-running .ag-header-cell-label {
//  color: #f5c542;
//  font-weight: 500;
//}

//.my-grid .header-success .ag-header-cell-label {
//  color: #4ade80;
//  font-weight: 500;
//}
`}
      </style>

      {(onOpenRow || onOpenRow2 || onRefreshTable) && (
        <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          {onOpenRow && (
            <button
              disabled={!effectiveSelectedRow}
              onClick={() => onOpenRow(effectiveSelectedRow)}
              className="belt-button"
            >
              {openButtonText}
            </button>
          )}

          {onOpenRow2 && (
            <button
              disabled={!effectiveSelectedRow}
              onClick={() => onOpenRow2(effectiveSelectedRow)}
              className="belt-button"
            >
              {openButtonText2}
            </button>
          )}

          {onRefreshTable && (
            <>
              {(onOpenRow || onOpenRow2) && (
                <div style={{ width: '1px', background: 'var(--border)', height: '20px', margin: '0 10px' }}></div>
              )}

              <button
                onClick={onRefreshTable}
                disabled={refreshTableLoading}
                className="belt-button belt-button-warning"
              >
                {refreshTableLoading ? 'Loading...' : refreshTableText}
              </button>
            </>
          )}
        </div>
      )}

      <div
        style={{ height: 600, width: '100%', position: 'relative', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}
        className="ag-theme-alpine my-grid"
        onClick={handleGridContainerClick}
      >
        <AgGridReact
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowHeight={28}
          headerHeight={30}
          animateRows={true}
          rowSelection="single"
          onFilterChanged={handleFilterChanged}
          onSelectionChanged={(event) => {
            const selected = event.api.getSelectedRows()[0] || null;
            setSelectedRequestRow(selected);
          }}
          onCellClicked={(params) => {
            setSelectedRequestRow(params.data || null);

            setSelectedCellState({
              field: params.colDef.field,
              value: params.value
            });
          }}
          onGridReady={(params) => {
            gridApiRef.current = params.api;

            if (isFilterModelControlled && filterModelExternal) {
              skipNextFilterEventRef.current = true;
              params.api.setFilterModel(filterModelExternal);
            }
          }}
        />

        {loading && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--overlay-bg)',
              color: 'var(--text-muted)',
              padding: '8px 14px',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              zIndex: 10,
              fontSize: '13px',
              pointerEvents: 'none'
            }}
          >
            Loading...
          </div>
        )}

      </div>

      {showPagingPanel && (
        <div
          className="server-paging-panel"
          style={{
            marginTop: '0px',
            padding: '8px 10px',
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            justifyContent: 'flex-end',
            color: 'var(--text)',
            fontSize: '12px',
            background: 'var(--editor-bg)',
            borderLeft: '1px solid var(--border)',
            borderRight: '1px solid var(--border)',
            borderBottom: '1px solid var(--border)',
            borderBottomLeftRadius: '4px',
            borderBottomRightRadius: '4px'
          }}
        >
          <span>
            {showingFrom}-{showingTo}
            {currentTotal !== null && currentTotal !== undefined ? ` of ${currentTotal}` : ''}
          </span>

          <span>
            Page {pageNumber}
            {currentTotal !== null && currentTotal !== undefined ? ` / ${totalPages}` : ''}
          </span>
          <button
            title="Calculate total rows"
            disabled={loading || countLoading}
            onClick={loadTotalCount}
            style={{
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '5px 9px',
              borderRadius: '3px',
              cursor: (loading || countLoading) ? 'not-allowed' : 'pointer'
            }}
          >
            {countLoading ? '…' : '↻'}
          </button>
          <button
            disabled={!canPrev || loading}
            onClick={() => goToOffset(currentOffset - currentLimit)}
            style={{
              background: canPrev ? 'var(--primary)' : 'var(--border-tab)',
              color: 'var(--text-light)',
              border: 'none',
              padding: '5px 12px',
              borderRadius: '3px',
              cursor: canPrev ? 'pointer' : 'not-allowed'
            }}
          >
            ←
          </button>

          <button
            disabled={!canNext || loading}
            onClick={() => goToOffset(currentOffset + currentLimit)}
            style={{
              background: canNext ? 'var(--primary)' : 'var(--border-tab)',
              color: 'var(--text-light)',
              border: 'none',
              padding: '5px 12px',
              borderRadius: '3px',
              cursor: canNext ? 'pointer' : 'not-allowed'
            }}
          >
            →
          </button>
        </div>
      )}

      {effectiveSelectedCell && (
        <div
          style={{
            marginTop: '5px',
            padding: '0px',
            maxHeight: '220px',
            overflow: 'auto'
          }}
        >
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}
          >
            {typeof effectiveSelectedCell.value === 'object' && effectiveSelectedCell.value !== null
              ? JSON.stringify(effectiveSelectedCell.value, null, 2)
              : String(effectiveSelectedCell.value ?? '')}
          </pre>
        </div>
      )}
    </>
  );
};

export default UniversalTable;