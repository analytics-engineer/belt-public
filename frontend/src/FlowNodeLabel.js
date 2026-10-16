import React from 'react';
import NodeActionButtons from './NodeActionButtons';
import useStore from './store';

export default function FlowNodeLabel({ node, activeTab, savedFlows, connections = [], mode = 'modeling', apiUrl, chainRunId, onNodeSettings }) {
  const isProcessChain = activeTab?.flow_type === 'process_chain';
  const isSource = !isProcessChain && node.type === 'input';
  const isTarget = !isProcessChain && node.type === 'output';
  const isSourceOrTarget = isSource || isTarget;
  const isMonitoring = mode === 'monitoring';
  const openNodeSettingsTab = useStore((state) => state.openNodeSettingsTab);
  const openChainNodeFlowMonitoringTab = useStore((state) => state.openChainNodeFlowMonitoringTab);
  const openFlowObjectFromNode = useStore((state) => state.openFlowObjectFromNode);

  const linkedFlow = isProcessChain
    ? savedFlows.find((f) => String(f.id) === String(node.data?.flow_id))
    : null;

  const flowId = node.data?.flow_id;

  const displayLabel = isProcessChain && linkedFlow
    ? linkedFlow.name
    : node.data?.label;



  const nodeConnection = connections.find(
    (c) => String(c.id) === String(node.data?.connection_id)
  );

  const connectionType = nodeConnection?.connection_type || '';

  const connectionBadge = isSourceOrTarget && node.data?.connection_id
    ? `${node.data.connection_id}-${connectionType}`
    : null;

  const modeBadge = isSource && node.data?.mode
    ? node.data.mode
    : null;

  const objectName = isSource
    ? [node.data?.schema_name, node.data?.table_name].filter(Boolean).join('.')
    : isTarget
      ? [node.data?.schema_name, node.data?.target_table].filter(Boolean).join('.')
      : '';

  const objectBadge = isSourceOrTarget && objectName
    ? objectName
    : null;

  const baseBadgeStyle = {
    fontSize: '7px',
    lineHeight: '10px',
    padding: '0 4px',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
    maxWidth: '70px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontWeight: 400,
    letterSpacing: '0.1px'
  };

  const connectionBadgeStyle = {
    ...baseBadgeStyle,
    color: 'rgba(0, 0, 0, 0.55)',
    background: '#fff',
    border: '1px solid #d8d2d2'
  };

  const modeBadgeStyle = {
    ...baseBadgeStyle,
    color: modeBadge === 'delta'
      ? 'rgba(45, 130, 70, 0.75)'
      : 'rgba(41, 87, 155, 0.75)',
    background: modeBadge === 'delta'
      ? 'rgba(46, 160, 67, 0.08)'
      : 'rgba(37, 120, 236, 0.08)',
    border: modeBadge === 'delta'
      ? '1px solid rgba(46, 160, 67, 0.14)'
      : '1px solid rgba(56, 139, 253, 0.14)'
  };

  const objectBadgeStyle = {
    ...baseBadgeStyle,
    maxWidth: '140px',
    color: 'rgba(49, 48, 48, 0.58)',
    background: '#fcf2f2',
    border: '1px solid rgba(0, 0, 0, 0.055)'
  };

  return (
    <div
      title={typeof displayLabel === 'string' ? displayLabel : ''}
      style={{
        height: '100%',
        width: '100%',
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box',
        position: 'relative'
      }}
    >
      <NodeActionButtons
        isMonitoring={isProcessChain && isMonitoring}
        onSettingsClick={onNodeSettings ? () => onNodeSettings(null, node) : () => openNodeSettingsTab({ activeTab, node })}
        onOpenObjectClick={isProcessChain ? () => openFlowObjectFromNode({ apiUrl, node }) : undefined}
        onMonitorClick={() => openChainNodeFlowMonitoringTab({ apiUrl, activeTab, node, chainRunId })}
      />

      <div
        style={{
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          fontSize: '10px',
          lineHeight: '14px',
          fontWeight: 400,
          padding: isSourceOrTarget || isProcessChain
            ? '5px 24px 8px 3px'
            : '8px 24px 10px 8px',
          boxSizing: 'border-box',
          width: '100%',
          maxWidth: '100%',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis'
        }}
      >
        {displayLabel}
      </div>

      {((isProcessChain && flowId) || connectionBadge || modeBadge || objectBadge) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: '3px',
            rowGap: '3px',
            flexWrap: 'wrap',
            padding: '3px 3px 2px 3px',
            boxSizing: 'border-box',
            maxWidth: '100%'
          }}
        >
          {isProcessChain && flowId && (
            <span style={connectionBadgeStyle}>
              #{flowId}-flow
            </span>
          )}

          {connectionBadge && (
            <span style={connectionBadgeStyle}>
              {connectionBadge}
            </span>
          )}

          {modeBadge && (
            <span style={modeBadgeStyle}>
              {modeBadge}
            </span>
          )}

          {objectBadge && (
            <span title={objectBadge} style={objectBadgeStyle}>
              {objectBadge}
            </span>
          )}
        </div>
      )}

    </div>
  );
}