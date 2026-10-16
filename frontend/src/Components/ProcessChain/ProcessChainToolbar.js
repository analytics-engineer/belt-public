import React from 'react';
import useStore from '../../store';
import { t } from '../../i18n';

export default function ProcessChainToolbar({
    activeTab,
    isChainMonitoring,
    addNode,
    handleApplyToStore,
    saveFlow,
    runFlow
}) {
    const { setChainMonitorState, requestChainRunsRefresh, locale } = useStore();

    return (
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
            {isChainMonitoring ? (
                <>
                    <button
                        onClick={() => setChainMonitorState(activeTab.id, { mode: 'modeling' })}
                        className="belt-button belt-button-warning"
                    >
                        {t(locale, 'common.modeling')}
                    </button>

                    <button
                        onClick={() => requestChainRunsRefresh(activeTab.id)}
                        className="belt-button belt-button-warning"
                    >
                        {t(locale, 'common.refreshDay')}
                    </button>

                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>
                        Monitoring mode
                    </span>
                </>
            ) : (
                <>
                    <button onClick={() => addNode('FlowStep')}>
                        + Add Node
                    </button>

                    <div style={{ width: '1px', background: 'var(--border-strong)', margin: '0 5px' }}></div>

                    <button
                        onClick={handleApplyToStore}
                        className="belt-button belt-button-warning"
                    >
                        {t(locale, 'common.apply')}
                    </button>

                    <button onClick={saveFlow} className="belt-button belt-button-success">
                        {t(locale, 'common.save')}
                    </button>

                    <div style={{ width: '1px', background: 'var(--border-strong)', margin: '0 5px' }}></div>

                    <button
                        onClick={runFlow}
                        className="belt-button belt-button-danger_run"
                    >
                        ▶ {t(locale, 'common.run')}
                    </button>

                    <div style={{ width: '1px', background: 'var(--border-strong)', margin: '0 5px' }}></div>
                    <button
                        onClick={() => setChainMonitorState(activeTab.id, { mode: 'monitoring' })}
                        className="belt-button belt-button-warning"
                    >
                        {t(locale, 'common.monitoring')}
                    </button>
                </>
            )}
        </div>
    );
}