import React, { useEffect } from 'react';

const inputStyle = {
  width: '100%',
  padding: '8px',
  boxSizing: 'border-box',
  background: 'var(--input-bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)'
};

const selectStyle = {
  width: '100%',
  padding: '8px',
  background: 'var(--input-bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)'
};

export default function PostgresTransformationSourceFields({
  formData,
  handleChange
}) {
  useEffect(() => {
    if (!formData.mode) {
      handleChange('mode', 'delta');
    }
  }, [formData.mode, handleChange]);
  return (
    <div style={{ width: '600px' }}>
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>Source schema name:</label>
        <input
          type="text"
          value={formData.schema_name || ''}
          onChange={(e) => handleChange('schema_name', e.target.value)}
          style={inputStyle}
        />
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
          value={formData.mode || 'delta'}
          onChange={(e) => handleChange('mode', e.target.value)}
          style={selectStyle}
        >
          <option value="full">full</option>
          <option value="delta">delta</option>
        </select>
      </div>
    </div>
  );
}