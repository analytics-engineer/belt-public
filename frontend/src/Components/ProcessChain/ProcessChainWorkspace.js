import React from 'react';
import ChainRunsArchive from '../Monitoring/ChainRunsArchive';
import ProcessChainCanvas from './ProcessChainCanvas';
import ProcessChainToolbar from './ProcessChainToolbar';
import useStore from '../../store';
import { t } from '../../i18n';

export default function ProcessChainWorkspace({
  activeTab,
  isChainMonitoring,
  activeChainId,
  chainSchedule,
  cronExpr,
  setCronExpr,
  cronLoading,
  saveCron,
  pauseCron,
  enableCron,
  chainMonitorState,
  setChainMonitorState,
  displayedNodes,
  displayedEdges,
  flowStatusById,
  savedFlows,
  connections,
  isReadOnlyCanvas,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeDoubleClick,
  onNodeSettings,
  chainSettingsNode,
  onCloseNodeSettings,
  updateNodeData,
  addNode,
  handleApplyToStore,
  saveFlow,
  runFlow,
  apiUrl
}) {
  const { locale } = useStore();
  return (
    <>
      <ProcessChainToolbar
        activeTab={activeTab}
        isChainMonitoring={isChainMonitoring}
        addNode={addNode}
        handleApplyToStore={handleApplyToStore}
        saveFlow={saveFlow}
        runFlow={runFlow}
      />

      <div
        style={{
          position: 'absolute',
          top: 15,
          right: 15,
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--button-area)',
            padding: '8px',
            borderRadius: '5px',
            border: '1px solid var(--border)'
          }}
        >
          {!activeChainId ? (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Save chain before cron setup
            </span>
          ) : (
            <>
              <span
                style={{
                  fontSize: '12px',
                  color: chainSchedule?.enabled ? 'var(--success-text)' : 'var(--text-muted)'
                }}
              >
                {chainSchedule?.configured
                  ? chainSchedule.enabled
                    ? 'Cron active'
                    : 'Cron paused'
                  : 'Cron not configured'}
              </span>

              <input
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 2 * * *"
                style={{
                  width: '120px',
                  padding: '4px',
                  background: 'var(--workspace-bg)',
                  color: 'var(--text)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '3px'
                }}
              />

              <button onClick={saveCron} disabled={cronLoading}>
                {t(locale, 'common.save')}
              </button>

              {chainSchedule?.enabled ? (
                <button onClick={pauseCron} disabled={cronLoading}>
                  {t(locale, 'common.pause')}
                </button>
              ) : (
                <button onClick={enableCron} disabled={cronLoading}>
                  <span style={{color: 'var(--text-muted)'}}> ▶ </span> {t(locale, 'common.cron')}
                </button>
              )}
            </>
          )}
        </div>

        {chainSchedule?.enabled && chainSchedule?.next_run_at && (
          <div
            style={{
              marginTop: '3px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap'
            }}
          >
            Next run at: {new Date(chainSchedule.next_run_at).toLocaleString()}
          </div>
        )}
      </div>

      {chainSettingsNode && (
        <div
          style={{
            position: 'absolute',
            top: 95,
            right: 15,
            width: 320,
            zIndex: 7,
            background: 'var(--canvas-bg)',
            border: '1px solid var(--border)',
            borderRadius: '5px',
            color: 'var(--text)',
            padding: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-muted)' }}>{chainSettingsNode.id}</span>
            <button
              type="button"
              onClick={onCloseNodeSettings}
              aria-label="Close node settings"
              title="Close"
              style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
            >
              ×
            </button>
          </div>

          <label style={{ display: 'block', marginBottom: '8px' }}>Process type:</label>
          <select
            value={chainSettingsNode.data?.step_type || 'flow'}
            onChange={(event) => updateNodeData(chainSettingsNode.id, 'step_type', event.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', marginBottom: '16px', background: 'var(--input-bg)', color: 'var(--text)', border: '1px solid var(--border-strong)' }}
          >
            <option value="flow">flow</option>
          </select>

          <label style={{ display: 'block', marginBottom: '8px' }}>ID:</label>
          <input
            type="text"
            value={chainSettingsNode.data?.flow_id || ''}
            onChange={(event) => updateNodeData(chainSettingsNode.id, 'flow_id', event.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px',
              marginBottom: '16px',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              border: '1px solid var(--border-strong)'
            }}
          />

          <button
            type="button"
            className="belt-button"
            onClick={onCloseNodeSettings}
            style={{
              background: 'var(--border-strong)',
              color: 'var(--text)',
              border: '1px solid var(--border-strong)'
            }}
          >
            Apply
          </button>
        </div>
      )}

      {isChainMonitoring && (
        <div
          style={{
            position: 'absolute',
            top: 70,
            left: 15,
            bottom: 135,
            width: 260,
            zIndex: 6,
            background: 'var(--canvas-bg)',
            border: '1px solid var(--border)',
            borderRadius: '5px',
            color: 'var(--text)',
            padding: '8px'
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            Chain Runs
          </div>

          <ChainRunsArchive
            activeTabId={activeTab.id}
            activeChainId={activeChainId}
            chainMonitorState={chainMonitorState}
            setChainMonitorState={setChainMonitorState}
            apiUrl={apiUrl}
          />
        </div>
      )}

      <ProcessChainCanvas
        mode={isChainMonitoring ? 'monitoring' : 'modeling'}
        displayedNodes={displayedNodes}
        displayedEdges={displayedEdges}
        flowStatusById={flowStatusById}
        activeTab={activeTab}
        savedFlows={savedFlows}
        connections={connections}
        readOnly={isReadOnlyCanvas}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeSettings={onNodeSettings}
        apiUrl={apiUrl}
        chainRunId={chainMonitorState?.selectedRunId}
      />
    </>
  );
}