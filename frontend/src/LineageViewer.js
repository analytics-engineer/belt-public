import React, { useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  Handle,
  useNodesState,
  useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';

import FlowNodeLabel from './FlowNodeLabel';

const SIMPLE_NODE_WIDTH = 280;
const SIMPLE_START_X = 20;
const SIMPLE_START_Y = 120;
const SIMPLE_COLUMN_GAP = 90;
const SIMPLE_ROW_GAP = 130;

const DETAIL_START_X = 20;
const DETAIL_START_Y = 120;
const DETAIL_COLUMN_GAP = 140;
const DETAIL_ROW_GAP = 80;

function getNodeKey(flowIndex, nodeId) {
  return `lineage-${flowIndex}-${nodeId}`;
}

function normalizeObjectName(value) {
  return String(value || '').trim().toLowerCase();
}

function getFlowBounds(nodes) {
  if (!nodes.length) {
    return {
      minX: 0,
      minY: 0,
      maxX: 300,
      maxY: 200,
    };
  }

  const xs = nodes.map((n) => n.position?.x || 0);
  const ys = nodes.map((n) => n.position?.y || 0);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs) + 120,
    maxY: Math.max(...ys) + 80,
  };
}

function getObjectInfo(nodes, nodeType) {
  const node = nodes.find((n) => n.type === nodeType);
  const data = node?.data || {};

  const tableName = nodeType === 'output'
    ? data.target_table || data.table_name
    : data.table_name;

  const scriptPath = nodeType === 'input'
    ? data.script_path
    : null;

  const objectName =
    data.object_name ||
    (nodeType === 'input' ? data.source_object : data.target_object) ||
    (scriptPath ? `${scriptPath}` : '') ||
    [data.schema_name, tableName].filter(Boolean).join('.');

  const connectionId = data.connection_id || '';

  return {
    key: objectName
      ? normalizeObjectName([connectionId, objectName].filter(Boolean).join('|'))
      : '',
    label: objectName || (nodeType === 'input' ? 'Source object' : 'Target object'),
    connectionId,
  };
}

function makeEdge(id, source, target, extra = {}) {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    animated: true,
    selectable: false,
    style: {
      strokeWidth: 2,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
    },
    ...extra,
  };
}

function FlowGroupNode({ data }) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0 }}
      />

      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          opacity: 0.8,
          padding: '2px 6px',
          cursor: 'move',
          color: 'var(--text)',
        }}
      >
        {data.label}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0 }}
      />
    </div>
  );
}

const lineageNodeTypes = {
  flowGroup: FlowGroupNode,
};

const simpleFlowNodeStyle = {
  width: SIMPLE_NODE_WIDTH,
  border: '1px solid #444',
  borderRadius: 10,
  background: '#ffffff',
  color: '#111827',
  padding: 8,
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
};

const objectNodeStyle = {
  width: SIMPLE_NODE_WIDTH,
  border: '1px solid #2f7d32',
  borderRadius: 10,
  background: '#ffffff',
  color: '#111827',
  padding: 8,
  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
};

function buildFlowMeta(flowBlocks) {
  return flowBlocks.map((flowBlock, flowIndex) => {
    const flowData = flowBlock.data || {};
    const originalNodes = flowData.nodes || [];
    const originalEdges = flowData.edges || [];
    const sourceInfo = getObjectInfo(originalNodes, 'input');
    const targetInfo = getObjectInfo(originalNodes, 'output');
    const bounds = getFlowBounds(originalNodes);

    return {
      flowBlock,
      flowData,
      flowIndex,
      originalNodes,
      originalEdges,
      sourceInfo,
      targetInfo,
      sourceObjectKey: sourceInfo.key,
      targetObjectKey: targetInfo.key,
      nodeId: `lineage-flow-${flowIndex}`,
      groupId: `lineage-flow-group-${flowIndex}`,
      bounds,
      width: Math.max(bounds.maxX - bounds.minX + 50, 340),
      height: Math.max(bounds.maxY - bounds.minY + 55, 150),
    };
  });
}

