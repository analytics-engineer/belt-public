import React from 'react';

function HomeDashboard({
  connectionsCount = 0,
  flowsCount = 0,
  chainsCount = 0,
  onOpenConnections,
  onOpenFlows,
  onOpenChains
}) {
  const cards = [
    {
      title: 'Connections',
      value: connectionsCount,
      onClick: onOpenConnections
    },
    {
      title: 'Flows',
      value: flowsCount,
      onClick: onOpenFlows
    },
    {
      title: 'Chains',
      value: chainsCount,
      onClick: onOpenChains
    }
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: '16px',
        justifyContent: 'center',
        marginBottom: '50px'
      }}
    >
      {cards.map((card) => (
        <div
          key={card.title}
          onClick={card.onClick}
          style={{
            minWidth: '160px',
            padding: '18px 22px',
            border: '1px solid var(--border-strong)',
            borderRadius: '10px',
            background: 'var(--panel-bg)',
            color: 'var(--text)',
            textAlign: 'center',
            cursor: card.onClick ? 'pointer' : 'default',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
          }}
        >
          <div
            style={{
              fontSize: '13px',
              opacity: 0.75,
              marginBottom: '8px'
            }}
          >
            {card.title}
          </div>

          <div
            style={{
              fontSize: '30px',
              fontWeight: 700,
              lineHeight: 1
            }}
          >
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export default HomeDashboard;