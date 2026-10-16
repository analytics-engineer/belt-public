import React from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import FlowNodeLabel from '../../FlowNodeLabel';

export default function ProcessChainCanvas({
    mode,
    displayedNodes,
    displayedEdges,
    flowStatusById,
    activeTab,
    savedFlows,
    connections,
    readOnly,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeDoubleClick,
    onNodeSettings,
    apiUrl,
    chainRunId,
}) {
    const isMonitoring = mode === 'monitoring';

    const getRunStatusColor = (status) => {
        const s = String(status || '').toLowerCase();

        if (s === 'success') return 'var(--success-text)';
        if (s === 'running') return 'var(--warning-text)';
        if (s === 'error') return 'var(--danger-text)';

        return 'var(--text-muted)';
    };

    return (
        <ReactFlow
            nodes={displayedNodes.map((n) => ({
                ...n,
                style: {
                    ...n.style,
                    padding: 0,
                    border: isMonitoring && flowStatusById[String(n.data?.flow_id)]
                        ? `2px solid ${getRunStatusColor(flowStatusById[String(n.data?.flow_id)])}`
                        : '1px solid var(--border-node)',
                },
                data: {
                    ...n.data,
                    label: (
                        <FlowNodeLabel
                            node={n}
                            activeTab={activeTab}
                            savedFlows={savedFlows}
                            connections={connections}
                            mode={mode}
                            apiUrl={apiUrl}
                            chainRunId={chainRunId}
                            onNodeSettings={onNodeSettings}
                        />
                    )
                }
            }))}
            edges={displayedEdges}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={readOnly ? undefined : onConnect}
            onNodeDoubleClick={readOnly ? undefined : onNodeDoubleClick}
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            edgesUpdatable={!readOnly}
            fitView
        >
            <Background color="var(--grid)" gap={16} size={1} />
            <Controls />
        </ReactFlow>
    );
}