function buildFlowLinks(flowMeta, edgePrefix) {
  const links = [];
  const addedEdges = new Set();
  const consumersBySourceKey = new Map();

  flowMeta.forEach((consumer) => {
    if (!consumer.sourceObjectKey) return;

    if (!consumersBySourceKey.has(consumer.sourceObjectKey)) {
      consumersBySourceKey.set(consumer.sourceObjectKey, []);
    }

    consumersBySourceKey.get(consumer.sourceObjectKey).push(consumer);
  });

  flowMeta.forEach((producer) => {
    if (!producer.targetObjectKey) return;

    const consumers = consumersBySourceKey.get(producer.targetObjectKey) || [];

    consumers.forEach((consumer) => {
      if (producer.flowIndex === consumer.flowIndex) return;

      const edgeId = `${edgePrefix}-${producer.flowIndex}-${consumer.flowIndex}`;

      if (addedEdges.has(edgeId)) return;
      addedEdges.add(edgeId);

      links.push({
        edgeId,
        sourceFlowIndex: producer.flowIndex,
        targetFlowIndex: consumer.flowIndex,
        sourceNodeId: producer.nodeId,
        targetNodeId: consumer.nodeId,
        sourceGroupId: producer.groupId,
        targetGroupId: consumer.groupId,
      });
    });
  });

  return links;
}

function buildLevels(itemIds, links, sourceField, targetField) {
  const levels = {};
  const incoming = new Set(links.map((link) => link[targetField]));

  itemIds.forEach((id) => {
    if (!incoming.has(id)) {
      levels[id] = 0;
    }
  });

  if (!Object.keys(levels).length && itemIds.length) {
    levels[itemIds[0]] = 0;
  }

  for (let i = 0; i < itemIds.length; i += 1) {
    links.forEach((link) => {
      const source = link[sourceField];
      const target = link[targetField];

      if (levels[source] === undefined) return;

      levels[target] = Math.max(
        levels[target] || 0,
        levels[source] + 1
      );
    });
  }

  itemIds.forEach((id) => {
    if (levels[id] === undefined) {
      levels[id] = 0;
    }
  });

  return levels;
}

function adjustSideSourceLevels(itemIds, links, levels, sourceField, targetField) {
  const incomingCountById = {};
  const outgoingTargetsById = {};

  itemIds.forEach((id) => {
    incomingCountById[id] = 0;
    outgoingTargetsById[id] = [];
  });

  links.forEach((link) => {
    const source = link[sourceField];
    const target = link[targetField];

    incomingCountById[target] = (incomingCountById[target] || 0) + 1;

    if (!outgoingTargetsById[source]) {
      outgoingTargetsById[source] = [];
    }

    outgoingTargetsById[source].push(target);
  });

  itemIds.forEach((id) => {
    const incomingCount = incomingCountById[id] || 0;
    const outgoingTargets = outgoingTargetsById[id] || [];

    if (incomingCount === 0 && outgoingTargets.length === 1) {
      const targetLevel = levels[outgoingTargets[0]] || 0;

      if (targetLevel > 1) {
        levels[id] = targetLevel - 1;
      }
    }
  });

  return levels;
}

function buildFlowLevels(flowMeta, flowLinks) {
  const flowIds = flowMeta.map((flow) => flow.flowIndex);
  const levels = buildLevels(
    flowIds,
    flowLinks,
    'sourceFlowIndex',
    'targetFlowIndex'
  );

  return adjustSideSourceLevels(
    flowIds,
    flowLinks,
    levels,
    'sourceFlowIndex',
    'targetFlowIndex'
  );
}

function buildLevelXMap(items, levels, getId, getWidth, startX, columnGap) {
  const maxLevel = Math.max(
    0,
    ...Object.values(levels).map((value) => Number(value) || 0)
  );

  const maxWidthByLevel = {};

  items.forEach((item) => {
    const id = getId(item);
    const level = levels[id] || 0;
    const width = getWidth(item);

    maxWidthByLevel[level] = Math.max(maxWidthByLevel[level] || 0, width);
  });

  const xByLevel = {};
  let currentX = startX;

  for (let level = 0; level <= maxLevel; level += 1) {
    xByLevel[level] = currentX;
    currentX += (maxWidthByLevel[level] || SIMPLE_NODE_WIDTH) + columnGap;
  }

  return xByLevel;
}

