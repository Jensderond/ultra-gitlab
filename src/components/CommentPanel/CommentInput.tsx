/**
 * Comment input component for adding new comments or replies.
 */

import { useState, useRef, useEffect } from 'react';
import './CommentInput.css';

interface CommentInputProps {
  /** Placeholder text */
  placeholder?: string;
  /** Submit button label */
  submitLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Auto-focus the input */
  autoFocus?: boolean;
  /** Called when submitting a comment */
  onSubmit: (body: string) => void;
  /** Called when canceling */
  onCancel?: () => void;
  /** Whether the submit is in progress */
  isSubmitting?: boolean;
}

/**
 * Text input for composing comments.
 */
export default function CommentInput({
  placeholder = 'Add a comment...',
  submitLabel = 'Comment',
  cancelLabel = 'Cancel',
  autoFocus = false,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: CommentInputProps) {
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = () => {
    const trimmed = body.trim();
    if (trimmed && !isSubmitting) {
      onSubmit(trimmed);
      setBody('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to submit
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    // Escape to cancel
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const isEmpty = body.trim().length === 0;

  return (
    <div className="comment-input">
      <textarea
        ref={textareaRef}
        className="comment-textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isSubmitting}
        rows={3}
      />
      <div className="comment-input-actions">
        <span className="comment-input-hint">
          <kbd>Cmd</kbd>+<kbd>Enter</kbd> to submit
        </span>
        <div className="comment-input-buttons">
          {onCancel && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={isEmpty || isSubmitting}
          >
            {isSubmitting ? 'Sending...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
