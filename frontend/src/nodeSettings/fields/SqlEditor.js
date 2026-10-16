import React, { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql, PostgreSQL, MySQL, StandardSQL } from '@codemirror/lang-sql';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

const DIALECT_BY_CONNECTION_TYPE = {
  postgres: PostgreSQL,
  clickhouse: StandardSQL,
  mysql: MySQL,
  starrocks: MySQL
};

const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--text-code)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success-text)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning-text)' },
  { tag: tags.comment, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.className, tags.labelName], color: 'var(--text-soft)' },
  { tag: tags.variableName, color: 'var(--text-code)' }
]);

// Chrome (background/border/gutter/font) matched to Belt's global theme CSS variables.
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--text-code)',
    border: '1px solid var(--border-strong)',
    fontFamily: 'monospace',
    fontSize: '13px'
  },
  '.cm-scroller': {
    backgroundColor: 'var(--editor-bg)'
  },
  '.cm-content': {
    // CodeMirror draws selection behind the text content.
    backgroundColor: 'transparent',
    fontFamily: 'monospace',
    caretColor: 'var(--text-code)'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border-strong)'
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--editor-notice) 50%, transparent)'
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)'
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--editor-notice)'
  },
  '&.cm-focused': {
    outline: 'none'
  }
});

const SqlEditor = ({ value, onChange, connectionType, height = '340px', label }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const extensions = useMemo(() => {
    const dialect = DIALECT_BY_CONNECTION_TYPE[connectionType] || StandardSQL;
    return [sql({ dialect }), editorTheme, syntaxHighlighting(sqlHighlightStyle)];
  }, [connectionType]);

  const containerStyle = isFullscreen
    ? {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1000,
      background: 'var(--app-bg)',
      padding: '15px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column'
    }
    : { display: 'flex', flexDirection: 'column' };

  // Native browser drag-resize in normal mode; flex-fill in fullscreen mode.
  const editorWrapperStyle = isFullscreen
    ? { flex: '1 1 auto', minHeight: 0 }
    : { height, minHeight: '150px', resize: 'vertical', overflow: 'hidden' };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        {label ? (
          <label style={{ display: 'block', margin: 0 }}>{label}</label>
        ) : <span />}
        <button
          type="button"
          className="belt-icon-button"
          title={isFullscreen ? 'Свернуть' : 'На весь экран'}
          onClick={() => setIsFullscreen((prev) => !prev)}
          style={{ fontSize: '16px', color: 'var(--text-muted)' }}
        >
          {isFullscreen ? '⤡' : '⤢'}
        </button>
      </div>
      <div style={editorWrapperStyle}>
        <CodeMirror
          value={value || ''}
          height="100%"
          width="100%"
          style={{ height: '100%' }}
          extensions={extensions}
          onChange={onChange}
        />
      </div>
    </div>
  );
};

export default SqlEditor;
