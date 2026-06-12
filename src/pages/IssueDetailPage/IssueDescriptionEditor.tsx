/**
 * Inline markdown editor for the issue description.
 *
 * A plain textarea, styled like the comment composer. An earlier iteration
 * used the @pierre/diffs editor, but its selection rendering was unreliable
 * in WKWebView, so the description editor deliberately stays simple.
 */

import { useEffect, useRef, useState } from 'react';

export interface IssueDescriptionEditorProps {
  /** Markdown contents to start editing from. */
  initialValue: string;
  busy: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}

export function IssueDescriptionEditor({
  initialValue,
  busy,
  onSave,
  onCancel,
}: IssueDescriptionEditorProps) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const handleSave = () => {
    if (!busy) onSave(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  // Size to the content on open: at least 6 rows, at most 24.
  const rows = Math.min(Math.max(initialValue.split('\n').length + 1, 6), 24);

  return (
    <div className="issue-description-editor">
      <textarea
        ref={textareaRef}
        className="issue-description-editor-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={rows}
        disabled={busy}
        placeholder="Describe the issue… (markdown supported)"
        aria-label="Issue description"
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
