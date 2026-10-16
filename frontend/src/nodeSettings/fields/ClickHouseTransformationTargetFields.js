import React, { useEffect } from 'react';

const inputStyle = {
  width: '600px',
  padding: '8px',
  boxSizing: 'border-box',
  background: 'var(--input-bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)'
};

export default function ClickHouseTransformationTargetFields({
  formData,
  handleChange,
  handleLoadTargetColumns,
  loadingTargetColumns = false
}) {
  useEffect(() => {
    if (formData.recalculate_target_delta_boundaries == null) {
      handleChange('recalculate_target_delta_boundaries', 'false');
    }
  }, [formData.recalculate_target_delta_boundaries, handleChange]);

  return (
    <div style={{ width: '600px' }}>
      <div style={{ marginBottom: '20px', color: 'var(--text-muted)' }}>
        ClickHouse database is taken from connection config: dbname/database.
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>Target table name:</label>
        <input
          type="text"
          value={formData.target_table || ''}
          onChange={(e) => handleChange('target_table', e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          Target delta column:<span class='obligatory-notice'> - Optional</span>
        </label>
        <input
          type="text"
          value={formData.target_delta_column || ''}
          onChange={(e) => handleChange('target_delta_column', e.target.value)}
          style={inputStyle}
        />
        <div style={{ fontSize: '12px', color: '#999', marginTop: '6px' }}>
          Required if target delta column differs from source batch column
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          Recalculate target delta boundaries:
        </label>
        <select
          value={String(formData.recalculate_target_delta_boundaries ?? true)}
          onChange={(e) => handleChange('recalculate_target_delta_boundaries', e.target.value)}
          style={inputStyle}
        >
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ marginBottom: '8px' }}>Columns:</label>
          <button
            type="button"
            onClick={handleLoadTargetColumns}
            title="Load target columns"
            className="load-columns-button"
            style={{
              width: '24px',
              height: '24px',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              color: 'var(--button-update)',
              border: '1px solid var(--border-soft)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '20px',
              lineHeight: 1
            }}
          >
            <span className={loadingTargetColumns ? 'spin-icon' : ''}>⟳</span>
          </button>
        </div>
        <input
          type="text"
          value={formData.columns || ''}
          onChange={(e) => handleChange('columns', e.target.value)}
          style={inputStyle}
        />
      </div>


      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>Additional info(text, json):<span class='obligatory-notice'> - Optional</span></label>
        <input
          type="text"
          value={formData.add_info || ''}
          onChange={(e) => handleChange('add_info', e.target.value)}
          style={inputStyle}
        />
      </div>
    </div >
  );
}