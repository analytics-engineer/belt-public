import React from 'react';

const inputStyle = {
  width: '600px',
  padding: '8px',
  boxSizing: 'border-box',
  background: 'var(--input-bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)'
};

const selectStyle = {
  width: '600px',
  padding: '8px',
  background: 'var(--input-bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)'
};

export default function ClickHouseTransformationSourceFields({
  formData,
  handleChange
}) {
  return (
    <div style={{ width: '600px' }}>
      <div style={{ marginBottom: '20px', color: 'var(--text-muted)' }}>
        ClickHouse database is taken from connection config: dbname/database.
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>Source table name:</label>
        <input
          type="text"
          value={formData.table_name || ''}
          onChange={(e) => handleChange('table_name', e.target.value)}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>Mode:</label>
        <select
          value={formData.mode || ''}
          onChange={(e) => handleChange('mode', e.target.value)}
          style={selectStyle}
        >
          <option value="">Select mode...</option>
          <option value="full">full</option>
          <option value="delta">delta</option>
        </select>
      </div>
    </div>
  );
}