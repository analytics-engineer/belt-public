import React from 'react';
import useStore from '../../store'
import { t } from '../../i18n';

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
  marginBottom: '8px',
  background: 'var(--input-bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)'
};

export default function PythonSourceFields({
  formData,
  handleChange,
  pythonFiles,
  pythonUploadPath,
  setPythonUploadPath,
  setPythonUploadFile,
  handleUploadPythonFile,
  handleDownloadPythonFile,
  handleDeletePythonFile,
  TIMEZONES
}) {
  const locale = useStore((state) => state.locale || 'en');
  const deltaColumnType = formData.delta_column_type || 'timestamp';
  const isTimestampDelta = deltaColumnType === 'timestamp';
  const isDateDelta = deltaColumnType === 'date';

  const getSafetyDisplayValue = () => {
    if (isDateDelta) {
      const seconds = Number(formData.safety_seconds || 0);
      return seconds ? String(seconds / 86400) : '';
    }

    return formData.safety_seconds || '';
  };

  const handleSafetyChange = (value) => {
    if (isDateDelta) {
      if (value === '') {
        handleChange('safety_seconds', '');
        return;
      }

      handleChange('safety_seconds', String(Number(value) * 86400));
      return;
    }

    handleChange('safety_seconds', value);
  };

  const handleDeltaColumnTypeChange = (value) => {
    handleChange('delta_column_type', value);

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
          <label style={{ display: 'block', marginBottom: '8px' }}>Python script:</label>
          <select value={formData.script_path || ''} onChange={(e) => handleChange('script_path', e.target.value)}
            style={selectStyle}>
            <option value="">Select python file...</option>
            {pythonFiles.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
          </select>

          <div style={{ display: 'flex', gap: '20px' }}>
            <button type="button" onClick={handleDownloadPythonFile} className="belt-button belt-button-warning">
              {t(locale, 'common.download')}
            </button>

            <button type="button" onClick={handleDeletePythonFile} className="belt-button belt-button-danger_run">
              {t(locale, 'common.delete')}
            </button>
          </div>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Function name:</label>
          <input type="text" value={formData.function_name || ''} onChange={(e) => handleChange('function_name', e.target.value)} placeholder="run" style={inputStyle} />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Output columns:</label>
          <input type="text" value={formData.columns || ''} onChange={(e) => handleChange('columns', e.target.value)} placeholder="id,name,date" style={inputStyle} />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Params JSON:</label>
          <textarea value={formData.params || ''} onChange={(e) => handleChange('params', e.target.value)} placeholder='{"limit": 100}' rows={5} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Mode:</label>
          <select value={formData.mode || 'full'} onChange={(e) => handleChange('mode', e.target.value)} style={selectStyle}>
            <option value="full">full</option>
            <option value="delta">delta</option>
          </select>
        </div>
      </div>

      <div>
        <div style={{ marginBottom: '20px', marginTop: ' -80px' }}>
          <label style={{ display: 'block', marginBottom: '8px' }}>Name for new Python script:</label>
          <div style={{ display: 'flex' }}>
            <input
              type="text"
              value={pythonUploadPath || ''}
              onChange={(e) => setPythonUploadPath(e.target.value)}
              placeholder="api_sources/weather/test_source.py"
              style={{ ...inputStyle, marginBottom: '8px', marginRight: '18px', }}
            />

            <input
              type="file"
              accept=".py"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setPythonUploadFile(file);
                if (file && !pythonUploadPath) {
                  setPythonUploadPath(file.name);
                }
              }}
              style={{ width: '100%', marginBottom: '8px', color: 'var(--text)' }}
            />


          </div>
          <button type="button" onClick={handleUploadPythonFile} className="belt-button belt-button-success">
            {t(locale, 'common.upload')}
          </button>
        </div>

        {formData.mode === 'delta' && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Delta column:</label>
              <input type="text" value={formData.delta_column || ''} onChange={(e) => handleChange('delta_column', e.target.value)} placeholder="timestamp" style={inputStyle} />
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
              </select>
            </div>

            {isTimestampDelta && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>Timezone:</label>
                <select value={formData.timezone || 'UTC'} onChange={(e) => handleChange('timezone', e.target.value)} style={selectStyle}>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Delta init start:</label>
              <input type="text" value={formData.delta_start || ''} onChange={(e) => handleChange('delta_start', e.target.value)} placeholder="2026-01-01 00:00:00" style={inputStyle} />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>Batch grain:</label>
              <select value={formData.delta_batch_grain || 'day'} onChange={(e) => handleChange('delta_batch_grain', e.target.value)} style={selectStyle}>
                <option value="hour">hour</option>
                <option value="day">day</option>
                <option value="month">month</option>
                <option value="year">year</option>
              </select>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px' }}>
                {isDateDelta ? 'Safety days:' : 'Safety seconds:'}
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
          </>
        )}
      </div>
    </div >
  );
}