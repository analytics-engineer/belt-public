import React from 'react';
import useStore from './store';

export default function Tabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useStore();

  return (
    <div style={{ display: 'flex', color: '#fff', padding: '3px 0px 0 0px', gap: '2px' }}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          style={{
            padding: '2px 5px 3px 10px',
            cursor: 'pointer',
            background: activeTabId === tab.id ? 'var(--activetab-bg)' : 'var(--notactivetab-bg)',
            color: activeTabId === tab.id ? 'var(--text-dark)' : 'var(--text)',
            borderRadius: '5px 5px 0 0',
            border: '1px solid var(--border-tab)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            borderBottom: 'none',
            marginBottom: '-1px',
          }}
        >
          {tab.title}
          {(
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title="Close tab"
              style={{
                width: '18px',
                height: '18px',
                minWidth: '18px',
                padding: 0,
                marginLeft: '0px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'None',
                borderRadius: '4px',
                background: 'transparent',
                color: 'var(--danger)',
                cursor: 'pointer',
                fontSize: '26px',
                lineHeight: 1
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}