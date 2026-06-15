import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import UserAvatar from '../../components/UserAvatar/UserAvatar';
import type { KnownUser } from '../../types';
import { applyMention, detectMention, filterMentionUsers, type MentionToken } from './mention';

export interface IssueCommentComposerHandle {
  focus: () => void;
}

interface Props {
  onSubmit: (body: string) => Promise<void> | void;
  busy: boolean;
  /** Instance the issue belongs to — needed to resolve mention avatars. */
  instanceId: number;
  /** Cached users offered as @mention candidates. */
  users: KnownUser[];
}

export const IssueCommentComposer = forwardRef<IssueCommentComposerHandle, Props>(
  function IssueCommentComposer({ onSubmit, busy, instanceId, users }, ref) {
    const [value, setValue] = useState('');
    const [mention, setMention] = useState<MentionToken | null>(null);
    const [highlight, setHighlight] = useState(0);
    const [dropUp, setDropUp] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    const matches = useMemo(
      () => (mention ? filterMentionUsers(users, mention.query) : []),
      [mention, users],
    );
    const open = mention !== null && matches.length > 0;

    // Reset the highlight whenever the active token changes.
    useEffect(() => {
      setHighlight(0);
    }, [mention?.start, mention?.query]);

    // Flip the dropdown above the textarea when there isn't room below it (e.g.
    // the composer is near the bottom of the viewport), so it never opens
    // off-screen. Measured against the viewport before paint.
    useLayoutEffect(() => {
      if (!open) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const rect = ta.getBoundingClientRect();
      const estimatedHeight = Math.min(240, matches.length * 36 + 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setDropUp(spaceBelow < estimatedHeight && spaceAbove > spaceBelow);
    }, [open, matches.length]);

    /** Recompute the active mention token from the textarea's current state. */
    const syncMention = (el: HTMLTextAreaElement) => {
      setMention(detectMention(el.value, el.selectionStart ?? el.value.length));
    };

    const accept = (user: KnownUser) => {
      if (!mention) return;
      const result = applyMention(value, mention, user.username);
      setValue(result.value);
      setMention(null);
      // Restore focus and place the cursor after the inserted mention once the
      // controlled value has been flushed to the DOM.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(result.cursor, result.cursor);
      });
    };

    const submit = async () => {
      const body = value.trim();
      if (!body || busy) return;
      await onSubmit(body);
      setValue('');
      setMention(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (open) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setHighlight((h) => (h + 1) % matches.length);
            return;
          case 'ArrowUp':
            e.preventDefault();
            setHighlight((h) => (h - 1 + matches.length) % matches.length);
            return;
          case 'Enter':
          case 'Tab':
            e.preventDefault();
            accept(matches[highlight]);
            return;
          case 'Escape':
            e.preventDefault();
            setMention(null);
            return;
        }
      }

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
        <div className="issue-composer-input">
          <textarea
            ref={textareaRef}
            className="issue-composer-textarea"
            placeholder="Write a comment… (⌘↵ to submit, @ to mention)"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              syncMention(e.target);
            }}
            onSelect={(e) => syncMention(e.currentTarget)}
            onBlur={() => setMention(null)}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={busy}
          />
          {open && (
            <ul
              className={`mention-dropdown${dropUp ? ' mention-dropdown--above' : ''}`}
              role="listbox"
            >
              {matches.map((u, i) => (
                <li
                  key={u.username}
                  role="option"
                  aria-selected={i === highlight}
                  className={`mention-option${i === highlight ? ' is-active' : ''}`}
                  // mousedown (not click) so we act before the textarea blurs.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(u);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <UserAvatar instanceId={instanceId} username={u.username} size={20} />
                  <span className="mention-name">{u.name ?? u.username}</span>
                  <span className="mention-username">@{u.username}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
