/**
 * Inline markdown editor for the issue description.
 *
 * CodeMirror 6 with @codemirror/lang-markdown. An earlier iteration used the
 * @pierre/diffs editor, but its custom selection overlays rendered unreliably
 * in WKWebView; CodeMirror uses native selection, which does not.
 */

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, placeholder, drawSelection, type Panel } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  setSearchQuery,
  SearchQuery,
} from '@codemirror/search';
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
  // drawSelection() hides the native caret and draws its own; the theme isn't
  // flagged dark, so CodeMirror defaults it to black (invisible on a dark
  // background). Colour it explicitly.
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--text-primary)',
    borderLeftWidth: '2px',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-placeholder': {
    color: 'var(--text-tertiary)',
  },
  // Match the app's global ::selection colour so the editor selection looks
  // the same as everywhere else: dimmer when unfocused, full strength when
  // focused. These vars are theme-aware (defined for every theme).
  '.cm-selectionBackground': {
    backgroundColor: 'var(--wave-glow)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--wave-glow-strong)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border-color)',
  },
  '.cm-search-bar': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 8px',
    fontFamily: 'inherit',
  },
  '.cm-search-bar-field': {
    flex: '1',
    minWidth: '0',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '13px',
    fontFamily: 'inherit',
  },
  '.cm-search-bar-field:focus': {
    outline: 'none',
    borderColor: 'var(--accent-color)',
  },
  '.cm-search-bar-button': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    flex: 'none',
    padding: '0',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.cm-search-bar-button:hover': {
    borderColor: 'var(--accent-color)',
    color: 'var(--accent-color)',
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
 * Toggle `before`/`after` markers around each selection range. If the markers
 * are already present — either inside the selection (`**bold**` selected) or
 * immediately flanking it (`bold` selected within `**bold**`) — they are
 * removed. Otherwise they are added. With an empty selection the markers are
 * inserted and the caret is placed between them.
 */
function wrapSelection(view: EditorView, before: string, after: string) {
  const { doc } = view.state;
  view.dispatch(
    view.state.changeByRange((range) => {
      const selected = view.state.sliceDoc(range.from, range.to);

      // Markers are part of the selection itself — unwrap them.
      if (
        selected.length >= before.length + after.length &&
        selected.startsWith(before) &&
        selected.endsWith(after)
      ) {
        const inner = selected.slice(before.length, selected.length - after.length);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }

      // Markers flank the selection — strip them from around it.
      const flankFrom = range.from - before.length;
      const flankTo = range.to + after.length;
      if (
        flankFrom >= 0 &&
        flankTo <= doc.length &&
        view.state.sliceDoc(flankFrom, range.from) === before &&
        view.state.sliceDoc(range.to, flankTo) === after
      ) {
        return {
          changes: [
            { from: flankFrom, to: range.from, insert: '' },
            { from: range.to, to: flankTo, insert: '' },
          ],
          range: EditorSelection.range(flankFrom, range.to - before.length),
        };
      }

      // Not wrapped yet — add the markers.
      const insert = before + selected + after;
      const anchor = range.from + before.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(anchor, anchor + selected.length),
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
  // A non-empty selection ending exactly at a line's start hasn't really
  // touched that line, so don't toggle it.
  const endLine =
    range.to > range.from && range.to === state.doc.lineAt(range.to).from
      ? state.doc.lineAt(range.to - 1)
      : state.doc.lineAt(range.to);
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

/**
 * A compact find bar shown at the top of the editor. Replaces CodeMirror's
 * default panel, which is cramped and always exposes the replace row. This one
 * is find-only and themed with the app's tokens so it reads correctly in dark
 * mode.
 */
function createSearchPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-search-bar';

  const input = document.createElement('input');
  input.className = 'cm-search-bar-field';
  input.placeholder = 'Find in description';
  input.setAttribute('aria-label', 'Find');
  const selected = view.state.sliceDoc(
    view.state.selection.main.from,
    view.state.selection.main.to
  );
  input.value =
    getSearchQuery(view.state).search || (selected.includes('\n') ? '' : selected);

  const runQuery = () => {
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: input.value })),
    });
  };
  input.addEventListener('input', runQuery);

  const makeButton = (glyph: string, title: string, onClick: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-search-bar-button';
    button.textContent = glyph;
    button.title = title;
    button.setAttribute('aria-label', title);
    // Keep focus in the field so typing keeps driving the query.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return button;
  };

  const prev = makeButton('↑', 'Previous match (⇧↵)', () => findPrevious(view));
  const next = makeButton('↓', 'Next match (↵)', () => findNext(view));
  const close = makeButton('✕', 'Close (Esc)', () => {
    closeSearchPanel(view);
    view.focus();
  });

  dom.append(input, prev, next, close);

  // Keep search-field keys from reaching the editor or the page-level Escape
  // handler that would otherwise close the dialog.
  dom.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    } else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
    }
  });

  return {
    dom,
    top: true,
    mount() {
      if (input.value) runQuery();
      input.focus();
      input.select();
    },
  };
}

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
          search({ top: true, createPanel: createSearchPanel }),
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

  const runCommand = (fn: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (!busy && view) fn(view);
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
      <div className="issue-description-editor-shell">
        <div className="issue-description-editor-toolbar" role="toolbar" aria-label="Formatting">
          <button
            type="button"
            className="editor-tool-button"
            title="Bold (⌘B)"
            aria-label="Bold"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => wrapSelection(v, '**', '**'))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Italic (⌘I)"
            aria-label="Italic"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => wrapSelection(v, '_', '_'))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 5h7M7 19h7M14 5l-4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Inline code"
            aria-label="Inline code"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => wrapSelection(v, '`', '`'))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Link (⌘K)"
            aria-label="Link"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand(insertLink)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Bulleted list"
            aria-label="Bulleted list"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand(toggleBulletList)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="4.5" cy="6" r="1.5" fill="currentColor" />
              <circle cx="4.5" cy="12" r="1.5" fill="currentColor" />
              <circle cx="4.5" cy="18" r="1.5" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button editor-tool-button--end"
            title="Find (⌘F)"
            aria-label="Find"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => openSearchPanel(v))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          ref={containerRef}
          className="issue-description-editor-cm"
          onKeyDown={handleKeyDown}
        />
      </div>
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
