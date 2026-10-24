import React, { useState, useEffect } from 'react';
import useStore from './store';
import { t } from './i18n';

import {
  normalizeConnectionType,
  getSelectedConnection
} from './nodeSettings/connectionTypes';
import PostgresTargetFields from './nodeSettings/fields/PostgresTargetFields';
import ClickHouseTargetFields from './nodeSettings/fields/ClickHouseTargetFields';
import PostgresSourceFields from './nodeSettings/fields/PostgresSourceFields';
import PythonSourceFields from './nodeSettings/fields/PythonSourceFields';
import PostgresTransformationSourceFields from './nodeSettings/fields/PostgresTransformationSourceFields';
import PostgresTransformationTargetFields from './nodeSettings/fields/PostgresTransformationTargetFields';
import ClickHouseTransformationSourceFields from './nodeSettings/fields/ClickHouseTransformationSourceFields';
import ClickHouseTransformationTargetFields from './nodeSettings/fields/ClickHouseTransformationTargetFields';
import SqlEditor from './nodeSettings/fields/SqlEditor';
import UniversalTable from './UniversalTable';

const NodeSettings = ({ activeTab, connections }) => {
  const {
    tabs,
    updateNodeInFlow,
    locale,
    nodeSettingsSqlPreview,
    setNodeSettingsSqlPreview
  } = useStore();

  // 1. Look for the parent flow in the store, not in props
  const parentFlow = tabs.find(t => t.id === activeTab.parentFlowId);

  // 2. Look for the node inside that flow's data
  const node = parentFlow?.data?.nodes?.find(n => n.id === activeTab.nodeId);

  // 3. Local state for the form
  const [formData, setFormData] = useState(node ? node.data : {});
  const [pythonFiles, setPythonFiles] = useState([]);
  const [pythonUploadFile, setPythonUploadFile] = useState(null);
  const [pythonUploadPath, setPythonUploadPath] = useState('');
  const [loadingTargetColumns, setLoadingTargetColumns] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);
  const sqlPreviewState = nodeSettingsSqlPreview[activeTab.id] || {
    rows: [],
    open: false,
    loading: false,
    error: ''
  };
  const {
    rows: sqlPreviewRows,
    open: sqlPreviewOpen,
    loading: sqlPreviewLoading,
    error: sqlPreviewError
  } = sqlPreviewState;

  const updateSqlPreview = (patch) => {
    setNodeSettingsSqlPreview(activeTab.id, patch);
  };

  // Important: if the node in the store was updated, sync the local state
  useEffect(() => {
    if (node) {
      setFormData(node.data);
    }
  }, [node]);

  useEffect(() => {
    const selected = connections.find(
      (c) => String(c.id) === String(formData.connection_id)
    );

    if (normalizeConnectionType(selected?.connection_type) !== 'python') {
      setPythonFiles([]);
      return;
    }

    const apiUrl = ["3000", "5173"].includes(window.location.port)
      ? `http://${window.location.hostname}:8000`
      : "/api";

    fetch(`${apiUrl}/workspace/python-files`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => setPythonFiles(data))
      .catch((e) => {
        console.error("Error loading python files:", e);
        setPythonFiles([]);
      });
  }, [formData.connection_id, connections]);

  if (!node) return <div style={{ padding: '20px', color: 'var(--text)' }}>Node not found or flow closed</div>;

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleApply = () => {
    updateNodeInFlow(activeTab.parentFlowId, activeTab.nodeId, formData);
    alert("Saved to the flow model");
  };

  const handlePreviewSql = async () => {
    updateSqlPreview({ rows: [], error: '', open: true, loading: false });

    const connectionId = transformOutputNode?.data?.connection_id;
    if (!connectionId) {
      updateSqlPreview({ error: 'No target connection selected for transformation' });
      return;
    }

    if (transformSqlDialect !== 'postgres') {
      updateSqlPreview({ error: 'SQL preview with pre-hook is currently supported only for PostgreSQL' });
      return;
    }

    if (!String(formData.sql || '').trim()) {
      updateSqlPreview({ error: 'SQL query is empty' });
      return;
    }

    updateSqlPreview({ loading: true });

    try {
      const response = await fetch(`${getApiUrl()}/transformation/preview-sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: Number(connectionId),
          connection_type: transformSqlDialect,
          sql: formData.sql
        })
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || `HTTP ${response.status}`);
      }

      updateSqlPreview({ rows: Array.isArray(result.rows) ? result.rows : [] });
    } catch (error) {
      updateSqlPreview({ rows: [], error: error.message || 'SQL preview execution error' });
    } finally {
      updateSqlPreview({ loading: false });
    }
  };

  const getApiUrl = () =>
    ["3000", "5173"].includes(window.location.port)
      ? `http://${window.location.hostname}:8000`
      : "/api";

  const reloadPythonFiles = async () => {
    const res = await fetch(`${getApiUrl()}/workspace/python-files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setPythonFiles(data);
    return data;
  };

  const handleUploadPythonFile = async () => {
    if (!pythonUploadFile) {
      alert("Select .py file");
      return;
    }

    if (!pythonUploadPath) {
      alert("Input save path, for example api_sources/test_source.py");
      return;
    }

    const apiUrl = ["3000", "5173"].includes(window.location.port)
      ? `http://${window.location.hostname}:8000`
      : "/api";

    const upload = async (overwrite) => {
      const fd = new FormData();
      fd.append("file", pythonUploadFile);
      fd.append("relative_path", pythonUploadPath);
      fd.append("overwrite", overwrite ? "true" : "false");

      return fetch(`${apiUrl}/workspace/upload-python`, {
        method: "POST",
        body: fd
      });
    };

    try {
      let res = await upload(false);
      let data = await res.json();

      if (res.status === 409) {
        const ok = window.confirm("File already exists. Overwrite?");
        if (!ok) return;

        res = await upload(true);
        data = await res.json();
      }

      if (!res.ok) {
        throw new Error(data.detail || `HTTP ${res.status}`);
      }

      const listRes = await fetch(`${apiUrl}/workspace/python-files`);
      const listData = await listRes.json();
      setPythonFiles(listData);

      handleChange("script_path", data.path);

      alert("Python file uploaded");
    } catch (e) {
      alert(`Upload error: ${e.message}`);
    }
  };

  const TIMEZONES = [
    'UTC',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Yekaterinburg',
    'Asia/Novosibirsk',
    'Asia/Vladivostok'
  ];

  const handleLoadColumns = async () => {
    if (loadingColumns) return;

    if (!formData.connection_id || !formData.table_name) {
      alert("Input Connection and Source table name");
      return;
    }

    setLoadingColumns(true);

    try {
      const apiUrl = ["3000", "5173"].includes(window.location.port)
        ? `http://${window.location.hostname}:8000`
        : "/api";

      const res = await fetch(`${apiUrl}/connections/${formData.connection_id}/columns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          schema_name: formData.schema_name || null,
          table_name: formData.table_name || null
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const columns = await res.json();

      if (!Array.isArray(columns)) {
        throw new Error("Backend returned not array");
      }

      const filteredColumns = columns.filter(
        col => !["tech_request_id", "tech_batch_id"].includes(String(col).toLowerCase())
      );

      if (!filteredColumns.length) {
        alert("No business columns found");
        return;
      }

      handleChange("columns", filteredColumns.join(", "));
    } catch (e) {
      alert(`Error load columns: ${e.message}`);
    } finally {
      setTimeout(() => setLoadingColumns(false), 500);
    }
  };

  const handleLoadTargetColumns = async () => {
    if (loadingTargetColumns) return;

    if (!formData.connection_id || !formData.target_table) {
      alert("Input Connection and Target table name");
      return;
    }

    setLoadingTargetColumns(true);

    try {
      const apiUrl = ["3000", "5173"].includes(window.location.port)
        ? `http://${window.location.hostname}:8000`
        : "/api";

      const res = await fetch(`${apiUrl}/connections/${formData.connection_id}/columns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          schema_name: formData.schema_name || null,
          table_name: formData.target_table || null
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const columns = await res.json();

      console.log("LOAD COLUMNS RESPONSE:", columns);

      if (!Array.isArray(columns)) {
        throw new Error("Backend returned not array");
      }

      const filteredColumns = columns.filter(
        col => !["tech_request_id", "tech_batch_id"].includes(String(col).toLowerCase())
      );

      if (!filteredColumns.length) {
        alert("No business columns found");
        return;
      }

      handleChange("columns", filteredColumns.join(", "));
    } catch (e) {
      alert(`Error load target columns: ${e.message}`);
    } finally {
      setLoadingTargetColumns(false);
    }
  };

  const selectedConnection = getSelectedConnection(connections, formData.connection_id);
  const connectionType = normalizeConnectionType(selectedConnection?.connection_type);

  const isInputNode = node?.type === 'input';
  const isOutputNode = node?.type === 'output';

  const showConnection = !(
    activeTab?.flow_type === 'process_chain' ||
    (
      activeTab?.flow_type === 'transformation' &&
      node?.type === 'default'
    )
  );

  const isPostgresSource = isInputNode && connectionType === 'postgres';
  const isPythonSource = isInputNode && connectionType === 'python';

  const isPostgresTarget = isOutputNode && connectionType === 'postgres';
  const isClickHouseTarget = isOutputNode && connectionType === 'clickhouse';
  const isClickHouseSource = isInputNode && connectionType === 'clickhouse';

  // SQL dialect for the transform node's editor is driven by the flow's target connection.
  const transformOutputNode = parentFlow?.data?.nodes?.find((n) => n.type === 'output');
  const transformOutputConnection = getSelectedConnection(connections, transformOutputNode?.data?.connection_id);
  const transformSqlDialect = normalizeConnectionType(transformOutputConnection?.connection_type);

  const allowPythonConnection =
    activeTab?.flow_type === 'integration' && node?.type === 'input';

  const allowClickhouseConnection =
    activeTab?.flow_type === 'integration' && node?.type === 'input';

  const connectionOptions = connections.filter((c) => {
    const type = normalizeConnectionType(c.connection_type);

    if (type === 'python' && !allowPythonConnection) return false;
    if (type === 'clickhouse' && allowClickhouseConnection) return false;

    return true;
  });

  const handleDownloadPythonFile = async () => {
    if (!formData.script_path) {
      alert("Select python file");
      return;
    }

    try {
      // Direct navigation does not pass the Authorization header, so we load the file via fetch
      // and trigger the download from a blob instead.
      const response = await fetch(
        `${getApiUrl()}/workspace/download-python?path=${encodeURIComponent(formData.script_path)}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = formData.script_path.split('/').pop();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert(`Could not download file: ${err.message}`);
    }
  };

  const handleDeletePythonFile = async () => {
    if (!formData.script_path) {
      alert("Select python file");
      return;
    }

    const ok = window.confirm(
      `Delete file?\n\n${formData.script_path}\n\nIf it is used in a flow, the run will fail.`
    );

    if (!ok) return;

    try {
      const res = await fetch(
        `${getApiUrl()}/workspace/delete-python?path=${encodeURIComponent(formData.script_path)}`,
        { method: "DELETE" }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || `HTTP ${res.status}`);
      }

      const listRes = await fetch(`${getApiUrl()}/workspace/python-files`);
      const listData = await listRes.json();
      setPythonFiles(listData);

      handleChange("script_path", "");

      alert("Python file deleted");
    } catch (e) {
      alert(`Delete error: ${e.message}`);
    }
  };

  const getFlowTypeName = (type) => {
    const names = {
      integration: 'Integration',
      transformation: 'Transformation',
      process_chain: 'Process Chain',
      'process-chain': 'Process Chain',
      chain: 'Process Chain'
    };

    if (!type) return '';

    return names[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };

  const activeFlowTypeName = getFlowTypeName(
    activeTab?.flow_type || activeTab?.type
  );



  return (
    /*<div style={{ padding: '50px 30px', maxWidth: '600px', color: 'var(--text)' }}>*/
    <div style={{ padding: '50px 30px', width: '100%', height: '100%', maxWidth: 'none', boxSizing: 'border-box', overflowY: 'auto', color: 'var(--text)' }}>
      <div style={{ margin: '25px 0 8px' }}> <span style={{ fontWeight: '600' }}>{activeFlowTypeName}: </span> {parentFlow?.title} <span>➜</span> {node.data.label}</div>

      {showConnection && (
        <div style={{ marginBottom: '20px', width: '600px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Connection:</label>
          <select
            value={formData.connection_id || ''}
            onChange={(e) => handleChange('connection_id', e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              border: '1px solid var(--border-strong)'
            }}
          >
            <option value="">Select connection...</option>
            {connectionOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {activeTab.flow_type === 'process_chain' && (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: '600px 600px', gap: '40px', alignItems: 'start'
          }}>
            <div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  Process type:
                </label>
                <select
                  value={formData.step_type || 'flow'}
                  onChange={(e) => handleChange('step_type', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border-strong)'
                  }}
                >
                  <option value="flow">flow</option>
                </select>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  Flow ID:
                </label>
                <input
                  type="text"
                  value={formData.flow_id || ''}
                  onChange={(e) => handleChange('flow_id', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border-strong)'
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab.flow_type === 'transformation' && node?.type === 'input' && (
        <>
          {isPostgresSource && (
            <PostgresTransformationSourceFields
              formData={formData}
              handleChange={handleChange}
            />
          )}
          {isClickHouseSource && (
            <ClickHouseTransformationSourceFields
              formData={formData}
              handleChange={handleChange}
            />
          )}
        </>
      )}

      {activeTab.flow_type === 'transformation' && node?.type === 'default' && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <SqlEditor
              value={formData.sql || ''}
              onChange={(value) => handleChange('sql', value)}
              connectionType={transformSqlDialect}
              label={t(locale, 'common.sqlQuery')}
            />
            <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {`Use condition {where_cond_source} for every batch. For example: SELECT * FROM public.sales WHERE {where_cond_source}`}
            </span>
            {sqlPreviewOpen && (
              <div style={{ marginTop: '15px', border: '1px solid var(--border)', padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span>{t(locale, 'common.sqlResult')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      updateSqlPreview({ open: false, rows: [], error: '', loading: false });
                    }}
                    aria-label={t(locale, 'common.closeSqlResult')}
                    title={t(locale, 'common.close')}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text)',
                      fontSize: '20px',
                      cursor: 'pointer',
                      lineHeight: 1
                    }}
                  >
                    ×
                  </button>
                </div>
                {sqlPreviewError && (
                  <div style={{ color: 'var(--danger, #ff6b6b)', marginBottom: '10px', whiteSpace: 'pre-wrap' }}>
                    {sqlPreviewError}
                  </div>
                )}
                {!sqlPreviewError && (
                  <UniversalTable
                    externalRows={sqlPreviewRows}
                    externalLoading={sqlPreviewLoading}
                  />
                )}
              </div>
            )}
          </div>
        </>
      )
      }

      {activeTab.flow_type === 'transformation' && node?.type === 'output' && (
        <>
          {isPostgresTarget && (
            <PostgresTransformationTargetFields
              formData={formData}
              handleChange={handleChange}
              handleLoadTargetColumns={handleLoadTargetColumns}
              loadingTargetColumns={loadingTargetColumns}
            />
          )}
          {isClickHouseTarget && (
            <ClickHouseTransformationTargetFields
              formData={formData}
              handleChange={handleChange}
              handleLoadTargetColumns={handleLoadTargetColumns}
              loadingTargetColumns={loadingTargetColumns}
            />
          )}
        </>
      )}

      {activeTab.flow_type === 'integration' && node?.type === 'input' && (
        <>
          {isPostgresSource && (
            <PostgresSourceFields
              formData={formData}
              handleChange={handleChange}
              handleLoadColumns={handleLoadColumns}
              loadingColumns={loadingColumns}
              TIMEZONES={TIMEZONES}
            />
          )}

          {isPythonSource && (
            <PythonSourceFields
              formData={formData}
              handleChange={handleChange}
              pythonFiles={pythonFiles}
              pythonUploadPath={pythonUploadPath}
              setPythonUploadPath={setPythonUploadPath}
              setPythonUploadFile={setPythonUploadFile}
              handleUploadPythonFile={handleUploadPythonFile}
              handleDownloadPythonFile={handleDownloadPythonFile}
              handleDeletePythonFile={handleDeletePythonFile}
              TIMEZONES={TIMEZONES}
            />
          )}
        </>
      )}

      {activeTab.flow_type === 'integration' && node?.type === 'output' && (
        <>
          {isPostgresTarget && (
            <PostgresTargetFields
              formData={formData}
              handleChange={handleChange}
              handleLoadTargetColumns={handleLoadTargetColumns}
              loadingTargetColumns={loadingTargetColumns}
              showColumns={false}
              showPostgresOptions={false}
            />
          )}

          {isClickHouseTarget && (
            <ClickHouseTargetFields
              formData={formData}
              handleChange={handleChange}
              showColumns={false}
            />
          )}
        </>
      )}



      <div style={{
        position: 'absolute',
        top: 15,
        left: 15,
        zIndex: 5,
        display: 'flex',
        gap: '10px',
        background: 'var(--button-area)',
        padding: '8px',
        borderRadius: '5px',
        border: '1px solid var(--border)'
      }}>
        <button
          onClick={handleApply}
          className="belt-button belt-button-warning"
        >
          {t(locale, 'common.apply')}
        </button>
        {activeTab.flow_type === 'transformation' && node?.type === 'default' && (
          <div style={{ width: '1px', background: 'var(--border)', height: '20px', margin: '0 2px' }}></div>
        )}
        {activeTab.flow_type === 'transformation' && node?.type === 'default' && (
          <button
            type="button"
            onClick={handlePreviewSql}
            disabled={sqlPreviewLoading}
            className="belt-button belt-button-warning"
          >
            {sqlPreviewLoading ? t(locale, 'common.sqlExecuting') : t(locale, 'common.sqlTest')}
          </button>
        )}
      </div>

    </div >
  );
};

export default NodeSettings;