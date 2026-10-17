import React, { useEffect, useMemo } from 'react';
import axios from 'axios';
import UniversalTable from '../../UniversalTable';
import useStore from '../../store';
import { t } from './i18n';

const PAGE_LIMIT = 100;

const isFilterModelValue = (value) => (
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (
    Object.prototype.hasOwnProperty.call(value, 'filterType') ||
    Object.prototype.hasOwnProperty.call(value, 'type') ||
    Object.prototype.hasOwnProperty.call(value, 'filter')
  )
);

const splitTabFilters = (filters = {}) => {
  const baseFilters = {};
  const initialFilterModel = {};

  Object.entries(filters || {}).forEach(([key, value]) => {
    if (isFilterModelValue(value)) {
      initialFilterModel[key] = value;
    } else {
      baseFilters[key] = value;
    }
  });

  return { baseFilters, initialFilterModel };
};

const normalizeResponse = (responseData) => {
  if (Array.isArray(responseData)) {
    return {
      rows: responseData,
      total: responseData.length
    };
  }

  const rows = Array.isArray(responseData?.rows) ? responseData.rows : [];
  const rawTotal = responseData?.total;
  const total = rawTotal === null || rawTotal === undefined || rawTotal === ''
    ? null
    : Number(rawTotal);

  return {
    rows,
    total: Number.isFinite(total) ? total : null
  };
};

const getLogTitle = (activeTab) => {
  if (activeTab?.logLevel === 'journal_chain') {
    return 'Chains';
  }

  if (activeTab?.logLevel === 'chain_flow') {
    return `Chain ${activeTab.chainId} -> Flows`;
  }

  if (activeTab?.logLevel === 'flow_nodes') {
    return `Chain ${activeTab.chainId} -> Flow ${activeTab.flowId} -> Batches`;
  }

  if (activeTab?.logLevel === 'chain_matrix') {
    return `Chain ${activeTab.chainId} -> Matrix`;
  }

  if (activeTab?.logLevel === 'flow_runs_all') {
    return 'Flows';
  }

  return activeTab?.title || '';
};

