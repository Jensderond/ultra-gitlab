/**
 * General comment input for the activity drawer.
 *
 * Fixed at the bottom of the drawer. Supports Cmd+Enter to submit.
 */

import { useState, useRef, useCallback } from 'react';
import './CommentInput.css';

interface CommentInputProps {
  onSubmit: (body: string) => Promise<void>;
}

export default function CommentInput({ onSubmit }: CommentInputProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const body = value.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(body);
      setValue('');
    } finally {
      setSubmitting(false);
      textareaRef.current?.focus();
    }
  }, [value, submitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="comment-input" data-testid="activity-comment-input">
      <textarea
        ref={textareaRef}
        className="comment-input__textarea"
        placeholder="Add a comment..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        disabled={submitting}
        data-testid="activity-comment-textarea"
      />
      <button
        className="comment-input__send"
        onClick={handleSubmit}
        disabled={!value.trim() || submitting}
        title="Send (⌘Enter)"
        data-testid="activity-comment-send"
      >
        Send
      </button>
    </div>
  );
}