function renderFlowLabel(meta) {
  return (
    <div
      title={`${meta.sourceInfo.label} (conn-${meta.sourceInfo.connectionId}) → ${meta.targetInfo.label} (conn-${meta.targetInfo.connectionId})`}
      style={{ textAlign: 'center', lineHeight: 1.3 }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>
        Flow {meta.flowBlock.flow_id || meta.flowIndex + 1}
      </div>

      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
        {meta.flowData?.flow_type || 'flow'}
      </div>
    </div>
  );
}

function buildDetailedGraph(flowBlocks, connections) {
  const resultNodes = [];
  const resultEdges = [];
  const flowMeta = buildFlowMeta(flowBlocks);
  const flowLinks = buildFlowLinks(flowMeta, 'lineage-flow-link');
  const levels = buildFlowLevels(flowMeta, flowLinks);

  const xByLevel = buildLevelXMap(
    flowMeta,
    levels,
    (meta) => meta.flowIndex,
    (meta) => meta.width,
    DETAIL_START_X,
    DETAIL_COLUMN_GAP
  );

  const nextYByLevel = {};

  flowMeta.forEach((meta) => {
    const level = levels[meta.flowIndex] || 0;
    const offsetX = xByLevel[level] ?? DETAIL_START_X;
    const offsetY = nextYByLevel[level] ?? DETAIL_START_Y;

    nextYByLevel[level] = offsetY + meta.height + DETAIL_ROW_GAP;

    resultNodes.push({
      id: meta.groupId,
      type: 'flowGroup',
      position: {
        x: offsetX,
        y: offsetY,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: `flow - ${meta.flowBlock.flow_id || meta.flowIndex + 1}`,
      },
      selectable: true,
      draggable: true,
      style: {
        width: meta.width,
        height: meta.height,
        border: '1px solid var(--border-color, #444)',
        borderRadius: 12,
        background: 'rgba(255,255,255,0.03)',
        color: 'var(--text-color, #fff)',
        fontSize: 12,
        padding: 8,
      },
    });

    meta.originalNodes.forEach((node) => {
      const lineageNode = {
        ...node,
        id: getNodeKey(meta.flowIndex, node.id),
        position: {
          x: 10 + ((node.position?.x || 0) - meta.bounds.minX),
          y: 40 + ((node.position?.y || 0) - meta.bounds.minY),
        },
        parentNode: meta.groupId,
        extent: 'parent',
        data: {
          ...node.data,
        },
        draggable: false,
        selectable: false,
      };

      lineageNode.data.label = (
        <FlowNodeLabel
          node={node}
          activeTab={{ flow_type: meta.flowData.flow_type }}
          savedFlows={[]}
          connections={connections}
        />
      );

      resultNodes.push(lineageNode);
    });

    meta.originalEdges.forEach((edge) => {
      resultEdges.push({
        ...edge,
        id: `lineage-${meta.flowIndex}-${edge.id}`,
        source: getNodeKey(meta.flowIndex, edge.source),
        target: getNodeKey(meta.flowIndex, edge.target),
        selectable: false,
      });
    });
  });

  flowLinks.forEach((link) => {
    resultEdges.push(
      makeEdge(link.edgeId, link.sourceGroupId, link.targetGroupId)
    );
  });

  return {
    nodes: resultNodes,
    edges: resultEdges,
  };
}

function buildFlowsGraph(flowBlocks) {
  const flowMeta = buildFlowMeta(flowBlocks);
  const flowLinks = buildFlowLinks(flowMeta, 'lineage-flow-edge');
  const levels = buildFlowLevels(flowMeta, flowLinks);
  const rowsByLevel = {};

  const xByLevel = buildLevelXMap(
    flowMeta,
    levels,
    (meta) => meta.flowIndex,
    () => SIMPLE_NODE_WIDTH,
    SIMPLE_START_X,
    SIMPLE_COLUMN_GAP
  );

  const resultNodes = flowMeta.map((meta) => {
    const level = levels[meta.flowIndex] || 0;
    const row = rowsByLevel[level] || 0;

    rowsByLevel[level] = row + 1;

    return {
      id: meta.nodeId,
      position: {
        x: xByLevel[level] ?? SIMPLE_START_X,
        y: SIMPLE_START_Y + row * SIMPLE_ROW_GAP,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: renderFlowLabel(meta),
      },
      style: simpleFlowNodeStyle,
    };
  });

  const resultEdges = flowLinks.map((link) =>
    makeEdge(link.edgeId, link.sourceNodeId, link.targetNodeId)
  );

  return {
    nodes: resultNodes,
    edges: resultEdges,
  };
}

function buildObjectsGraph(flowBlocks) {
  const objectsByKey = new Map();
  const edgeMap = new Map();

  flowBlocks.forEach((flowBlock, flowIndex) => {
    const originalNodes = flowBlock.data?.nodes || [];
    const sourceInfo = getObjectInfo(originalNodes, 'input');
    const targetInfo = getObjectInfo(originalNodes, 'output');

    if (sourceInfo.key) objectsByKey.set(sourceInfo.key, sourceInfo);
    if (targetInfo.key) objectsByKey.set(targetInfo.key, targetInfo);

    if (!sourceInfo.key || !targetInfo.key) return;
    if (sourceInfo.key === targetInfo.key) return;

    const edgeKey = `${sourceInfo.key}->${targetInfo.key}`;

    if (!edgeMap.has(edgeKey)) {
      edgeMap.set(edgeKey, {
        source: sourceInfo.key,
        target: targetInfo.key,
        flows: [],
      });
    }

    edgeMap.get(edgeKey).flows.push(`Flow ${flowBlock.flow_id || flowIndex + 1}`);
  });

  const objectKeys = Array.from(objectsByKey.keys());
  const objectEdges = Array.from(edgeMap.values());

  const levels = adjustSideSourceLevels(
    objectKeys,
    objectEdges,
    buildLevels(objectKeys, objectEdges, 'source', 'target'),
    'source',
    'target'
  );

  const rowsByLevel = {};
  const objectNodeIds = new Map(
    objectKeys.map((key, index) => [key, `lineage-object-${index}`])
  );

  const xByLevel = buildLevelXMap(
    objectKeys,
    levels,
    (key) => key,
    () => SIMPLE_NODE_WIDTH,
    SIMPLE_START_X,
    SIMPLE_COLUMN_GAP
  );

  const resultNodes = objectKeys.map((key) => {
    const objectInfo = objectsByKey.get(key);
    const level = levels[key] || 0;
    const row = rowsByLevel[level] || 0;

    rowsByLevel[level] = row + 1;

    return {
      id: objectNodeIds.get(key),
      position: {
        x: xByLevel[level] ?? SIMPLE_START_X,
        y: SIMPLE_START_Y + row * SIMPLE_ROW_GAP,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <div style={{ lineHeight: 1.25 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>
              {objectInfo.label}
            </div>

            {objectInfo.connectionId && (
              <div style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>
                connection {objectInfo.connectionId}
              </div>
            )}
          </div>
        ),
      },
      style: objectNodeStyle,
    };
  });

  const resultEdges = objectEdges.map((edge, index) =>
    makeEdge(
      `lineage-object-edge-${index}`,
      objectNodeIds.get(edge.source),
      objectNodeIds.get(edge.target),
      {
        label: edge.flows.join(', '),
      }
    )
  );

  return {
    nodes: resultNodes,
    edges: resultEdges,
  };
}

export default function LineageViewer({
  flowBlocks = [],
  connections = [],
  mode = 'objects',
}) {
  const reactFlowInstanceRef = useRef(null);

  const { nodes: computedNodes, edges: computedEdges } = useMemo(() => {
    if (mode === 'flows') {
      return buildFlowsGraph(flowBlocks);
    }

    if (mode === 'detailed') {
      return buildDetailedGraph(flowBlocks, connections);
    }

    return buildObjectsGraph(flowBlocks);
  }, [flowBlocks, connections, mode]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    setNodes(computedNodes);
    setEdges(computedEdges);
  }, [computedNodes, computedEdges, setNodes, setEdges]);

  useEffect(() => {
    if (!reactFlowInstanceRef.current || !computedNodes.length) return;

    setTimeout(() => {
      reactFlowInstanceRef.current.fitView({
        padding: 0.08,
        duration: 300,
      });
    }, 0);
  }, [computedNodes]);

  if (!flowBlocks.length) {
    return (
      <div style={{ padding: 16, opacity: 0.7 }}>
        No lineage data
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 500 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={lineageNodeTypes}
        fitView
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        panOnScroll={false}
        preventScrolling={true}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}