export default function MonitoringTab({ API_URL, activeTab, addTab, setActiveTab }) {
  const tableState = useStore((state) => state.monitoringTablesByTab[activeTab.id]);
  const setMonitoringTableState = useStore((state) => state.setMonitoringTableState);

  const { baseFilters, initialFilterModel } = useMemo(
    () => splitTabFilters(activeTab.filters || {}),
    [activeTab.filters]
  );

  const state = tableState || {
    rows: null,
    total: null,
    limit: PAGE_LIMIT,
    offset: 0,
    filterModel: initialFilterModel,
    selectedRow: null,
    selectedCell: null,
    loading: false,
    errorText: ''
  };

  const buildRequestUrl = ({ limit, offset, filterModel, withCount = false, cacheBreaker = false }) => {
    const baseUrl = activeTab.endpointUrl || `${API_URL}/get_metadata_data/${activeTab.tableName}`;
    const url = new URL(baseUrl, window.location.origin);

    Object.entries(baseFilters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    if (filterModel && Object.keys(filterModel).length > 0) {
      url.searchParams.set('filters', JSON.stringify(filterModel));
    } else {
      url.searchParams.delete('filters');
    }

    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    if (withCount) {
      url.searchParams.set('with_count', '1');
    } else {
      url.searchParams.delete('with_count');
    }

    if (cacheBreaker) {
      url.searchParams.set('_ts', String(Date.now()));
    }

    return url.toString();
  };

  const loadRows = async ({
    limit = state.limit || PAGE_LIMIT,
    offset = state.offset || 0,
    filterModel = state.filterModel || initialFilterModel,
    withCount = false,
    force = false,
    clearSelection = false
  } = {}) => {
    if (!force && state.rows) return;

    const safeLimit = limit || PAGE_LIMIT;
    const safeOffset = Math.max(0, offset || 0);
    const safeFilterModel = filterModel || {};

    const previousFilterKey = JSON.stringify(state.filterModel || {});
    const nextFilterKey = JSON.stringify(safeFilterModel || {});
    const shouldClearSelection = clearSelection || previousFilterKey !== nextFilterKey || safeOffset !== (state.offset || 0);

    setMonitoringTableState(activeTab.id, {
      loading: true,
      errorText: '',
      limit: safeLimit,
      offset: safeOffset,
      filterModel: safeFilterModel,
      ...(shouldClearSelection ? { selectedRow: null, selectedCell: null } : {})
    });

    try {
      const res = await axios.get(buildRequestUrl({
        limit: safeLimit,
        offset: safeOffset,
        filterModel: safeFilterModel,
        withCount,
        cacheBreaker: force
      }));

      const normalized = normalizeResponse(res.data);
      const sameFilter = previousFilterKey === nextFilterKey;
      const nextTotal = normalized.total !== null && normalized.total !== undefined
        ? normalized.total
        : (sameFilter ? state.total ?? null : null);

      setMonitoringTableState(activeTab.id, {
        rows: normalized.rows,
        total: nextTotal,
        limit: safeLimit,
        offset: safeOffset,
        filterModel: safeFilterModel,
        loading: false,
        errorText: '',
        ...(shouldClearSelection ? { selectedRow: null, selectedCell: null } : {})
      });
    } catch (e) {
      setMonitoringTableState(activeTab.id, {
        loading: false,
        errorText: e.response?.data?.detail || e.message || String(e)
      });
    }
  };

  useEffect(() => {
    if (tableState) return;

    setMonitoringTableState(activeTab.id, {
      filterModel: initialFilterModel,
      limit: PAGE_LIMIT,
      offset: 0
    });
  }, [activeTab.id, tableState, initialFilterModel, setMonitoringTableState]);

  useEffect(() => {
    if (state.rows || state.loading) return;

    loadRows({ force: false });
  }, [activeTab.id]);

  const handleOpenFlowRunBatches = (row) => {
    const flowRunId = row.flow_run_id || row.id;

    if (!flowRunId) {
      return alert('Didnt find flow_run_id');
    }

    const tabId = `flow-run-${flowRunId}-batches`;

    addTab({
      endpointUrl: `${API_URL}/monitor/flow-run-batches?flow_run_id=${flowRunId}`,
      id: tabId,
      title: `Flow run ${flowRunId} / Batches`,
      type: 'logs',
      logLevel: 'flow_run_batches',
      tableName: 'flow_run_batches',
      filters: {},
      flowRunId
    });

    setActiveTab(tabId);
  };

  const handleOpenJournalChain = (row) => {
    const chainId = row.id || row.chain_id;

    if (!chainId) {
      return alert('chain_id not found');
    }

    const tabId = `journal-chain-${chainId}-runs`;

    addTab({
      endpointUrl: `${API_URL}/get_metadata_data/monitor_chain_runs`,
      id: tabId,
      title: `Chain ${chainId} / Runs`,
      type: 'logs',
      logLevel: 'chain_runs',
      tableName: 'monitor_chain_runs',
      filters: {
        chain_id: chainId
      },
      chainId
    });

    setActiveTab(tabId);
  };

  const handleOpenJournalChainMatrix = (row) => {
    const chainId = row.id || row.chain_id;

    if (!chainId) {
      return alert('chain_id not found');
    }

    const tabId = `journal-chain-${chainId}-matrix`;

    addTab({
      id: tabId,
      title: `Chain ${chainId} Matrix`,
      type: 'logs',
      logLevel: 'chain_matrix',
      endpointUrl: `${API_URL}/get_chain_matrix/${chainId}`,
      filters: {},
      chainId
    });

    setActiveTab(tabId);
  };

  const handleSetChainRunStatus = async (row, newStatus) => {
    const chainRunId = row.chain_run_id;

    if (!chainRunId) {
      return alert('chain_run_id not found');
    }

    const hasRunning =
      row.chain_status === 'running' ||
      Object.keys(row).some((key) => key.startsWith('flow_') && row[key] === 'running');

    if (!hasRunning) {
      return alert(`Cannot change the status of this run.\n\nThere is no chain or flow with status running in the row.\n`);
    }

    const ok = window.confirm(
      `Set running chain/flows in chain_run_id=${chainRunId} to ${newStatus}?`
    );

    if (!ok) return;

    try {
      await axios.post(`${API_URL}/chain-runs/${chainRunId}/set-status`, {
        status: newStatus,
        error_text: `Manually set to ${newStatus}`
      });

      await loadRows({ force: true });
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    }
  };

  const handleOpenChainRun = (row) => {
    const chainRunId = row.id || row.chain_run_id;
    const chainId = row.chain_id || activeTab?.chainId;

    if (!chainRunId) {
      return alert('chain_run_id not found');
    }

    const tabId = `journal-chain-run-${chainRunId}-flows`;

    addTab({
      endpointUrl: `${API_URL}/get_metadata_data/monitor_flow_runs`,
      id: tabId,
      title: `Chain ${chainId} / Run ${chainRunId} / Flows`,
      type: 'logs',
      logLevel: 'flow_runs',
      tableName: 'monitor_flow_runs',
      filters: {
        chain_run_id: chainRunId
      },
      chainId,
      chainRunId
    });

    setActiveTab(tabId);
  };

  const handleOpenJournalFlow = (row) => {
    const chainRunId = row.chain_run_id || activeTab?.chainRunId;
    const chainId = row.chain_id || activeTab?.chainId;
    const flowId = row.flow_id;
    const flowRunId = row.flow_run_id || row.id;

    if (!chainRunId || !flowId || !flowRunId) {
      return alert('chain_run_id, flow_id, or flow_run_id not found');
    }

    const tabId = `journal-chain-run-${chainRunId}-flow-run-${flowRunId}-batches`;

    addTab({
      endpointUrl: `${API_URL}/monitor/flow-run-batches?flow_run_id=${flowRunId}`,
      id: tabId,
      title: `Chain ${chainId} / Run ${chainRunId} / Flow ${flowId} / Batches`,
      type: 'logs',
      logLevel: 'flow_run_batches',
      tableName: 'flow_run_batches',
      filters: {},
      chainId,
      chainRunId,
      flowId,
      flowRunId
    });

    setActiveTab(tabId);
  };

  const onOpenRow = activeTab.logLevel === 'journal_chain'
    ? handleOpenJournalChain
    : activeTab.logLevel === 'chain_runs'
      ? handleOpenChainRun
      : activeTab.logLevel === 'flow_runs'
        ? handleOpenJournalFlow
        : activeTab.logLevel === 'flow_runs_all'
          ? handleOpenFlowRunBatches
          : activeTab.logLevel === 'chain_matrix'
            ? (row) => handleSetChainRunStatus(row, 'success')
            : null;

  const openButtonText = activeTab.logLevel === 'journal_chain'
    ? 'Open chain'
    : activeTab.logLevel === 'chain_runs'
      ? 'Open chain run'
      : activeTab.logLevel === 'flow_runs'
        ? 'Open batches'
        : activeTab.logLevel === 'flow_runs_all'
          ? 'Open batches'
          : activeTab.logLevel === 'chain_matrix'
            ? 'Set success'
            : 'Open';

  const onOpenRow2 = activeTab.logLevel === 'journal_chain'
    ? handleOpenJournalChainMatrix
    : activeTab.logLevel === 'chain_matrix'
      ? (row) => handleSetChainRunStatus(row, 'error')
      : null;

  const openButtonText2 = activeTab.logLevel === 'chain_matrix'
    ? 'Set error'
    : 'Open chain matrix222'
;

  const handlePageChange = ({ limit, offset, filterModel, withCount }) => {
    loadRows({
      limit: limit || PAGE_LIMIT,
      offset: offset || 0,
      filterModel: filterModel || {},
      withCount: Boolean(withCount),
      force: true,
      clearSelection: true
    });
  };

  return (
    <div style={{ height: '100%', padding: '10px', background: 'var(--app-bg)', overflow: 'auto' }}>
      <div style={{ color: 'var(--text)', margin: '0px', padding: '0px 0px 10px 10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span>{getLogTitle(activeTab)}</span>

        <button
          onClick={() => loadRows({ force: true })}
          disabled={state.loading}
          className="belt-button belt-button-small belt-button-success"
        >
          {state.loading ? 'Loading...' : 'Refresh table'}
        </button>
      </div>

      {state.errorText && (
        <div style={{ marginBottom: '10px', padding: '10px', border: '1px solid var(--border)', background: 'var(--workspace-bg)', color: 'var(--danger)', borderRadius: '4px' }}>
          {state.errorText}
        </div>
      )}

      <UniversalTable
        connId={activeTab.connId}
        tableName={activeTab.tableName}
        externalRows={state.rows || []}
        externalLoading={state.loading}
        totalRows={state.total}
        pageLimit={state.limit || PAGE_LIMIT}
        pageOffset={state.offset || 0}
        onPageChange={handlePageChange}
        filterModelExternal={state.filterModel || {}}
        selectedRowExternal={state.selectedRow}
        selectedCellExternal={state.selectedCell}
        onSelectedRowChange={(row) => setMonitoringTableState(activeTab.id, { selectedRow: row })}
        onSelectedCellChange={(cell) => setMonitoringTableState(activeTab.id, { selectedCell: cell })}
        preserveSelectionOnRowsChange={true}
        onOpenRow={onOpenRow}
        openButtonText={openButtonText}
        onOpenRow2={onOpenRow2}
        openButtonText2={openButtonText2}
      />
    </div>
  );
}
