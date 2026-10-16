import React, { useState } from 'react';
import axios from 'axios';
import LineageViewer from './LineageViewer';
import useStore from './store';

export default function LineageTab({ API_URL, connections = [] }) {
  const lineageData = useStore((state) => state.lineageData);
  const setLineageData = useStore((state) => state.setLineageData);

  const connectionId = lineageData.connectionId || '';
  const objectName = lineageData.objectName || '';
  const canBuildLineage = Boolean(connectionId && objectName);
  const flowBlocks = lineageData.flowBlocks || [];

  const [lineageMode, setLineageMode] = useState('objects');
  const [objects, setObjects] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  const handleBuildLineage = async (mode) => {
    setLineageMode(mode);

    if (!connectionId || !objectName) {
      alert('Укажи connection_id и object_name');
      return;
    }

    setLoading(true);
    setErrorText('');

    try {
      const res = await axios.get(`${API_URL}/lineage/table`, {
        params: {
          connection_id: connectionId,
          object_name: objectName,
        },
      });

      setLineageData({
        connectionId,
        objectName,
        flowBlocks: res.data || []
      });
    } catch (err) {
      console.error(err);
      setErrorText(
        err.response?.data?.detail || err.message || 'Lineage loading error'
      );
      /*setLineageData({ flowBlocks: [] });*/
    } finally {
      setLoading(false);
    }
  };

  const loadObjects = async () => {
    if (!connectionId) return;

    setLoadingObjects(true);
    setErrorText('');

    try {
      const res = await axios.get(`${API_URL}/lineage/objects`, {
        params: { connection_id: connectionId }
      });
      setObjects(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setErrorText(err.response?.data?.detail || err.message);
    } finally {
      setLoadingObjects(false);
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

  const lineageButtons = [
    { mode: 'objects', label: loading && lineageMode === 'objects' ? 'Loading...' : 'Object Lineage' },
    { mode: 'flows', label: loading && lineageMode === 'flows' ? 'Loading...' : 'Flow Lineage' },
    { mode: 'detailed', label: loading && lineageMode === 'detailed' ? 'Loading...' : 'Detailed Lineage' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px', background: 'var(--app-bg)', color: 'var(--text)' }}>
    <div style={{ display: 'flex', gap: '12px', alignItems: 'end', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ marginBottom: '5px', fontSize: '12px', color: 'var(--text-muted)' }}>Connection</div>
          <select
            value={connectionId}
            onChange={(e) => {
              setLineageData({
                connectionId: e.target.value,
                objectName: ''
              });
              setObjects([]);
            }}
            style={selectStyle}
          >
            <option value="">Select connection</option>
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
            value={objectName}
            onFocus={loadObjects}
            onChange={(e) => setLineageData({ objectName: e.target.value })}
            style={selectStyle}
            disabled={!connectionId}
          >
            <option value="">{loadingObjects ? 'Loading...' : 'Select object'}</option>
            {objects.map((obj) => (
              <option key={obj.object_name} value={obj.object_name}>
                {obj.object_name}
              </option>
            ))}
          </select>
        </div>

        {lineageButtons.map((button) => (
          <button
            key={button.mode}
            type="button"
            onClick={() => handleBuildLineage(button.mode)}
            disabled={!canBuildLineage || loading}
            className="belt-button"
          >
            {button.label}
          </button>
        ))}

        {flowBlocks.length > 0 && (
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Flows count: {flowBlocks.length}
          </span>
        )}
      </div>

      {errorText && (
        <div style={{ color: '#ff7777', marginBottom: 8 }}>
          {errorText}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 500 }}>
        <LineageViewer
          flowBlocks={flowBlocks}
          connections={connections}
          mode={lineageMode}
        />
      </div>
    </div>
  );
}
