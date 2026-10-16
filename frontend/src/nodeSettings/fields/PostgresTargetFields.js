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

function ColumnsField({ formData, handleChange, handleLoadTargetColumns, loadingTargetColumns }) {
  return (
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
  );
}

export default function PostgresTargetFields({
  formData,
  handleChange,
  handleLoadTargetColumns,
  loadingTargetColumns,
  showColumns = false,
  showPostgresOptions = false
}) {
  useEffect(() => {
    if (!formData.truncate_table_before_load) {
      handleChange('truncate_table_before_load', 'false');
    }
  }, [formData.truncate_table_before_load, handleChange]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: showPostgresOptions ? '600px 600px' : '600px',
      gap: '40px',
      alignItems: 'start'
    }}>
      <div>
        <TextField
          label="Target schema name:"
          value={formData.schema_name}
          onChange={(value) => handleChange('schema_name', value)}
        />

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Journal table name:<span class='obligatory-notice'> - Optional</span></label>
          <input
            type="text"
            value={formData.journal_table || ''}
            onChange={(e) => handleChange('journal_table', e.target.value)}
            style={inputStyle}
          />
        </div>

        <TextField
          label="Target table name:"
          value={formData.target_table}
          onChange={(value) => handleChange('target_table', value)}
        />

        {showColumns && (
          <ColumnsField
            formData={formData}
            handleChange={handleChange}
            handleLoadTargetColumns={handleLoadTargetColumns}
            loadingTargetColumns={loadingTargetColumns}
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

      {showPostgresOptions && (
        <div>
          <TextField
            label="Postgres version:"
            value={formData.pg_version}
            onChange={(value) => handleChange('pg_version', value)}
            placeholder="16"
          />

          <TextField
            label="Key columns:"
            value={formData.keys}
            onChange={(value) => handleChange('keys', value)}
            placeholder="id, date"
          />

          <div>
            <label style={{ display: 'block', marginBottom: '8px' }}>On conflict:</label>
            <select
              value={formData.on_conflict || ''}
              onChange={(e) => handleChange('on_conflict', e.target.value)}
              style={selectStyle}
            >
              <option value="">Select on_conflict do...</option>
              <option value="update">update</option>
              <option value="nothing">nothing</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}