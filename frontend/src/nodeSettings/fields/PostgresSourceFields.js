import React from 'react';

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

const textareaStyle = {
  width: '100%',
  padding: '8px',
  boxSizing: 'border-box',
  background: 'var(--editor-bg)',
  color: 'var(--text-code)',
  border: '1px solid var(--border-strong)',
  fontFamily: 'monospace'
};

export default function PostgresSourceFields({
  formData,
  handleChange,
  handleLoadColumns,
  loadingColumns,
  TIMEZONES
}) {
  const deltaColumnType = formData.delta_column_type || 'timestamp';
  const isIntDelta = deltaColumnType === 'int';
  const isDateDelta = deltaColumnType === 'date';
  const isTimestampDelta = deltaColumnType === 'timestamp';

  const getSafetyDisplayValue = () => {
    const raw = formData.safety_seconds;

    if (raw === undefined || raw === null || raw === '') {
      return '';
    }

    if (isDateDelta) {
      return String(Number(raw) / 86400);
    }

    return String(raw);
  };

  const handleSafetyChange = (value) => {
    if (value === '') {
      handleChange('safety_seconds', '0');
      return;
    }

    if (isDateDelta) {
      handleChange('safety_seconds', String(Number(value) * 86400));
      return;
    }

    handleChange('safety_seconds', value);
  };

  const handleDeltaColumnTypeChange = (value) => {
    handleChange('delta_column_type', value);

    if (value === 'int') {
      handleChange('delta_start', '0');
      handleChange('delta_batch_grain', '1000');
      handleChange('safety_seconds', '');
      return;
    }

    if (value === 'date') {
      handleChange('delta_start', '2026-01-01');
      handleChange('delta_batch_grain', 'day');
      return;
    }

    handleChange('delta_start', '2026-01-01 00:00:00');
    handleChange('delta_batch_grain', 'day');
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '600px 600px', gap: '40px', alignItems: 'start' }}>
      <div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ marginBottom: '8px' }}>Result columns:</label>
            <button
              type="button"
              onClick={handleLoadColumns}
              title="Load columns"
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
              <span className={loadingColumns ? 'spin-icon' : ''}>⟳</span>
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
          <label style={{ display: 'block', marginBottom: '8px' }}>
            Source SQL: <span class='obligatory-notice'> - Optional</span>
          </label>
          <textarea
            rows="16"
            value={formData.source_sql || ''}
            onChange={(e) => handleChange('source_sql', e.target.value)}
            placeholder={`SELECT col1, col2, updated_at
  FROM public.source_table WHERE {where_cond_source}`}
            style={textareaStyle}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            Optional custom SELECT for source. Use {'{where_cond_source}'} for delta condition.
          </span>
        </div>
      </div>

      <div>
        <div style={{ marginBottom: '20px', marginTop: '-80px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Mode:</label>
          <select
            value={formData.mode || 'full'}
            onChange={(e) => handleChange('mode', e.target.value)}
            style={selectStyle}
          >
            <option value="full">full</option>
            <option value="delta">delta</option>
          </select>
        </div>

        {formData.mode === 'delta' && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Delta column:</label>
              <input
                type="text"
                value={formData.delta_column || ''}
                onChange={(e) => handleChange('delta_column', e.target.value)}
                placeholder={isIntDelta ? 'id' : 'timestamp'}
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Delta column type:</label>
              <select
                value={deltaColumnType}
                onChange={(e) => handleDeltaColumnTypeChange(e.target.value)}
                style={selectStyle}
              >
                <option value="timestamp">timestamp</option>
                <option value="date">date</option>
                <option value="int">integer</option>
              </select>
            </div>

            {isTimestampDelta && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>Timezone:</label>
                <select
                  value={formData.timezone || 'UTC'}
                  onChange={(e) => handleChange('timezone', e.target.value)}
                  style={selectStyle}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Delta init start:</label>
              <input
                type={isIntDelta ? 'number' : 'text'}
                value={
                  formData.delta_start ||
                  (isIntDelta ? '0' : deltaColumnType === 'date' ? '2026-01-01' : '2026-01-01 00:00:00')
                }
                onChange={(e) => handleChange('delta_start', e.target.value)}
                style={inputStyle}
              />
            </div>

            {isIntDelta ? (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>Batch size:</label>
                <input
                  type="number"
                  value={formData.delta_batch_grain || '50000'}
                  onChange={(e) => handleChange('delta_batch_grain', e.target.value)}
                  style={inputStyle}
                />
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>Batch grain:</label>
                <select
                  value={formData.delta_batch_grain || 'day'}
                  onChange={(e) => handleChange('delta_batch_grain', e.target.value)}
                  style={selectStyle}
                >
                  <option value="hour">hour</option>
                  <option value="day">day</option>
                  <option value="month">month</option>
                  <option value="year">year</option>
                </select>
              </div>
            )}

            {isTimestampDelta && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  Tail merge seconds: <span class='obligatory-notice'> - Optional</span>
                </label>
                <input
                  type="number"
                  value={formData.tail_merge_seconds || ''}
                  onChange={(e) => handleChange('tail_merge_seconds', e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  style={inputStyle}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  If the last batch is smaller than this value, it will be merged into the previous batch.
                </span>
              </div>
            )}

            {!isIntDelta && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>
                  {isDateDelta ? 'Safety days:' : 'Safety seconds:'} <span class='obligatory-notice'> - Optional</span>
                </label>
                <input
                  type="number"
                  value={getSafetyDisplayValue()}
                  onChange={(e) => handleSafetyChange(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  style={inputStyle}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}