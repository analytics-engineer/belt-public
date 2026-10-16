import React from 'react';

export default function StartScreen({
    connections = [],
    savedFlows = [],
    savedChains = []
}) {
    return (
        <div
            style={{
                height: '100%',
                position: 'relative',
                color: 'var(--empty-text)'
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    top: '70px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 'min(800px, calc(100% - 120px))',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '16px'
                }}
            >
                <div
                    style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        padding: '18px',
                        textAlign: 'center'
                    }}
                >
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Connections</div>
                    <div style={{ fontSize: '32px', fontWeight: 500, color: 'var(--text)', marginTop: '6px' }}>
                        {connections?.length || 0}
                    </div>
                    <div style={{ fontSize: '13px', marginTop: '6px', color: 'var(--text-muted)' }}>
                    </div>
                </div>

                <div
                    style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        padding: '18px',
                        textAlign: 'center'
                    }}
                >
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Flows</div>
                    <div style={{ fontSize: '32px', fontWeight: 500, color: 'var(--text)', marginTop: '6px' }}>
                        {savedFlows?.length || 0}
                    </div>
                    <div style={{ fontSize: '13px', marginTop: '6px', color: 'var(--text-muted)' }}>
                    </div>
                </div>

                <div
                    style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        padding: '18px',
                        textAlign: 'center'
                    }}
                >
                    <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Process Chains</div>
                    <div style={{ fontSize: '32px', fontWeight: 500, color: 'var(--text)', marginTop: '6px' }}>
                        {savedChains?.length || 0}
                    </div>
                    <div style={{ fontSize: '13px', marginTop: '6px', color: 'var(--text-muted)' }}>
                    </div>
                </div>
            </div>

            <div
                style={{
                    position: 'absolute',
                    top: '48%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center'
                }}
            >
                <h1 style={{ color: 'var(--empty-title)' }}> Visual SQL ELT Tool</h1>
                <h2 style={{ color: 'var(--empty-title)' }}>No open Tabs</h2>
                <p>Select an object on the left</p>
            </div>
        </div>
    );
}