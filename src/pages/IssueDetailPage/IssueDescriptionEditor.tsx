/**
 * Inline markdown editor for the issue description.
 *
 * CodeMirror 6 with @codemirror/lang-markdown. An earlier iteration used the
 * @pierre/diffs editor, but its custom selection overlays rendered unreliably
 * in WKWebView; CodeMirror uses native selection, which does not.
 */

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
// openSearchPanel is used in a later task (kept to avoid re-adding the import)
void (openSearchPanel as unknown);
import { tags } from '@lezer/highlight';

export interface IssueDescriptionEditorProps {
  /** Markdown contents to start editing from. */
  initialValue: string;
  busy: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}

const editorTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    maxHeight: '480px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "var(--diffs-font-family, 'IBM Plex Mono', monospace)",
    lineHeight: '1.55',
  },
  '.cm-content': {
    padding: '10px 0',
    minHeight: '140px',
    caretColor: 'var(--text-primary)',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-placeholder': {
    color: 'var(--text-tertiary)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 22%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 38%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-color)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border-color)',
  },
  '.cm-panel.cm-search': {
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: '12px',
  },
  '.cm-panel.cm-search label': {
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: 'inherit',
  },
  '.cm-panel.cm-search button': {
    cursor: 'pointer',
    color: 'var(--text-secondary)',
  },
  '.cm-panel.cm-search button:hover': {
    color: 'var(--text-primary)',
    borderColor: 'var(--accent-color)',
  },
  '.cm-panel.cm-search button[name="close"]': {
    border: 'none',
    backgroundColor: 'transparent',
    fontSize: '16px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 28%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 55%, transparent)',
  },
});

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--accent-color)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent-color)' },
  { tag: tags.url, color: 'var(--accent-color)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--text-secondary)' },
  { tag: tags.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: 'var(--text-tertiary)' },
  { tag: tags.contentSeparator, color: 'var(--text-tertiary)' },
]);

/**
 * Wrap each selection range in `before`/`after` markers. With an empty
 * selection the markers are inserted and the caret is placed between them.
 */
function wrapSelection(view: EditorView, before: string, after: string) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const insert = before + text + after;
      const anchor = range.from + before.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(anchor, anchor + text.length),
      };
    })
  );
  view.focus();
}

/**
 * Replace the selection with a markdown link, placing the caret on the URL
 * placeholder so it can be typed over immediately.
 */
function insertLink(view: EditorView) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const label = text || 'text';
      const insert = `[${label}](url)`;
      // [ + label + ]( = 3 + label.length chars before the url placeholder.
      const urlStart = range.from + 3 + label.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(urlStart, urlStart + 'url'.length),
      };
    })
  );
  view.focus();
}

/**
 * Toggle a `- ` bullet prefix on every line touched by the main selection.
 * If every touched line already has a bullet, the bullets are removed.
 */
function toggleBulletList(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const lines = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    lines.push(state.doc.line(n));
  }
  const bulletRe = /^(\s*)- /;
  const allBulleted = lines.every((line) => bulletRe.test(line.text));
  const changes = lines.map((line) => {
    if (allBulleted) {
      const match = line.text.match(bulletRe);
      const indent = match ? match[1].length : 0;
      const markerEnd = match ? match[0].length : 0;
      return { from: line.from + indent, to: line.from + markerEnd, insert: '' };
    }
    return { from: line.from, to: line.from, insert: '- ' };
  });
  view.dispatch({ changes });
  view.focus();
}

// toggleBulletList is used by the toolbar in a later task (kept to avoid re-adding)
void (toggleBulletList as unknown);

export function IssueDescriptionEditor({
  initialValue,
  busy,
  onSave,
  onCancel,
}: IssueDescriptionEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editableRef = useRef(new Compartment());

  // The CodeMirror keymap closes over mount-time values; route callbacks
  // through a ref so it always sees the latest props.
  const latestRef = useRef({ busy, onSave, onCancel });
  latestRef.current = { busy, onSave, onCancel };

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        selection: { anchor: initialValue.length },
        extensions: [
          // Mod-Enter must win over defaultKeymap's insertBlankLine.
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: (v) => {
                  const { busy: isBusy, onSave: save } = latestRef.current;
                  if (!isBusy) save(v.state.doc.toString());
                  return true;
                },
              },
              {
                key: 'Mod-b',
                run: (v) => {
                  if (!latestRef.current.busy) wrapSelection(v, '**', '**');
                  return true;
                },
              },
              {
                key: 'Mod-i',
                run: (v) => {
                  if (!latestRef.current.busy) wrapSelection(v, '_', '_');
                  return true;
                },
              },
              {
                key: 'Mod-k',
                run: (v) => {
                  if (!latestRef.current.busy) insertLink(v);
                  return true;
                },
              },
            ])
          ),
          history(),
          drawSelection(),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          placeholder('Describe the issue… (markdown supported)'),
          EditorView.contentAttributes.of({ 'aria-label': 'Issue description' }),
          editorTheme,
          editableRef.current.of([
            EditorView.editable.of(true),
            EditorState.readOnly.of(false),
          ]),
        ],
      }),
      parent,
    });
    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; initialValue only seeds the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableRef.current.reconfigure([
        EditorView.editable.of(!busy),
        EditorState.readOnly.of(busy),
      ]),
    });
  }, [busy]);

  const handleSave = () => {
    const view = viewRef.current;
    if (!busy && view) onSave(view.state.doc.toString());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Always stop the key here so it never reaches the page-level handler
      // (which would close the dialog).
      e.stopPropagation();
      // CodeMirror's search keymap calls preventDefault when it closes an open
      // search panel. In that case, swallow the key and keep editing.
      if (e.defaultPrevented) return;
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.stopPropagation();
    }
  };

  return (
    <div className="issue-description-editor">
      <div
        ref={containerRef}
        className="issue-description-editor-cm"
        onKeyDown={handleKeyDown}
      />
      <div className="issue-description-editor-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleSave}
          disabled={busy}
          title="Save (⌘Enter)"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
