import React from 'react';
import useStore from './store';

function TabIcon({ tabKind }) {
  let path;

  if (tabKind === 'chain') {
    /*path = 'M7 7h4v4H7V7Zm10 0h4v4h-4V7ZM7 17h4v4H7v-4Zm10 0h4v4h-4v-4ZM11 9h6M9 11v6M19 11v6M11 19h6';*/
    path = 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1';
  } else if (tabKind === 'flow') {
    path = 'M5 12h12M13 8l4 4-4 4M5 6h6M5 18h6';
  } else if (tabKind === 'conn') {
    path = 'M8 7v5M16 7v5M7 12h10v3a5 5 0 0 1-10 0v-3ZM12 20v2';
  } else if (tabKind === 'monitor') {
    /*path = 'M5 5h14v14H5V5Zm3 4h8M8 12h8M8 15h5';*/
    path = 'M7 18V12M12 18V8M17 18V4';
  } else if (tabKind === 'operations') {
    path = 'M5 7h14M5 12h14M5 17h14M8 5v14M16 5v14';
  } else if (tabKind === 'lineage') {
    path = 'M6 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 10l8-3M8 11l8 6';
  }  else if (tabKind === 'deploy') {
  path = 'M14.5 4.5c2.5-1 4.5-.5 5-.5 0 .5.5 2.5-.5 5l-4 4-4-4 3.5-4.5ZM9 11l-4 1-2 3 5 1M13 15l-1 4-3 2-1-5M10 14l-2-2M14 10l-4 4';
  }  else if (tabKind === 'transform_node') {
    path = 'M7 8c-2.2 0-4 1.8-4 4s1.8 4 4 4c2.8 0 4.2-4 5-4s2.2 4 5 4c2.2 0 4-1.8 4-4s-1.8-4-4-4c-2.8 0-4.2 4-5 4S9.8 8 7 8Z';
    /*path = 'M7 8c-2.2 0-4 1.8-4 4s1.8 4 4 4c2.8 0 4.2-4 5-4s2.2 4 5 4c2.2 0 4-1.8 4-4s-1.8-4-4-4c-2.8 0-4.2 4-5 4S9.8 8 7 8Z';*/
  } else if (tabKind === 'target_node') {
    path = 'M12 3 21 8v10l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v10';
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
        padding: '3px 0 0 0',
        gap: '2px',
        whiteSpace: 'nowrap',
        width: '100%',
        minWidth: 0
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
              minWidth: '44px',
              maxWidth: '180px',
              padding: '3px 5px 4px 8px',
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
              flex: '1 1 120px',
              overflow: 'hidden',
              boxSizing: 'border-box'
            }}
          >
            <TabIcon tabKind={tab.tabKind} />

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
                opacity: 0.75,
                flex: '0 0 auto'
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