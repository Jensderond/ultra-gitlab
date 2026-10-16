/**
 * Inline editor for the body of one of your own comments.
 *
 * Esc cancels, Cmd/Ctrl+Enter saves. If saving throws, the editor stays open
 * with the draft so the user can retry.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import './ActivityDrawer/ActivityFeed.css';

interface CommentEditFormProps {
  initialBody: string;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
}

export default function CommentEditForm({ initialBody, onSave, onCancel }: CommentEditFormProps) {
  const [value, setValue] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const body = value.trim();
  const canSave = !!body && body !== initialBody.trim() && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(body);
      onCancel();
    } catch {
      setSaving(false);
    }
  }, [canSave, body, onSave, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Keep keys out of page-level shortcut handlers (diff navigation, etc.)
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSave, onCancel],
  );

  return (
    <div
      className="activity-reply-input activity-edit-input"
      data-testid="comment-edit-form"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        className="activity-reply-input__textarea"
        aria-label="Edit comment"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={Math.min(10, Math.max(2, value.split('\n').length))}
        disabled={saving}
        data-testid="comment-edit-textarea"
      />
      <div className="activity-reply-input__actions">
        <button className="activity-reply-input__cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          className="activity-reply-input__send"
          onClick={handleSave}
          disabled={!canSave}
          title="Save (⌘Enter)"
          data-testid="comment-edit-save"
        >
          Save
        </button>
      </div>
    </div>
  );
}
