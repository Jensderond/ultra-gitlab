/**
 * Inline markdown editor for the issue description.
 *
 * CodeMirror 6 with @codemirror/lang-markdown. An earlier iteration used the
 * @pierre/diffs editor, but its custom selection overlays rendered unreliably
 * in WKWebView; CodeMirror uses native selection, which does not.
 */

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
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
            ])
          ),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
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
      // Must not bubble to the view-level handler, which would close the page.
      e.preventDefault();
      e.stopPropagation();
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
