import React, { useEffect, useState } from 'react';
import UniversalTable from './UniversalTable';
import useStore from './store';
import { t } from './i18n';

const PAGE_LIMIT = 100;

export default function OperationsTab({ API_URL }) {
  const operationsData = useStore((state) => state.operationsData);
  const setOperationsData = useStore((state) => state.setOperationsData);
  const locale = useStore((state) => state.locale);

  const connections = useStore((state) => state.connectionsList);
  const setConnections = useStore((state) => state.setConnectionsList);
  const objects = useStore((state) => state.objectsList);
  const setObjects = useStore((state) => state.setObjectsList);

  const selectedRequest = useStore((state) => state.operationsSelectedRequest);

  const clearOperationsSelectedRequest = useStore((state) => state.clearOperationsSelectedRequest);
  const detailsRequest = useStore((state) => state.operationsDetailsRequest);
  const setOperationsDetailsRequest = useStore((state) => state.setOperationsDetailsRequest);
  const clearOperationsDetailsRequest = useStore((state) => state.clearOperationsDetailsRequest);

  const [selectedConnectionId, setSelectedConnectionId] = useState(
    operationsData?.connectionId ? String(operationsData.connectionId) : ''
  );
  const [selectedObject, setSelectedObject] = useState(
    operationsData?.target || ''
  );

  const [loadingConnections, setLoadingConnections] = useState(false);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    if (operationsData) {
      setSelectedConnectionId(operationsData.connectionId ? String(operationsData.connectionId) : '');
      setSelectedObject(operationsData.target || '');
    }
  }, [operationsData]);

  const loadConnections = async () => {
    if (connections.length > 0) return;

    setLoadingConnections(true);
    setErrorText('');

    try {
      const res = await fetch(`${API_URL}/operations/connections`);
      if (!res.ok) throw new Error(`Error: ${res.status}`);

      const data = await res.json();
      setConnections(Array.isArray(data) ? data : []);
    } catch (e) {
      setErrorText(String(e.message || e));
    } finally {
      setLoadingConnections(false);
    }
  };

  const loadObjects = async () => {
    if (!selectedConnectionId || objects.length > 0) return;

    setLoadingObjects(true);
    setErrorText('');

    try {
      const res = await fetch(
        `${API_URL}/operations/objects?connection_id=${encodeURIComponent(selectedConnectionId)}`
      );

      if (!res.ok) throw new Error(`Error: ${res.status}`);

      const data = await res.json();
      setObjects(Array.isArray(data) ? data : []);
    } catch (e) {
      setErrorText(String(e.message || e));
    } finally {
      setLoadingObjects(false);
    }
  };

  const handleConnectionChange = (value) => {
    setSelectedConnectionId(value);
    setSelectedObject('');
    setObjects([]);
    setErrorText('');
  };

  const buildRequestsUrl = ({ limit, offset, filterModel, withCount = false }) => {
    const url = new URL(`${API_URL}/operations/requests`, window.location.origin);

    url.searchParams.set('connection_id', selectedConnectionId);
    url.searchParams.set('target', selectedObject);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('_ts', String(Date.now()));

    if (filterModel && Object.keys(filterModel).length > 0) {
      url.searchParams.set('filters', JSON.stringify(filterModel));
    }

    if (withCount) {
      url.searchParams.set('with_count', '1');
    }

    return url.toString();
  };

  const loadRequests = async ({
    limit = PAGE_LIMIT,
    offset = 0,
    withCount = false,
    filterModel = {}
  } = {}) => {
    if (!selectedConnectionId || !selectedObject) return;

    const safeLimit = limit || PAGE_LIMIT;
    const safeOffset = Math.max(0, offset || 0);

    try {
      setLoadingRequests(true);
      setErrorText('');

      const res = await fetch(
        buildRequestsUrl({
          limit: safeLimit,
          offset: safeOffset,
          filterModel,
          withCount
        })
      );

      if (!res.ok) throw new Error(`Error: ${res.status}`);

      const data = await res.json();

      const rows = Array.isArray(data)
        ? data
        : (Array.isArray(data.rows) ? data.rows : []);

      const responseTotal = Array.isArray(data) ? null : data.total;

      const sameFilter =
        JSON.stringify(operationsData?.filterModel || {}) === JSON.stringify(filterModel || {});

      const nextTotal =
        responseTotal !== null && responseTotal !== undefined
          ? responseTotal
          : (sameFilter ? operationsData?.total ?? null : null);

      clearOperationsSelectedRequest();
      clearOperationsDetailsRequest();

      setOperationsData({
        connectionId: selectedConnectionId,
        target: selectedObject,
        rows,
        total: nextTotal,
        limit: safeLimit,
        offset: safeOffset,
        filterModel,
        loadedAt: new Date().toISOString()
      });
    } catch (e) {
      setErrorText(String(e.message || e));
    } finally {
      setLoadingRequests(false);
    }
  };

  const handleRequestsPageChange = ({ limit, offset, filterModel, withCount }) => {
    loadRequests({
      limit: limit || PAGE_LIMIT,
      offset: offset || 0,
      filterModel: filterModel || {},
      withCount: Boolean(withCount)
    });
  };

  const handleDeleteClick = async () => {
    if (!operationsData?.connectionId || !operationsData?.target) return;

    const isSingleRequest = Boolean(selectedRequest);

    const message = isSingleRequest
      ? `Delete selected request?

Request ID: ${selectedRequest.request_id}`
      : `Delete all data for this object?`;

    if (!window.confirm(message)) return;

    try {
      setErrorText('');

      const url = isSingleRequest
        ? `${API_URL}/operations/delete-requests`
        : `${API_URL}/operations/delete-all`;

      const body = isSingleRequest
        ? {
          connection_id: operationsData.connectionId,
          target: operationsData.target,
          request_ids: [String(selectedRequest.request_id)]
        }
        : {
          connection_id: operationsData.connectionId,
          target: operationsData.target
        };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const detail = errorData.detail;

        if (typeof detail === 'object' && detail !== null) {
          throw new Error(detail.message || JSON.stringify(detail));
        }

        throw new Error(detail || `Deletion error: ${res.status}`);
      }

      clearOperationsSelectedRequest();
      clearOperationsDetailsRequest();

      await loadRequests({
        limit: operationsData.limit || PAGE_LIMIT,
        offset: isSingleRequest ? (operationsData.offset || 0) : 0,
        filterModel: operationsData.filterModel || {}
      });
    } catch (e) {
      console.error(e);
      setErrorText(String(e.message || e));
    }
  };

  const selectStyle = {
    width: '280px',
    background: 'var(--input-bg)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    padding: '6px'
  };

  return (
    <div style={{ height: '100%', padding: '10px', background: 'var(--app-bg)', color: 'var(--text)', overflow: 'auto' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'end', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ marginBottom: '5px', fontSize: '12px', color: 'var(--text-muted)' }}>Connection</div>
          <select
            value={selectedConnectionId}
            onFocus={loadConnections}
            onChange={(e) => handleConnectionChange(e.target.value)}
            style={selectStyle}
          >
            <option value="">{loadingConnections ? 'Loading...' : 'Select connection'}</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} {c.name ? `/ ${c.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ marginBottom: '5px', fontSize: '12px', color: 'var(--text-muted)' }}>Object</div>
          <select
            value={selectedObject}
            onFocus={loadObjects}
            onChange={(e) => setSelectedObject(e.target.value)}
            style={selectStyle}
            disabled={!selectedConnectionId}
          >
            <option value="">{loadingObjects ? 'Loading...' : 'Select object'}</option>
            {objects.map((obj) => (
              <option key={obj.target} value={obj.target}>
                {obj.target}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => loadRequests({ limit: PAGE_LIMIT, offset: 0, filterModel: {} })}
          disabled={!selectedConnectionId || !selectedObject || loadingRequests}
          className="belt-button"
        >
          {loadingRequests ? 'Loading...' : t(locale, 'common.loadrequests')}
        </button>

        <button
          onClick={() => {
            if (!selectedRequest) return;
            setOperationsDetailsRequest(selectedRequest);
          }}
          disabled={!selectedRequest}
          className="belt-button"
        >
          {t(locale, 'common.loaddetails')}
        </button>

        <div style={{ width: '1px', background: 'var(--border)', height: '28px', margin: '0 10px' }}></div>

        <button
          onClick={handleDeleteClick}
          disabled={!selectedConnectionId || !selectedObject}
          className = "belt-button belt-button-danger"
        >
          {t(locale, 'common.delete')}
        </button>
      </div>

      {errorText && (
        <div style={{ marginBottom: '15px', padding: '10px', border: '1px solid var(--border)', background: 'var(--workspace-bg)', color: 'var(--danger)', borderRadius: '4px' }}>
          {errorText}
        </div>
      )}

      {operationsData?.rows ? (
        <UniversalTable
          externalRows={operationsData.rows}
          syncOperationsSelection={true}
          totalRows={operationsData.total}
          pageLimit={operationsData.limit || PAGE_LIMIT}
          pageOffset={operationsData.offset || 0}
          onPageChange={handleRequestsPageChange}
        />
      ) : (
        <div>Select connection and object, then press Load requests</div>
      )}

      {detailsRequest?.request_id && (
        <div style={{
          marginTop: '10px',
          marginBottom: '30px',
          borderTop: '2px solid var(--border)',
          background: 'var(--workspace-bg)'
        }}>
          <div style={{
            padding: '4px 0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: 'var(--text)'
          }}>
            <span style={{ fontSize: '12px' }}>
              Request: {detailsRequest.request_id}
            </span>

            <button
              onClick={clearOperationsDetailsRequest}
              style={{
                cursor: 'pointer',
                background: '#fff',
                border: '1px',
                color: 'var(--danger)'
              }}
            >
              ✕
            </button>
          </div>

          <UniversalTable
            key={detailsRequest.request_id}
            endpointUrl={`${API_URL}/operations/request_detailed?connection_id=${encodeURIComponent(operationsData.connectionId)}&target=${encodeURIComponent(operationsData.target)}&request_id=${encodeURIComponent(detailsRequest.request_id)}`}
          />
        </div>
      )}
    </div>
  );
}