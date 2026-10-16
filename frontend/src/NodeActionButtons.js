// NodeActionButtons.js
import React from 'react';

function NodeActionIcon({ type }) {
  if (type === 'packages') {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7l8-4 8 4-8 4-8-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M4 7v10l8 4 8-4V7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 11v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h10M18 17h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 5v4M8 10v4M14 15v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function NodeActionButtons({ isMonitoring = false, onSettingsClick, onMonitorClick, onOpenObjectClick, }) {
  const blockNodeEvent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleButtonClick = (e, callback) => {
    blockNodeEvent(e);
    if (callback) callback();
  };

  const buttonStyle = {
    width: '12px',
    height: '12px',
    padding: '0px',
    border: '1px solid #d8d8d8',
    borderRadius: '2px',
    background: '#f8f8f8',
    color: 'rgba(0, 0, 0, 0.55)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    lineHeight: 1,
    transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease'
  };

  const handleMouseEnter = (e) => {
    e.currentTarget.style.background = '#eaf2ff';
    e.currentTarget.style.borderColor = '#7aa7e8';
    e.currentTarget.style.color = '#0b63ce';
  };

  const handleMouseLeave = (e) => {
    e.currentTarget.style.background = buttonStyle.background;
    e.currentTarget.style.borderColor = '#d8d8d8';
    e.currentTarget.style.color = 'rgba(0, 0, 0, 0.55)';
  };

  return (
    <div
      className="nodrag nopan"
      onPointerDown={blockNodeEvent}
      onMouseDown={blockNodeEvent}
      onClick={blockNodeEvent}
      onDoubleClick={blockNodeEvent}
      style={{
        position: 'absolute',
        top: '0px',
        right: '1px',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        padding: '1px 3px',
        margin: '0px',
        borderRadius: '3px',
        background: '#fff',
        pointerEvents: 'auto'
      }}
    >
      <button
        type="button"
        className="nodrag nopan"
        title="Node settings"
        aria-label="Node settings"
        onPointerDown={blockNodeEvent}
        onMouseDown={blockNodeEvent}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => handleButtonClick(e, onSettingsClick)}
        onDoubleClick={blockNodeEvent}
        style={buttonStyle}
      >
        <NodeActionIcon type="settings" />
      </button>

      {onOpenObjectClick && (
        <button
          type="button"
          className="nodrag nopan"
          title="Open object"
          aria-label="Open object"
          onPointerDown={blockNodeEvent}
          onMouseDown={blockNodeEvent}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => handleButtonClick(e, onOpenObjectClick)}
          onDoubleClick={blockNodeEvent}
          style={buttonStyle}
        >
          ↗
        </button>
      )}

      {isMonitoring && (
        <button
          type="button"
          className="nodrag nopan"
          title="Monitoring"
          aria-label="Node packages"
          onPointerDown={blockNodeEvent}
          onMouseDown={blockNodeEvent}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => handleButtonClick(e, onMonitorClick)}
          onDoubleClick={blockNodeEvent}
          style={buttonStyle}
        >
          <NodeActionIcon type="packages" />
        </button>
      )}

    </div>
  );
}