
import React, { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  useNodesState,
  useEdgesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import useStore from './store';
import Tabs from './Tabs';
import { t } from './i18n';
import StartScreen from './Components/StartScreen/StartScreen';
import NodeSettings from './NodeSettings';
import MonitoringTab from './Components/Monitoring/MonitoringTab';
import LineageTab from './LineageTab';
import FlowNodeLabel from './FlowNodeLabel';
import { getConnectionConfigTemplate } from './src/connectionConfigTemplates';
import ProcessChainWorkspace from './Components/ProcessChain/ProcessChainWorkspace';
import SettingsModal from './Components/Settings/SettingsModal';
import {
  getCurrentUserDisplayName,
  getCurrentUserEmail,
  getValidAccessToken,
  hasDeployPermission,
  logout
} from './auth';
import TransferPackagesTab from './TransferPackagesTab';

import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
ModuleRegistry.registerModules([AllCommunityModule]);

/*const API_URL = `http://${window.location.hostname}:8000`;*/
const API_URL = ["3000", "5173"].includes(window.location.port)
  ? `http://${window.location.hostname}:8000`
  : "/api";
const OperationsTab = lazy(() => import('./OperationsTab'));

export default function App() {
  const { tabs, activeTabId, addTab, updateTabFileData, setActiveTab, replaceTab, chainMonitorByTab,
    setChainMonitorState, setUserSettings, locale, theme, openMonitoringTab, openNodeSettingsTab } = useStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [savedFlows, setSavedFlows] = useState([]);
  const [savedChains, setSavedChains] = useState([]);
  const [connections, setConnections] = useState([]);
  const [newConnName, setNewConnName] = useState('');
  const [connectionType, setConnectionType] = useState('');
  const [newConnConfig, setNewConnConfig] = useState(``);
  const [chainSchedule, setChainSchedule] = useState(null);
  const [cronExpr, setCronExpr] = useState('');
  const [cronLoading, setCronLoading] = useState(false);
  const [chainSettingsNodeId, setChainSettingsNodeId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [currentUserDisplayName, setCurrentUserDisplayName] = useState('');
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [deployAllowed, setDeployAllowed] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const updateCurrentUser = async () => {
      const token = await getValidAccessToken();
      if (cancelled) return;
      setCurrentUserDisplayName(getCurrentUserDisplayName(token));
      setCurrentUserEmail(getCurrentUserEmail(token));
      setDeployAllowed(hasDeployPermission(token));
    };

    updateCurrentUser();
    return () => { cancelled = true; };
  }, []);

  const [leftGroupsOpen, setLeftGroupsOpen] = useState({
    connections: false,
    models: false,
    chains: false
  });

  const handleConnectionTypeChange = (type) => {
    setConnectionType(type);

    if (!newConnConfig || newConnConfig.trim() === '') {
      setNewConnConfig(getConnectionConfigTemplate(type));
    }
  };

  const toggleLeftGroup = (groupName) => {
    setLeftGroupsOpen(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  const fetchData = useCallback(async () => {
    try {
      const [flowsRes, chainsRes, connRes] = await Promise.all([
        axios.get(`${API_URL}/flows`),
        axios.get(`${API_URL}/process-chains`),
        axios.get(`${API_URL}/connections`)
      ]);

      setSavedFlows(flowsRes.data);
      setSavedChains(chainsRes.data);
      setConnections(connRes.data);
    } catch (err) {
      console.error('Ошибка загрузки данных:', err.response?.data?.detail || err.message);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge({
    ...params,
    markerEnd: {
      type: 'arrowclosed',
      color: '#bbb',
    },
  }, eds)), [setEdges]);

  const onNodeDoubleClick_old = (event, node) => {
    const flowTitle = activeTab.title;

    let displayNodeType =
      activeTab.flow_type === 'transformation' && node.type === 'default'
        ? 'transform'
        : node.type;

    if (activeTab.flow_type === 'process_chain') {
      displayNodeType = `flow ${node.data?.flow_id || 'not selected'}`;
    }

    addTab({
      id: `settings-${activeTab.id}-${node.id}`,
      title: `${flowTitle} / ${displayNodeType}`,
      type: 'settings',
      tabKind:
        node.type === 'output' ? 'target_node' :
          node.type === 'default' ? 'transform_node' :
            node.type === 'flow' ? 'chain_flow_node' :
              'source_node',
      nodeId: node.id,
      parentFlowId: activeTab.id,
      flow_type: activeTab.flow_type
    });
  };

  const chainSettingsNode = nodes.find(
    (node) => node.id === chainSettingsNodeId
  );

  const onNodeSettingsOpen = (event, node) => {
    if (activeTab?.flow_type === 'process_chain') {
      setChainSettingsNodeId(node.id);
      return;
    }

    openNodeSettingsTab({ activeTab, node });
  };

  const saveFlow = async () => {
    const isProcessChain = activeTab?.flow_type === 'process_chain';

    const endpoint = isProcessChain ? 'process-chains' : 'flows';
    const idPrefix = isProcessChain ? 'chain-' : 'flow-';

    const isExistingObject = activeTab?.id.startsWith(idPrefix);
    let objectId = isExistingObject ? activeTab.id.replace(idPrefix, '') : null;
    let name = activeTab?.name;

    if (!isExistingObject) {
      name = prompt(
        isProcessChain ? "Введите название process chain:" : "Введите название новой модели:",
        isProcessChain ? "New Process Chain" : "New Flow"
      );

      if (!name) return;
    }

    const cleanNodes = nodes.map(({ selected, ...node }) => node);

    const objectData = {
      ...activeTab.data,
      nodes: cleanNodes,
      edges,
      flow_type: activeTab.flow_type
    };

    try {
      if (isExistingObject) {
        await axios.put(`${API_URL}/${endpoint}/${objectId}`, {
          name,
          data: objectData
        });
      } else {
        const res = await axios.post(`${API_URL}/${endpoint}`, {
          name,
          data: objectData
        });

        const createdId = res.data.id;
        const newTabId = isProcessChain ? `chain-${createdId}` : `flow-${createdId}`;

        replaceTab(activeTab.id, {
          id: newTabId,
          title: `${name} (${createdId})`,
          name,
          type: 'flow',
          flow_type: activeTab.flow_type,
          data: objectData
        });
      }

      alert('Сохранено');
      fetchData();
    } catch (err) {
      alert('Ошибка: ' + (err.response?.data?.detail || err.message));
    }
  };

  const updateNodeData = (nodeId, field, value) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: { ...node.data, [field]: value } };
        }
        return node;
      })
    );
  };

  const saveConnection = async () => {
    if (!newConnName) return alert('Введите имя подключения');
    try {
      const config = JSON.parse(newConnConfig);
      const isEditing = activeTab?.connData?.id; // Проверяем, редактируем ли мы

      if (isEditing) {
        await axios.put(`${API_URL}/connections/${activeTab.connData.id}`, {
          name: newConnName,
          connection_type: connectionType,
          config
        });
      } else {
        await axios.post(`${API_URL}/connections`, {
          name: newConnName,
          connection_type: connectionType,
          config
        });
      }
      alert('Saved');
      if (!isEditing) setNewConnName(''); // Очищаем только если новый
      fetchData();
    } catch (err) {
      alert('Error: ' + (err.response?.data?.detail || 'Неверный формат JSON'));
    }
  };

  const testConnection = async () => {
    try {
      const config = JSON.parse(newConnConfig);

      const res = await axios.post(`${API_URL}/connections/test`, {
        connection_id: activeTab?.connData?.id || null,
        connection_type: connectionType,
        config
      });

      alert(res.data?.message || 'Connection OK');
    } catch (err) {
      alert(err.response?.data?.detail || 'Connection test failed');
    }
  };

  const handleCreateFlow_old = (flowType) => {
    setNodes([]);
    setEdges([]);

    let title = 'New Flow';
    let tabKind = 'flow';

    if (flowType === 'integration') { title = 'New Integration'; tabKind = 'flow'; }
    if (flowType === 'transformation') { title = 'New Transform'; tabKind = 'flow'; }
    if (flowType === 'process_chain') { title = 'New Process Chain'; tabKind = 'chain'; }


    addTab({
      id: `new-${flowType}-${Date.now()}`,
      title,
      type: 'flow',
      flow_type: flowType,
      tabKind,
      data: { nodes: [], edges: [], flow_type: flowType }
    });
  };

  const handleCreateFlow = (flowType) => {
    const tabId = `new-${flowType}-${Date.now()}`;

    let title = 'New Flow';
    let tabKind = 'flow';

    if (flowType === 'integration') { title = 'New Integration'; tabKind = 'flow'; }
    if (flowType === 'transformation') { title = 'New Transform'; tabKind = 'flow'; }
    if (flowType === 'process_chain') { title = 'New Process Chain'; tabKind = 'chain'; }

    let defaultNodes = [];
    let defaultEdges = [];

    if (flowType === 'integration') {
      const sourceId = `${tabId}-source`;
      const targetId = `${tabId}-target`;

      defaultNodes = [
        {
          id: sourceId,
          type: 'input',
          data: {
            label: 'Source Node',
            sql: '',
            connection_id: '',
            mode: ''
          },
          position: { x: 150, y: 150 },
          sourcePosition: 'right',
          targetPosition: 'left'
        },
        {
          id: targetId,
          type: 'output',
          data: {
            label: 'Target Node',
            sql: '',
            connection_id: ''
          },
          position: { x: 500, y: 150 },
          sourcePosition: 'right',
          targetPosition: 'left'
        }
      ];

      defaultEdges = [
        {
          id: `${sourceId}-${targetId}`,
          source: sourceId,
          target: targetId,
          markerEnd: {
            type: 'arrowclosed',
            color: '#bbb'
          }
        }
      ];
    }

    if (flowType === 'transformation') {
      const sourceId = `${tabId}-source`;
      const transformId = `${tabId}-transform`;
      const targetId = `${tabId}-target`;

      defaultNodes = [
        {
          id: sourceId,
          type: 'input',
          data: {
            label: 'Source Node',
            sql: '',
            connection_id: '',
            mode: ''
          },
          position: { x: 100, y: 150 },
          sourcePosition: 'right',
          targetPosition: 'left'
        },
        {
          id: transformId,
          type: 'default',
          data: {
            label: 'Transform Node',
            sql: '',
            connection_id: ''
          },
          position: { x: 350, y: 150 },
          sourcePosition: 'right',
          targetPosition: 'left'
        },
        {
          id: targetId,
          type: 'output',
          data: {
            label: 'Target Node',
            sql: '',
            connection_id: ''
          },
          position: { x: 600, y: 150 },
          sourcePosition: 'right',
          targetPosition: 'left'
        }
      ];

      defaultEdges = [
        {
          id: `${sourceId}-${transformId}`,
          source: sourceId,
          target: transformId,
          markerEnd: {
            type: 'arrowclosed',
            color: '#bbb'
          }
        },
        {
          id: `${transformId}-${targetId}`,
          source: transformId,
          target: targetId,
          markerEnd: {
            type: 'arrowclosed',
            color: '#bbb'
          }
        }
      ];
    }

    setNodes(defaultNodes);
    setEdges(defaultEdges);

    addTab({
      id: tabId,
      title,
      type: 'flow',
      tabKind,
      flow_type: flowType,
      data: {
        nodes: defaultNodes,
        edges: defaultEdges,
        flow_type: flowType
      }
    });
  };

  {/*const updateTabFileData = useStore((state) => state.updateTabFileData);*/ }

  useEffect(() => {
    if (activeTab?.type === 'flow' && activeTab.data) {
      setNodes(activeTab.data.nodes || []);
      setEdges(activeTab.data.edges || []);
    }
  }, [activeTabId, activeTab]); // Срабатывает при каждом клике по вкладке

  useEffect(() => {
    fetch(`${API_URL}/api/user-settings`)
      .then(res => res.json())
      .then(data => {
        const theme = data.theme_code || 'dark';
        const locale = data.locale_code || 'en';

        setUserSettings({
          displayName: data.display_name || '',
          theme,
          locale
        });

        document.body.dataset.theme = theme;
        document.documentElement.lang = locale;
      });
  }, [setUserSettings]);

  // Внутри компонента App
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [openFolders, setOpenFolders] = useState({});

  const toggleFolder = (folderKey) => {
    setOpenFolders(prev => ({
      ...prev,
      [folderKey]: prev[folderKey] === false ? true : false
    }));
  };

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('belt_sidebar_width'));
    return saved >= 180 && saved <= 520 ? saved : 250;
  });

  const handleSidebarResizeStart = (e) => {
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let currentWidth = startWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent) => {
      const nextWidth = Math.min(
        520,
        Math.max(180, startWidth + moveEvent.clientX - startX)
      );

      currentWidth = nextWidth;
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      localStorage.setItem('belt_sidebar_width', String(currentWidth));

      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const updateTabTitle = useStore((state) => state.updateTabTitle);

  const handleRename = async (id, oldName) => {
    const newName = prompt("Rename flow to:", oldName);
    if (!newName || newName === oldName) return;
    try {
      // Нам нужно получить текущие данные flow, чтобы не затереть их (data)
      const res = await axios.get(`${API_URL}/flows/${id}`);
      await axios.put(`${API_URL}/flows/${id}`, { name: newName, data: res.data.data });
      fetchData();
      updateTabTitle(`flow-${id}`, newName);
      setActiveMenuId(null);
    } catch (err) {
      alert("Error renaming flow");
    }
  };

  const handleRenameConnection = async (id, oldName) => {
    const newName = prompt("Rename connection to:", oldName);
    if (!newName || newName === oldName) return;
    try {
      const res = await axios.get(`${API_URL}/connections/${id}`);
      await axios.put(`${API_URL}/connections/${id}`, {
        name: newName,
        connection_type: res.data.connection_type,
        config: res.data.config
      });
      fetchData();
      setActiveMenuId(null);
    } catch (err) {
      alert("Error renaming connection");
    }
  };

  const handleRenameProcessChain = async (id, oldName) => {
    const newName = prompt("Rename process chain to:", oldName);
    if (!newName || newName === oldName) return;

    try {
      const res = await axios.get(`${API_URL}/process-chains/${id}`);

      await axios.put(`${API_URL}/process-chains/${id}`, {
        name: newName,
        data: res.data.data
      });

      fetchData();
      updateTabTitle(`chain-${id}`, newName);
      setActiveMenuId(null);
    } catch (err) {
      alert("Error renaming process chain");
    }
  };

  // 1. Универсальное открытие (двойной клик)
  const handleOpenEntity = async (id, entityType) => {
    try {
      const res = await axios.get(`${API_URL}/${entityType}/${id}`);

      if (entityType === 'flows') {
        addTab({
          id: `flow-${id}`,
          title: `Flow ${id}`, /*}`${res.data.name} (${res.data.id})`,*/
          name: res.data.name,
          type: 'flow',
          tabKind: 'flow',
          flow_type: res.data.data?.flow_type,
          data: res.data.data
        });
      } else if (entityType === 'process-chains') {
        addTab({
          id: `chain-${id}`,
          title: `Chain ${id}`,/*`${res.data.name} (${res.data.id})`,*/
          name: res.data.name,
          type: 'flow',
          tabKind: 'chain',
          flow_type: 'process_chain',
          data: res.data.data
        });
      } else if (entityType === 'connections') {
        addTab({
          id: `conn-${id}`,
          title: `Conn ${id}`, /*`Conn: ${res.data.name} (${res.data.id})`,*/
          name: res.data.name,
          type: 'conn_form',
          tabKind: 'conn',
          connData: res.data
        });
      }
    } catch (err) {
      alert('Ошибка открытия');
    }
  };

  // 2. Универсальное удаление
  const handleGeneralDelete = async (id, type) => {
    const titles = { flows: 'модель', connections: 'соединение', 'process-chains': 'цепочку' };
    if (!window.confirm(`Удалить ${titles[type]}?`)) return;

    try {
      await axios.delete(`${API_URL}/${type}/${id}`);
      fetchData(); // Обновляем списки в сайдбаре
      setActiveMenuId(null);
    } catch (err) {
      alert(`Ошибка при удалении: ${err.message}`);
    }
  };

  const buildTreeBySlash = (items, entityType) => {
    const root = [];

    for (const item of items) {
      const parts = String(item.name || '')
        .split('/')
        .map(p => p.trim())
        .filter(Boolean);

      if (parts.length === 0) continue;

      let level = root;
      let path = '';

      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        path = path ? `${path}/${part}` : part;

        if (isLast) {
          level.push({
            type: 'item',
            entityType,
            id: item.id,
            name: part,
            fullName: item.name,
            item
          });
        } else {
          let folder = level.find(
            node => node.type === 'folder' && node.name === part
          );

          if (!folder) {
            folder = {
              type: 'folder',
              name: part,
              path: `${entityType}/${path}`,
              children: []
            };
            level.push(folder);
          }

          level = folder.children;
        }
      });
    }

    return root;
  };

  const renderSlashTree = (tree, depth = 0) => {
    return tree.map((node, index) => {
      if (node.type === 'folder') {
        const folderKey = node.path;
        const isOpen = openFolders[folderKey] !== false;

        return (
          <div key={`folder-${folderKey}-${index}`}>
            <div
              onClick={() => toggleFolder(folderKey)}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-soft)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              style={{
                cursor: 'pointer',
                padding: `4px 10px 4px ${20 + depth * 10}px`,
                fontSize: '13px',
                color: 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                gap: '0px'
              }}
            >
              <span style={{ width: '12px', color: 'var(--danger)' }}>
                {isOpen ? '▾' : '▸'}
              </span>
              <span>{node.name}</span>
            </div>

            {isOpen && renderSlashTree(node.children, depth + 1)}
          </div>
        );
      }

      const menuKey = `${node.entityType}-${node.id}`;

      const handleRenameByType = () => {
        if (node.entityType === 'flows') {
          handleRename(node.id, node.fullName);
        } else if (node.entityType === 'process-chains') {
          handleRenameProcessChain(node.id, node.fullName);
        } else if (node.entityType === 'connections') {
          handleRenameConnection(node.id, node.fullName);
        }
      };
      return (
        <div
          key={`${node.entityType}-${node.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `4px 10px 4px ${20 + depth * 10}px`,
            borderBottom: '1px solid var(--input-bg)',
            position: 'relative'
          }}
        >
          <div
            onDoubleClick={() => handleOpenEntity(node.id, node.entityType)}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-soft)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            title={node.fullName}
            style={{
              cursor: 'pointer',
              fontSize: '13px',
              flexGrow: 1
            }}
          >
            {node.name} ({node.id})
          </div>

          <div
            onClick={(e) => {
              e.stopPropagation();
              setActiveMenuId(activeMenuId === menuKey ? null : menuKey);
            }}
            style={{ cursor: 'pointer', padding: '0 5px', color: 'var(--text-dim)' }}
          >
            ⋮
          </div>

          {activeMenuId === menuKey && (
            <div style={{ position: 'absolute', right: '5px', top: '35px', background: 'var(--dropdown-bg)', border: '1px solid var(--border)', borderRadius: '4px', zIndex: 1000, minWidth: '120px' }}>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleRenameByType();
                }}
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px' }}
              >
                Rename
              </div>

              <div
                onClick={(e) => {
                  e.stopPropagation();
                  handleGeneralDelete(node.id, node.entityType);
                }}
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', color: 'var(--danger-text)' }}
              >
                Delete
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  const handleApplyToStore = () => {
    if (activeTab?.type === 'flow') {
      // Записываем текущее состояние холста в память вкладки
      updateTabFileData(activeTab.id, { nodes, edges });
    }
  };

  const runFlow = async () => {
    const isFlow = activeTab?.id.startsWith('flow-');
    const isChain = activeTab?.id.startsWith('chain-');

    if (!isFlow && !isChain) {
      return alert('Сначала сохраните объект, чтобы запустить его');
    }

    const confirmRun = window.confirm("Are you sure you want run this?");
    if (!confirmRun) return;

    const objectType = isChain ? 'chain' : 'flow';

    const objectId = isChain
      ? activeTab.id.replace('chain-', '')
      : activeTab.id.replace('flow-', '');

    try {
      const res = await axios.post(`${API_URL}/run-object`, {
        object_type: objectType,
        object_id: Number(objectId)
      });

      alert(`Runned: ${res.data.message}`);
    } catch (err) {
      alert('Run error: ' + (err.response?.data?.detail || err.message));
    }
  };

  const isProcessChainTab = activeTab?.type === 'flow' && activeTab?.flow_type === 'process_chain';
  const activeChainId = isProcessChainTab && activeTab?.id?.startsWith('chain-')
    ? activeTab.id.replace('chain-', '')
    : null;

  const saveCron = async () => {
    if (!activeChainId) {
      return alert('Сначала сохраните process chain');
    }

    if (!cronExpr.trim()) {
      return alert('Введите cron выражение');
    }

    try {
      setCronLoading(true);

      const res = await axios.post(`${API_URL}/process-chain-schedules/${activeChainId}`, {
        cron_expr: cronExpr,
        timezone: 'Europe/Moscow'
      });

      setChainSchedule(res.data);
      alert('Cron сохранён');
    } catch (err) {
      alert('Cron error: ' + (err.response?.data?.detail || err.message));
    } finally {
      setCronLoading(false);
    }
  };

  const enableCron = async () => {
    if (!activeChainId) {
      return alert('Сначала сохраните process chain');
    }

    if (!cronExpr.trim()) {
      return alert('Введите cron выражение');
    }

    try {
      setCronLoading(true);

      await axios.post(`${API_URL}/process-chain-schedules/${activeChainId}`, {
        cron_expr: cronExpr,
        timezone: 'Europe/Moscow'
      });

      const res = await axios.post(`${API_URL}/process-chain-schedules/${activeChainId}/enable`);
      setChainSchedule(res.data);
    } catch (err) {
      alert('Cron error: ' + (err.response?.data?.detail || err.message));
    } finally {
      setCronLoading(false);
    }
  };

  const pauseCron = async () => {
    if (!activeChainId) return;

    try {
      setCronLoading(true);

      const res = await axios.post(`${API_URL}/process-chain-schedules/${activeChainId}/pause`);
      setChainSchedule(res.data);
    } catch (err) {
      alert('Cron error: ' + (err.response?.data?.detail || err.message));
    } finally {
      setCronLoading(false);
    }
  };

  const formatNextRunAt = (value) => {
    if (!value) return 'not calculated';

    return new Date(value).toLocaleString();
  };

  useEffect(() => {
    const loadChainSchedule = async () => {
      if (!activeChainId) {
        setChainSchedule(null);
        setCronExpr('');
        return;
      }

      try {
        const res = await axios.get(`${API_URL}/process-chain-schedules/${activeChainId}`);
        setChainSchedule(res.data);
        setCronExpr(res.data.cron_expr || '');
      } catch (err) {
        setChainSchedule(null);
        setCronExpr('');
        console.error('Ошибка загрузки cron:', err.response?.data?.detail || err.message);
      }
    };

    loadChainSchedule();
  }, [activeChainId]);

  const handleOpenJournal = () => {
    openMonitoringTab({
      endpointUrl: `${API_URL}/get_metadata_data/monitor_chains`,
      id: 'journal-main',
      title: 'Monitoring chains',
      type: 'logs',
      tabKind: 'monitor',
      logLevel: 'journal_chain',
      tableName: 'journal_chain',
      filters: {}
    });
  };

  const handleOpenFlowRuns = () => {
    openMonitoringTab({
      id: 'monitor-flow-runs',
      title: 'Monitoring flows',
      type: 'logs',
      tabKind: 'monitor',
      logLevel: 'flow_runs_all',
      endpointUrl: `${API_URL}/monitor/flow-runs`,
      tableName: 'flow_runs',
      filters: {}
    });
  };

  const openOperationsTab = () => {
    const tabId = 'operations-main';

    const exists = tabs.some((t) => t.id === tabId);

    if (exists) {
      setActiveTab(tabId);
      return;
    }

    addTab({
      id: tabId,
      title: 'Data manage',
      type: 'operations',
      tabKind: 'operations'
    });
  };

  const openLineageTab = () => {
    const tabId = 'data-lineage';

    const exists = tabs.some((t) => t.id === tabId);

    if (exists) {
      setActiveTab(tabId);
      return;
    }

    addTab({
      id: tabId,
      title: 'Data Lineage',
      type: 'lineage',
      tabKind: 'lineage',
    });

    setActiveTab(tabId);
  };

  const openTransferPackagesTab = () => {
    const tabId = 'transfer-packages';

    if (tabs.some((tab) => tab.id === tabId)) {
      setActiveTab(tabId);
      return;
    }

    addTab({
      id: tabId,
      title: 'Deploy',
      type: 'transfer-packages',
      tabKind: 'deploy'
    });
  };

  const addNode = (type) => {
    const isProcessChain = activeTab?.flow_type === 'process_chain';

    const newNode = {
      id: `node-${Date.now()}`,
      type: isProcessChain
        ? 'default'
        : type === 'Source'
          ? 'input'
          : type === 'Target'
            ? 'output'
            : 'default',
      data: isProcessChain
        ? {
          label: 'Flow Step',
          step_type: 'flow',
          flow_id: ''
        }
        : {
          label: `${type} Node`,
          sql: '',
          connection_id: '',
          ...(type === 'Source' && {
            mode: ''
          }),
          ...(type === 'Target' && {
          })
        },
      position: isProcessChain
        ? { x: 350, y: 120 + nodes.length * 60 }
        : { x: 150, y: 150 },

      sourcePosition: isProcessChain ? 'bottom' : 'right',
      targetPosition: isProcessChain ? 'top' : 'left',
    };

    setNodes((nds) => nds.concat(newNode));
  };

  useEffect(() => {
    if (activeTab?.type === 'conn_form' && activeTab.connData) {
      setNewConnName(activeTab.connData.name);
      setConnectionType(activeTab.connData.connection_type || '');
      setNewConnConfig(JSON.stringify(activeTab.connData.config, null, 2));
    } else if (activeTab?.type === 'conn_form') {
      // Если это вкладка создания нового коннекшна
      setNewConnName('');
      setConnectionType('');
      setNewConnConfig(``);
    }
  }, [activeTabId, activeTab?.connData]);

  const isProcessChain = activeTab?.flow_type === 'process_chain';
  const isNormalFlow = activeTab?.type === 'flow' && !isProcessChain;
  const chainMonitorState = activeTab?.id
    ? chainMonitorByTab[activeTab.id]
    : null;

  const isChainMonitoring =
    isProcessChain && chainMonitorState?.mode === 'monitoring';

  const isReadOnlyCanvas = isChainMonitoring;

  const selectedRunDetails = chainMonitorState?.selectedRunDetails;

  const displayedNodes =
    isChainMonitoring && selectedRunDetails?.data?.nodes
      ? selectedRunDetails.data.nodes
      : nodes;

  const displayedEdges =
    isChainMonitoring && selectedRunDetails?.data?.edges
      ? selectedRunDetails.data.edges
      : edges;

  const flowStatusById = {};

  if (selectedRunDetails?.flow_runs) {
    selectedRunDetails.flow_runs.forEach((fr) => {
      flowStatusById[String(fr.flow_id)] = fr.status;
    });
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      color: 'var(--text)'
    }}>

      <div style={{ display: 'flex', background: 'var(--topbar-bg)', padding: '10px', gap: '10px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <img
          src={theme === 'light' ? '/belt_28_dark.png' :'/belt_28_white.png'}
          alt="Belt"
          style={{ height: '28px', width: 'auto', objectFit: 'contain', flex: '0 0 auto' }}
        />
        <div style={{ width: '1px', background: 'var(--border)', height: '20px', margin: '0 10px' }}></div>
        <button
          onClick={() => addTab({ id: 'new-conn', title: '+ Connection', type: 'conn_form', tabKind: 'conn' })} className="belt-button belt-button-small">
          + Connection
        </button>
        <button onClick={() => handleCreateFlow('integration')} className="belt-button belt-button-small">
          + Integration
        </button>
        <button onClick={() => handleCreateFlow('transformation')} className="belt-button belt-button-small">
          + Transformation
        </button>
        <button onClick={() => handleCreateFlow('process_chain')} className="belt-button belt-button-small">
          + Process Chain
        </button>

        <div style={{ width: '1px', background: 'var(--border)', height: '20px', margin: '0 10px' }}></div>
        <button onClick={() => handleOpenJournal('journal')} className="belt-button belt-button-small">
          Chains runs
        </button>

        <button onClick={handleOpenFlowRuns} className="belt-button belt-button-small">
          Flows runs
        </button>

        <div style={{ width: '1px', background: 'var(--border)', height: '20px', margin: '0 10px' }}></div>
        <button onClick={openOperationsTab} className="belt-button belt-button-small">
          Data Manage
        </button>

        <button onClick={openLineageTab} className="belt-button belt-button-small">
          Lineage
        </button>
        <div style={{ width: '1px', background: 'var(--border)', height: '20px', margin: '0 10px' }}></div>

        <button
          onClick={openTransferPackagesTab}
          className="belt-button belt-button-small"
        >
          Deploy
        </button>
        <div style={{ width: '1px', background: 'var(--border)', height: '20px', margin: '0 10px' }}></div>

        <button
          type="button"
          onClick={async () => {
            // Прямая навигация не передаёт Authorization-заголовок, поэтому грузим HTML через fetch и открываем как blob.
            const response = await fetch(`${API_URL}/auto-docs/html`);
            if (!response.ok) {
              alert('Не удалось открыть автодокументацию');
              return;
            }
            const html = await response.blob();
            const blobUrl = URL.createObjectURL(html);
            window.open(blobUrl, '_blank', 'noopener,noreferrer');
            // Освобождаем blob сразу после открытия, чтобы не копился в памяти вкладки.
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
          }}
          className="belt-button belt-button-small"
        >
          Auto-docs
        </button>


        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--text-muted)' }}>
          {currentUserDisplayName && <span>{currentUserDisplayName}</span>}
          <div style={{ width: '32px', height: '32px', background: 'var(--border)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }}>
            {currentUserDisplayName
              ? currentUserDisplayName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() || '')
                .join('') || currentUserDisplayName[0]?.toUpperCase() || 'U'
              : 'U'}
          </div>
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="belt-icon-button"
            style={{
              marginLeft: '6px'
            }}
          >
            ⚙
          </button>
          <button
            onClick={logout}
            title="Log out"
            className="belt-button belt-button-small"
          >
            Log out
          </button>
        </div>

        <button type="button"
          onClick={() => {
            const docsUrl = locale === 'ru'
              ? 'https://getbelt.dev/docs/ru/'
              : 'https://getbelt.dev/docs/';

            window.open(docsUrl, '_blank', 'noopener,noreferrer');
          }}
          className=" belt-button-small"
        >
          Help
        </button>
      </div>

      <div style={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        <div style={{
          width: `${sidebarWidth}px`,
          minWidth: '180px',
          maxWidth: '520px',
          flexShrink: 0,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto'
        }}>
          <div
            onClick={() => toggleLeftGroup('connections')}
            class="belt-section-title"
          >
            {leftGroupsOpen.connections ? '▼' : '▶'} Connections
          </div>
          {leftGroupsOpen.connections && (

            <div style={{ flexShrink: 0 }}>
              {renderSlashTree(buildTreeBySlash(connections, 'connections'))}

              {/* Заглушка-распорка */}
              <div style={{ height: '60px' }} />
            </div>
          )}

          <div
            onClick={() => toggleLeftGroup('models')}
            class="belt-section-title"
          >
            {leftGroupsOpen.models ? '▼' : '▶'} Flows
          </div>
          {leftGroupsOpen.models && (
            <div style={{ flexShrink: 0 }}>
              {leftGroupsOpen.models && (
                <div style={{ flexShrink: 0 }}>
                  {renderSlashTree(buildTreeBySlash(savedFlows, 'flows'))}
                  <div style={{ height: '60px' }} />
                </div>
              )}

              {/* Заглушка-распорка */}

              <div style={{ height: '60px' }} />
            </div>
          )}

          <div
            onClick={() => toggleLeftGroup('chains')}
            class="belt-section-title"
          >
            {leftGroupsOpen.chains ? '▼' : '▶'} Process chains
          </div>

          {leftGroupsOpen.chains && (
            <div style={{ flexShrink: 0 }}>
              {renderSlashTree(buildTreeBySlash(savedChains, 'process-chains'))}
              <div style={{ height: '60px' }} />
            </div>
          )}
        </div>

        <div
          onMouseDown={handleSidebarResizeStart}
          title="Resize sidebar"
          style={{
            width: '1px',
            flexShrink: 0,
            cursor: 'col-resize',
            background: 'var(--border)',
            opacity: 0.7
          }}
        />

        {/* ПРАВАЯ РАБОЧАЯ ОБЛАСТЬ */}
        {/*<div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', background: 'var(--workspace-bg)' }}>*/}
        <div style={{
          flex: '1 1 0', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          background: 'var(--workspace-bg)'
        }}>
          {/* 1. Зона вкладок - теперь они живут ВЫШЕ забора */}
          {/* <div style={{ padding: '0px 10px 0 10px', zIndex: 10 }}>*/}
          <div style={{ padding: '0px 10px 0 10px', zIndex: 10, minWidth: 0 }}>
            <Tabs />
          </div>

          {/* 2. Рабочий холст (Квадрат) */}
          <div style={{
            flexGrow: 1,
            margin: '0 10px 10px 10px',
            background: 'var(--app-bg)',
            borderRadius: '4px',
            border: '1px solid var(--border)',
            position: 'relative',
            overflow: 'hidden'
          }}>

            {!activeTab && (
              <StartScreen
                connections={connections}
                savedFlows={savedFlows}
                savedChains={savedChains}
              />
            )}

            {activeTab?.type === 'flow' && (
              <>
                {isProcessChain ? (
                  <ProcessChainWorkspace
                    activeTab={activeTab}
                    isChainMonitoring={isChainMonitoring}
                    activeChainId={activeChainId}
                    chainSchedule={chainSchedule}
                    cronExpr={cronExpr}
                    setCronExpr={setCronExpr}
                    cronLoading={cronLoading}
                    saveCron={saveCron}
                    pauseCron={pauseCron}
                    enableCron={enableCron}
                    chainMonitorState={chainMonitorState}
                    setChainMonitorState={setChainMonitorState}
                    displayedNodes={displayedNodes}
                    displayedEdges={displayedEdges}
                    flowStatusById={flowStatusById}
                    savedFlows={savedFlows}
                    connections={connections}
                    isReadOnlyCanvas={isReadOnlyCanvas}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeDoubleClick={onNodeSettingsOpen}
                    onNodeSettings={onNodeSettingsOpen}
                    chainSettingsNode={chainSettingsNode}
                    onCloseNodeSettings={() => setChainSettingsNodeId(null)}
                    updateNodeData={updateNodeData}
                    addNode={addNode}
                    handleApplyToStore={handleApplyToStore}
                    saveFlow={saveFlow}
                    runFlow={runFlow}
                    apiUrl={API_URL}
                  />
                ) : (
                  <>
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
                    </div>

                    <ReactFlow
                      nodes={displayedNodes.map((n) => ({
                        ...n,
                        style: {
                          ...n.style,
                          padding: 0,
                          border: '1px solid var(--border-node)',
                        },
                        data: {
                          ...n.data,
                          label: (
                            <FlowNodeLabel
                              node={n}
                              activeTab={activeTab}
                              savedFlows={savedFlows}
                              connections={connections}
                            />
                          )
                        }
                      }))}
                      edges={displayedEdges}
                      onNodesChange={onNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={isNormalFlow ? undefined : onConnect}
                      onNodeDoubleClick={onNodeSettingsOpen}
                      deleteKeyCode={isNormalFlow ? null : ['Backspace', 'Delete']}
                      nodesDraggable={true}
                      nodesConnectable={true}
                      edgesUpdatable={true}
                      fitView
                    >
                      <Background color="var(--grid)" gap={16} size={1} />
                      <Controls />
                    </ReactFlow>
                  </>
                )}
              </>
            )}

            {activeTab?.type === 'settings' && (
              <NodeSettings
                activeTab={activeTab}
                nodes={nodes}
                connections={connections}
                updateNodeData={updateNodeData}
              />
            )}

            {activeTab?.type === 'conn_form' && (


              <div style={{ padding: '50px 30px', maxWidth: '600px' }}>

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
                  {/*<div style={{ width: '10px', background: 'var(--border-strong)', margin: '0 5px' }}></div>*/}
                  <button
                    onClick={testConnection}
                    className="belt-button belt-button-warning"
                  >
                    {t(locale, 'common.test')}
                  </button>
                  <button onClick={saveConnection}
                    className="belt-button belt-button-success">
                    {t(locale, 'common.save')}
                  </button>
                </div>

                <h3>
                  Connection: {activeTab?.connData?.id ? `${newConnName} (${activeTab.connData.id})` : 'New connection'}
                </h3>
                <input
                  placeholder="Name (for expml, source_postgres)"
                  value={newConnName}
                  onChange={(e) => setNewConnName(e.target.value)}
                  style={{ width: '100%', padding: '10px', boxSizing: 'border-box', marginBottom: '15px', background: 'var(--input-bg)', color: 'var(--text)', border: '1px solid var(--border-strong)' }}
                />
                <select
                  value={connectionType}
                  onChange={(e) => handleConnectionTypeChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginBottom: '15px',
                    background: 'var(--input-bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border-strong)'
                  }}
                >
                  <option value="" disabled>Select connetion type</option>
                  <option value="postgres">Postgres</option>
                  <option value="clickhouse">ClickHouse</option>
                  <option value="python">Python</option>
                </select>
                <textarea
                  value={newConnConfig}
                  onChange={(e) => setNewConnConfig(e.target.value)}
                  rows="20"
                  style={{ width: '100%', padding: '10px', background: 'var(--editor-bg)', color: 'var(--text-code)', border: '1px solid var(--border-strong)', fontFamily: 'monospace' }}
                />
              </div>
            )}

            {activeTab?.type === 'logs' && (
              <MonitoringTab
                API_URL={API_URL}
                activeTab={activeTab}
                addTab={addTab}
                setActiveTab={setActiveTab}
              />
            )}

            {activeTab?.type === 'operations' && (
              <Suspense fallback={<div style={{ padding: '20px' }}>Loading operations...</div>}>
                <OperationsTab API_URL={API_URL} />
              </Suspense>
            )}

            {activeTab?.type === 'lineage' && (
              <LineageTab API_URL={API_URL} connections={connections} />
            )}

            {activeTab?.type === 'transfer-packages' && (
              deployAllowed !== null && (
                <TransferPackagesTab
                  API_URL={API_URL}
                  connections={connections}
                  flows={savedFlows}
                  chains={savedChains}
                  canDeploy={deployAllowed}
                />
              )
            )}

          </div>
        </div>



      </div >
      {
        showSettings && (
          <SettingsModal
            API_URL={API_URL}
            email={currentUserEmail}
            onClose={() => setShowSettings(false)}
          />
        )
      }
    </div >
  );
}