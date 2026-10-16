import React from 'react';
import useStore from './store';

function TabIcon({ tab }) {
  let path;

  if (tab.type === 'flow' && tab.flow_type === 'process_chain') {
    path = 'M7 7h4v4H7V7Zm10 0h4v4h-4V7ZM7 17h4v4H7v-4Zm10 0h4v4h-4v-4ZM11 9h6M9 11v6M19 11v6M11 19h6';
  } else if (tab.type === 'flow') {
    path = 'M5 12h12M13 8l4 4-4 4M5 6h6M5 18h6';
  } else if (tab.type === 'conn_form') {
    path = 'M8 7v5M16 7v5M7 12h10v3a5 5 0 0 1-10 0v-3ZM12 20v2';
  } else if (tab.type === 'logs') {
    path = 'M5 5h14v14H5V5Zm3 4h8M8 12h8M8 15h5';
  } else if (tab.type === 'operations') {
    path = 'M5 7h14M5 12h14M5 17h14M8 5v14M16 5v14';
  } else if (tab.type === 'lineage') {
    path = 'M6 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 10l8-3M8 11l8 6';
  } else {
    path = 'M7 4h8l4 4v12H7V4Zm8 0v5h5';
  }

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: '0 0 auto' }}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export default function Tabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useStore();

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        overflowX: 'auto',
        overflowY: 'hidden',
        padding: '3px 0 0 0',
        gap: '2px',
        whiteSpace: 'nowrap'
      }}
    >
      {tabs.map((tab) => {
        const label = tab.title || '';

        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={label}
            style={{
              height: '34px',
              width: '180px',
              minWidth: '90px',
              padding: '0 5px 0 8px',
              cursor: 'pointer',
              background: activeTabId === tab.id ? 'var(--activetab-bg)' : 'var(--notactivetab-bg)',
              color: activeTabId === tab.id ? 'var(--text-dark)' : 'var(--text)',
              borderRadius: '5px 5px 0 0',
              border: '1px solid var(--border-tab)',
              borderBottom: 'none',
              marginBottom: '-1px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flex: '0 0 auto',
              boxSizing: 'border-box',
              overflow: 'hidden'
            }}
          >
            <TabIcon tab={tab} />

            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: '1 1 auto',
                fontSize: '13px'
              }}
            >
              {label}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title="Close tab"
              style={{
                width: '16px',
                height: '16px',
                minWidth: '16px',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: '4px',
                background: 'transparent',
                color: 'currentColor',
                cursor: 'pointer',
                fontSize: '18px',
                lineHeight: 1,
                opacity: 0.75
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}