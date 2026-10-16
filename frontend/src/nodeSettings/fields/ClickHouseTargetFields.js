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

function TextField({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <label style={{ display: 'block', marginBottom: '8px' }}>{label}</label>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

export default function ClickHouseTargetFields({
  formData,
  handleChange,
  showColumns = false
}) {
  useEffect(() => {
    if (!formData.truncate_table_before_load) {
      handleChange('truncate_table_before_load', 'false');
    }
  }, [formData.truncate_table_before_load, handleChange]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '600px',
      gap: '40px',
      alignItems: 'start'
    }}>
      <div>
        <div style={{ marginBottom: '20px', color: 'var(--text-muted)' }}>
          ClickHouse database is taken from connection config: dbname/database.
        </div>

        <TextField
          label="Target table name:"
          value={formData.target_table}
          onChange={(value) => handleChange('target_table', value)}
        />

        {showColumns && (
          <TextField
            label="Columns:"
            value={formData.columns}
            onChange={(value) => handleChange('columns', value)}
            placeholder="business_col1, business_col2"
          />
        )}

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Truncate table before load:</label>
          <select
            value={formData.truncate_table_before_load || 'false'}
            onChange={(e) => handleChange('truncate_table_before_load', e.target.value)}
            style={selectStyle}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
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
      </div>
    </div>
  );
}