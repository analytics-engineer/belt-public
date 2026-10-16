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

export default function PostgresTransformationTargetFields({
  formData,
  handleChange,
  handleLoadTargetColumns,
  loadingTargetColumns
}) {
  useEffect(() => {
    if (!formData.schema_name) {
      handleChange('schema_name', 'public');
    }

    if (!formData.truncate_table_before_load) {
      handleChange('truncate_table_before_load', 'false');
    }
  }, [formData.schema_name, formData.truncate_table_before_load, handleChange]);

  useEffect(() => {
    if (formData.recalculate_target_delta_boundaries == null) {
      handleChange('recalculate_target_delta_boundaries', 'true');
    }
  }, [formData.recalculate_target_delta_boundaries, handleChange]);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '600px 600px',
      gap: '40px',
      alignItems: 'start'
    }}>
      <div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Target schema name:</label>
          <input
            type="text"
            value={formData.schema_name || 'public'}
            onChange={(e) => handleChange('schema_name', e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Journal table name:<span class='obligatory-notice'> - Optional</span></label>
          <input
            type="text"
            value={formData.journal_table || ''}
            onChange={(e) => handleChange('journal_table', e.target.value)}
            style={inputStyle}
          />
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

      <div>
        <div style={{ marginBottom: '20px', marginTop: '-80px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Postgres version:</label>
          <input
            type="text"
            value={formData.pg_version || ''}
            onChange={(e) => handleChange('pg_version', e.target.value)}
            placeholder="16"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Target delta column:<span class='obligatory-notice'> - Optional</span></label>
          <input
            type="text"
            value={formData.target_delta_column || ''}
            onChange={(e) => handleChange('target_delta_column', e.target.value)}
            placeholder=""
            style={inputStyle}
          />
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
          <label style={{ display: 'block', marginBottom: '8px' }}>Key columns:<span class='obligatory-notice'> - Optional</span></label>
          <input
            type="text"
            value={formData.keys || ''}
            onChange={(e) => handleChange('keys', e.target.value)}
            placeholder="id, date"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>On conflict:<span class='obligatory-notice'> - Optional</span></label>
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
    </div>
  );
}