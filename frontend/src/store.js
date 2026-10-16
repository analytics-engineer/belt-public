import { create } from 'zustand';

const useStore = create((set, get) => ({
  tabs: [],
  activeTabId: null,

  displayName: '',
  theme: 'dark',
  locale: 'en',

  setDisplayName: (displayName) => set({ displayName }),
  setTheme: (theme) => set({ theme }),
  setLocale: (locale) => set({ locale }),

  setUserSettings: (settings) => set({
    displayName: settings.displayName ?? '',
    theme: settings.theme || 'dark',
    locale: settings.locale || 'en'
  }),

  addTab: (tab) => set((state) => {
    const exists = state.tabs.find((t) => t.id === tab.id);
    if (exists) return { activeTabId: tab.id };

    const activeIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);
    const insertIndex = activeIndex >= 0 ? activeIndex + 1 : state.tabs.length;

    const newTabs = [...state.tabs];
    newTabs.splice(insertIndex, 0, tab);

    return {
      tabs: newTabs,
      activeTabId: tab.id
    };
  }),

  openMonitoringTab: (tabConfig) => set((state) => {
    const exists = state.tabs.some((t) => t.id === tabConfig.id);

    let nextTabs;

    if (exists) {
      nextTabs = state.tabs.map((t) =>
        t.id === tabConfig.id ? { ...t, ...tabConfig } : t
      );
    } else {
      const activeIndex = state.tabs.findIndex((t) => t.id === state.activeTabId);
      const insertIndex = activeIndex >= 0 ? activeIndex + 1 : state.tabs.length;

      nextTabs = [...state.tabs];
      nextTabs.splice(insertIndex, 0, tabConfig);
    }

    const nextMonitoringTablesByTab = { ...state.monitoringTablesByTab };
    delete nextMonitoringTablesByTab[tabConfig.id];

    return {
      tabs: nextTabs,
      activeTabId: tabConfig.id,
      monitoringTablesByTab: nextMonitoringTablesByTab
    };
  }),

  openNodeSettingsTab: ({ activeTab, node }) => {
    if (!activeTab || !node) return;

    const flowTitle = activeTab.title;

    let displayNodeType =
      activeTab.flow_type === 'transformation' && node.type === 'default'
        ? 'transform'
        : node.type;

    if (activeTab.flow_type === 'process_chain') {
      displayNodeType = `flow ${node.data?.flow_id || 'not selected'}`;
    }

    get().addTab({
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
  },

  openFlowObjectFromNode: async ({ apiUrl, node }) => {
    const flowId = node?.data?.flow_id;

    if (!flowId) return alert('Flow is not selected in this node');

    try {
      const res = await fetch(`${apiUrl}/flows/${flowId}`);

      if (!res.ok) {
        throw new Error('Flow open error');
      }

      const flow = await res.json();

      get().addTab({
        id: `flow-${flowId}`,
        title: `Flow ${flowId}`,
        name: flow.name,
        type: 'flow',
        tabKind: 'flow',
        flow_type: flow.data?.flow_type,
        data: flow.data
      });
    } catch (e) {
      alert('Error open flow');
    }
  },

  openChainNodeFlowMonitoringTab: ({ apiUrl, activeTab, node, chainRunId }) => {
    const flowId = node?.data?.flow_id;
    const chainId = activeTab?.id?.startsWith('chain-')
      ? activeTab.id.replace('chain-', '')
      : null;

    if (!chainRunId) return alert('First, select chain run in graphical monitoring');
    if (!flowId) return alert('The node has no flow_id selected');

    get().openMonitoringTab({
      id: 'monitor-flow-runs',
      title: `Chain ${chainId} / Run ${chainRunId} / Flow ${flowId}`,
      type: 'logs',
      tabKind: 'monitor',
      logLevel: 'flow_runs',
      endpointUrl: `${apiUrl}/get_metadata_data/monitor_flow_runs`,
      tableName: 'monitor_flow_runs',
      filters: {
        chain_run_id: chainRunId,
        flow_id: flowId
      },
      chainId,
      chainRunId,
      flowId
    });
  },

  updateTabFileData: (id, newData) => set((state) => ({
    tabs: state.tabs.map(t => t.id === id ? { ...t, data: { ...t.data, ...newData } } : t)
  })),

  updateTabTitle: (id, newTitle) => set((state) => ({
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: newTitle } : t))
  })),

  updateNodeInFlow: (flowTabId, nodeId, newNodeData) => set((state) => ({
    tabs: state.tabs.map(tab => {
      if (tab.id === flowTabId) {
        return {
          ...tab,
          data: {
            ...tab.data,
            nodes: tab.data.nodes.map(n =>
              n.id === nodeId ? { ...n, data: { ...n.data, ...newNodeData } } : n
            )
          }
        };
      }
      return tab;
    })
  })),

  closeTab: (id) => set((state) => {
    const idsToClose = new Set([id]);

    state.tabs.forEach((tab) => {
      if (tab.parentFlowId === id) {
        idsToClose.add(tab.id);
      }
    });

    const newTabs = state.tabs.filter((t) => !idsToClose.has(t.id));

    let newActiveTabId = state.activeTabId;

    if (idsToClose.has(state.activeTabId)) {
      newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }

    const newMonitoringTablesByTab = { ...state.monitoringTablesByTab };
    const newNodeSettingsSqlPreview = { ...state.nodeSettingsSqlPreview };

    idsToClose.forEach((tabId) => {
      delete newMonitoringTablesByTab[tabId];
      delete newNodeSettingsSqlPreview[tabId];
    });

    return {
      tabs: newTabs,
      activeTabId: newActiveTabId,
      monitoringTablesByTab: newMonitoringTablesByTab,
      nodeSettingsSqlPreview: newNodeSettingsSqlPreview
    };
  }),

  replaceTab: (oldId, newTab) => set((state) => ({
    tabs: state.tabs.map(t => t.id === oldId ? { ...t, ...newTab } : t),
    activeTabId: newTab.id
  })),

  // --- ЭТО ДОБАВИЛИ ДЛЯ ОПЕРАЦИЙ ---
  connectionsList: [],
  setConnectionsList: (data) => set({ connectionsList: data }),
  objectsList: [],
  setObjectsList: (data) => set({ objectsList: data }),
  // --------------------------------

  operationsSelectedRequest: null,
  setOperationsSelectedRequest: (row) => set({
    operationsSelectedRequest: row
  }),

  operationsData: null,
  setOperationsData: (data) => set({
    operationsData: data
  }),

  clearOperationsData: () => set({
    operationsData: null
  }),

  clearOperationsSelectedRequest: () => set({
    operationsSelectedRequest: null
  }),

  transferPackageData: {
    selectedTypes: {
      connections: false,
      flows: false,
      chains: false,
      python_files: false
    },
    createdPackage: null,
    importFile: null,
    uploadedPackage: null
  },

  setTransferPackageData: (patch) => set((state) => ({
    transferPackageData: {
      ...state.transferPackageData,
      ...patch,
      selectedTypes: patch.selectedTypes
        ? {
            ...state.transferPackageData.selectedTypes,
            ...patch.selectedTypes
          }
        : state.transferPackageData.selectedTypes
    }
  })),

  monitoringTablesByTab: {},

  nodeSettingsSqlPreview: {},

  setNodeSettingsSqlPreview: (tabId, patch) => set((state) => {
    const current = state.nodeSettingsSqlPreview[tabId] || {
      rows: [],
      open: false,
      loading: false,
      error: ''
    };

    return {
      nodeSettingsSqlPreview: {
        ...state.nodeSettingsSqlPreview,
        [tabId]: {
          ...current,
          ...patch
        }
      }
    };
  }),

  setMonitoringTableState: (tabId, patch) => set((state) => {
    const current = state.monitoringTablesByTab[tabId] || {
      rows: null,
      total: null,
      limit: 100,
      offset: 0,
      filterModel: {},
      selectedRow: null,
      selectedCell: null,
      loading: false,
      errorText: ''
    };

    return {
      monitoringTablesByTab: {
        ...state.monitoringTablesByTab,
        [tabId]: {
          ...current,
          ...patch
        }
      }
    };
  }),

  clearMonitoringTableSelection: (tabId) => set((state) => {
    const current = state.monitoringTablesByTab[tabId] || {};

    return {
      monitoringTablesByTab: {
        ...state.monitoringTablesByTab,
        [tabId]: {
          ...current,
          selectedRow: null,
          selectedCell: null
        }
      }
    };
  }),

  clearMonitoringTableState: (tabId) => set((state) => {
    const next = { ...state.monitoringTablesByTab };
    delete next[tabId];

    return {
      monitoringTablesByTab: next
    };
  }),

  lineageData: {
    connectionId: null,
    objectName: '',
    flowBlocks: []
  },

  setLineageData: (patch) =>
    set((state) => ({
      lineageData: {
        ...state.lineageData,
        ...patch
      }
    })),

  operationsDetailsRequest: null,
  setOperationsDetailsRequest: (request) => set({ operationsDetailsRequest: request }),
  clearOperationsDetailsRequest: () => set({ operationsDetailsRequest: null }),

  docsIndex: [],
  docsCache: {},
  activeDocSlug: null,
  docsScroll: {},
  expandedDocGroups: {},

  setDocsIndex: (docsIndex) => set({ docsIndex }),

  setActiveDocSlug: (activeDocSlug) => set({ activeDocSlug }),

  setDocCache: (slug, markdown) => set((state) => ({
    docsCache: {
      ...state.docsCache,
      [slug]: markdown
    }
  })),

  setDocScroll: (slug, scrollTop) => set((state) => ({
    docsScroll: {
      ...state.docsScroll,
      [slug]: scrollTop
    }
  })),

  toggleDocGroup: (key) => set((state) => ({
    expandedDocGroups: {
      ...state.expandedDocGroups,
      [key]: !state.expandedDocGroups[key]
    }
  })),

  chainMonitorByTab: {},

  setChainMonitorState: (tabId, patch) => set((state) => {
    const current = state.chainMonitorByTab[tabId] || {
      mode: 'modeling',
      expanded: {},
      runsByDay: {},
      selectedRunId: null,
      selectedDateKey: null,
      selectedRunDetails: null,
      loadingDay: null,
      refreshRunsRequestId: 0
    };

    return {
      chainMonitorByTab: {
        ...state.chainMonitorByTab,
        [tabId]: {
          ...current,
          ...patch
        }
      }
    };
  }),

  requestChainRunsRefresh: (tabId) => set((state) => {
    const current = state.chainMonitorByTab[tabId] || {
      mode: 'modeling',
      expanded: {},
      runsByDay: {},
      selectedRunId: null,
      selectedDateKey: null,
      selectedRunDetails: null,
      loadingDay: null,
      refreshRunsRequestId: 0
    };

    return {
      chainMonitorByTab: {
        ...state.chainMonitorByTab,
        [tabId]: {
          ...current,
          refreshRunsRequestId: (current.refreshRunsRequestId || 0) + 1
        }
      }
    };
  }),

  closeChainMonitoring: (tabId) => set((state) => {
    const current = state.chainMonitorByTab[tabId] || {};

    return {
      chainMonitorByTab: {
        ...state.chainMonitorByTab,
        [tabId]: {
          ...current,
          mode: 'modeling'
        }
      }
    };
  }),

  setActiveTab: (id) => set({ activeTabId: id }),
}));


// Удалить на продуктиве
if (window) {
  window.store = useStore;
}

export default useStore;