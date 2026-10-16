import React, { useEffect, useRef } from 'react';
import axios from 'axios';

export default function ChainRunsArchive({
  activeTabId,
  activeChainId,
  chainMonitorState,
  setChainMonitorState,
  apiUrl
}) {
  const lastRefreshRequestIdRef = useRef(null);
  const monitorYears = [2026];

  const monitorMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const getDaysInMonth = (year, monthIndex) => {
    return new Date(year, monthIndex + 1, 0).getDate();
  };

  const formatDateKey = (year, monthIndex, day) => {
    const mm = String(monthIndex + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  };

  const addOneDay = (dateKey) => {
    const [year, month, day] = dateKey.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    if (day < daysInMonth) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`;
    }

    if (month < 12) {
      return `${year}-${String(month + 1).padStart(2, '0')}-01`;
    }

    return `${year + 1}-01-01`;
  };

  const toggleMonitorExpanded = (key) => {
    const expanded = chainMonitorState?.expanded || {};

    setChainMonitorState(activeTabId, {
      expanded: {
        ...expanded,
        [key]: !expanded[key]
      }
    });
  };

  const loadRunsForDay = async (dateKey, forceReload = false) => {
    if (!activeChainId) return;

    const runsByDay = chainMonitorState?.runsByDay || {};
    const expanded = chainMonitorState?.expanded || {};

    const dayOpen = !!expanded[dateKey];

    if (!forceReload && dayOpen) {
      setChainMonitorState(activeTabId, {
        expanded: {
          ...expanded,
          [dateKey]: false
        }
      });
      return;
    }

    if (!forceReload && runsByDay[dateKey]) {
      setChainMonitorState(activeTabId, {
        expanded: {
          ...expanded,
          [dateKey]: true
        }
      });
      return;
    }

    try {
      setChainMonitorState(activeTabId, {
        loadingDay: dateKey,
        expanded: {
          ...expanded,
          [dateKey]: true
        }
      });

      const res = await axios.get(`${apiUrl}/process-chains/${activeChainId}/runs`, {
        params: {
          date_from: dateKey,
          date_to: addOneDay(dateKey)
        }
      });

      setChainMonitorState(activeTabId, {
        loadingDay: null,
        runsByDay: {
          ...runsByDay,
          [dateKey]: res.data
        }
      });
    } catch (err) {
      setChainMonitorState(activeTabId, { loadingDay: null });
      alert('Load runs error: ' + (err.response?.data?.detail || err.message));
    }
  };

  const loadChainRunDetails = async (runId, dateKey) => {
    setChainMonitorState(activeTabId, {
      selectedRunId: runId,
      selectedDateKey: dateKey
    });

    try {
      const res = await axios.get(`${apiUrl}/process-chain-runs/${runId}`);

      setChainMonitorState(activeTabId, {
        selectedRunId: runId,
        selectedDateKey: dateKey,
        selectedRunDetails: res.data
      });
    } catch (err) {
      alert('Load run details error: ' + (err.response?.data?.detail || err.message));
    }
  };

  useEffect(() => {
    const refreshRequestId = chainMonitorState?.refreshRunsRequestId;

    if (!refreshRequestId || lastRefreshRequestIdRef.current === refreshRequestId) return;

    lastRefreshRequestIdRef.current = refreshRequestId;

    const refreshRuns = async () => {
      const selectedDateKey = chainMonitorState?.selectedDateKey;
      const selectedRunId = chainMonitorState?.selectedRunId;

      if (!selectedDateKey) {
        setChainMonitorState(activeTabId, {
          runsByDay: {},
          loadingDay: null
        });
        return;
      }

      await loadRunsForDay(selectedDateKey, true);

      if (selectedRunId) {
        await loadChainRunDetails(selectedRunId, selectedDateKey);
      }
    };

    refreshRuns();
  }, [chainMonitorState?.refreshRunsRequestId]);

  const getRunStatusColor = (status) => {
    const s = String(status || '').toLowerCase();

    if (s === 'success') return 'var(--success-text)';
    if (s === 'running') return 'var(--warning-text)';
    if (s === 'error') return 'var(--danger-text)';

    return 'var(--text-muted)';
  };

  return (
    <div style={{ height: 'calc(100% - 30px)', overflowY: 'auto' }}>
      {monitorYears.map((year) => {
        const yearKey = `year-${year}`;
        const yearOpen = chainMonitorState?.expanded?.[yearKey];

        return (
          <div key={yearKey}>
            <div
              onClick={() => toggleMonitorExpanded(yearKey)}

              style={{ cursor: 'pointer', padding: '4px 2px' }}
            >
              {yearOpen ? '▾' : '▸'} {year}
            </div>

            {yearOpen && monitorMonths.map((monthName, monthIndex) => {
              const monthKey = `month-${year}-${monthIndex}`;
              const monthOpen = chainMonitorState?.expanded?.[monthKey];

              return (
                <div key={monthKey} style={{ paddingLeft: 14 }}>
                  <div
                    onClick={() => toggleMonitorExpanded(monthKey)}
                    style={{ cursor: 'pointer', padding: '3px 2px' }}
                  >
                    {monthOpen ? '▾' : '▸'} {monthName}
                  </div>

                  {monthOpen && Array.from(
                    { length: getDaysInMonth(year, monthIndex) },
                    (_, i) => i + 1
                  ).map((day) => {
                    const dateKey = formatDateKey(year, monthIndex, day);
                    const dayOpen = chainMonitorState?.expanded?.[dateKey];
                    const runs = chainMonitorState?.runsByDay?.[dateKey] || [];
                    const loading = chainMonitorState?.loadingDay === dateKey;

                    return (
                      <div key={dateKey} style={{ paddingLeft: 14 }}>
                        <div
                          onClick={() => loadRunsForDay(dateKey)}
                          style={{ cursor: 'pointer', padding: '2px 2px' }}
                        >
                          {dayOpen ? '▾' : '▸'} {String(day).padStart(2, '0')}
                          {loading ? ' loading...' : ''}
                        </div>

                        {dayOpen && runs.map((run) => {
                          const isSelectedRun = String(chainMonitorState?.selectedRunId) === String(run.id);

                          return (
                            <div
                              key={run.id}
                              onClick={() => loadChainRunDetails(run.id, dateKey)}
                              style={{
                                padding: '2px 2px 2px 15px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                color: getRunStatusColor(run.status),
                                background: isSelectedRun ? 'rgba(97, 218, 251, 0.12)' : 'transparent',
                                borderRadius: '5px',
                                margin: '1px 0'
                              }}
                            >
                              {new Date(run.started_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              })} #{run.id}
                            </div>
                          );
                        })}

                        {dayOpen && !loading && runs.length === 0 && (
                          <div style={{ paddingLeft: 18, fontSize: '12px', color: 'var(--text-muted)' }}>
                            no runs
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}