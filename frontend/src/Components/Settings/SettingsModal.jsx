import useStore from '../../store';
import { t } from '../../i18n';

export default function SettingsModal({ API_URL, email, onClose }) {
  const {
    theme,
    locale,
    setTheme,
    setLocale
  } = useStore();

  const saveSettings = async () => {
    await fetch(`${API_URL}/api/user-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme_code: theme,
        locale_code: locale
      })
    });

    document.body.dataset.theme = theme;
    document.documentElement.lang = locale;
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(0,0,0,0.4)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: 'var(--workspace-bg)',
        color: 'var(--text)',
        padding: '30px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        width: '340px',
        boxSizing: 'border-box'
      }}>
        <h3 style={{ marginTop: 0 }}>
          {t(locale, 'settings.title')}
        </h3>

        <div style={{ marginBottom: '15px' }}>
          <label>{t(locale, 'settings.language')}</label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            style={{
              width: '100%',
              marginTop: '5px',
              padding: '6px',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              boxSizing: 'border-box'
            }}
          >
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label>{t(locale, 'settings.theme')}</label>
          <select
            value={theme}
            onChange={(e) => {
              const newTheme = e.target.value;
              setTheme(newTheme);
              document.body.dataset.theme = newTheme;
            }}
            style={{
              width: '100%',
              marginTop: '5px',
              padding: '6px',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              boxSizing: 'border-box'
            }}
          >
            <option value="dark">Dark metal</option>
            <option value="light">Light side</option>
            <option value="green">Green energy</option>
            <option value="blue">Blue ocean</option>
            <option value="red">Lady in Red</option>
            <option value="pink">Pink pony</option>
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>

          {(
            <div style={{
              width: '100%',
              marginTop: '5px',
              padding: '6px',
              background: 'var(--input-bg)',
              color: 'var(--text)'
            }}>
              E-mail: {email}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose}>
            {t(locale, 'common.cancel')}
          </button>

          <button onClick={saveSettings} className="belt-button belt-button-warning">
            {t(locale, 'common.apply')}
          </button>
        </div>

        <div style={{ marginTop: '25px' }}>
          <div style={{ marginTop: '15px', color: 'var(--text-muted)', fontSize: '10px' }}>
            Developed by Igor Gorin
          </div>

          <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '10px' }}>
            <a href="https://github.com/analytics-engineer" target="_blank" rel="noreferrer">
              https://github.com/analytics-engineer
            </a>
          </div>
        </div>
      </div>
    </div >
  );
}