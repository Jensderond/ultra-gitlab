import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

export interface IssueCommentComposerHandle {
  focus: () => void;
}

interface Props {
  onSubmit: (body: string) => Promise<void> | void;
  busy: boolean;
}

export const IssueCommentComposer = forwardRef<IssueCommentComposerHandle, Props>(
  function IssueCommentComposer({ onSubmit, busy }, ref) {
    const [value, setValue] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    const submit = async () => {
      const body = value.trim();
      if (!body || busy) return;
      await onSubmit(body);
      setValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    };

    return (
      <form
        className="issue-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={textareaRef}
          className="issue-composer-textarea"
          placeholder="Write a comment… (⌘↵ to submit)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={busy}
        />
        <div className="issue-composer-actions">
          <button
            type="submit"
            className="primary-button"
            disabled={busy || value.trim().length === 0}
          >
            {busy ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </form>
    );
  },
);
