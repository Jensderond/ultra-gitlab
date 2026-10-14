/**
 * Inline notes: discussion threads, your pending drafts, the comment composer
 * and the CI failure callout. Rendered inside the diff (as Pierre line
 * annotations) and in the aside.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { isMac } from '../../api/client';
import type { Comment } from '../../api/types';
import { Avatar, Button, Tag, cx } from '../../ui/components';
import { Markdown } from '../../ui/Markdown';
import { age } from '../../lib/format';
import { blockLines, caretFor, linesLabel, onSeed, unsent } from './compose';
import { composerKey, useReview, type ComposerTarget } from './context';
import type { SuggestionSource } from './diff';
import type { Draft } from './state';
import { suggestionBlock } from './suggest';
import { snippet, type Thread } from './threads';

const when = (ts: number) => {
  const a = age(ts);
  return a === 'now' ? 'just now' : /\d$/.test(a) ? a : `${a} ago`;
};

/* ------------------------------------------------------------------------ */
/* Composer                                                                 */
/* ------------------------------------------------------------------------ */

export function Composer({
  target,
  label,
  initial = '',
  submitLabel = 'Add to review',
  suggestion,
  onSubmit,
  onCancel,
  extra,
}: {
  target: ComposerTarget;
  label: ReactNode;
  initial?: string;
  submitLabel?: string;
  /** The lines a suggestion replaces; enables "Suggest change" (null: shown disabled). */
  suggestion?: SuggestionSource | null;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  extra?: (body: string, clear: () => void) => ReactNode;
}) {
  // Per MR: the same path and line in another merge request is another comment.
  const { mrId } = useReview();
  const key = `${mrId}:${composerKey(target)}`;
  const [text, setText] = useState(() => unsent.get(key) ?? initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(320, Math.max(56, el.scrollHeight + 2))}px`;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    grow();
    el.focus({ preventScroll: true });
    const caret = caretFor(key, el.value);
    if (caret) el.setSelectionRange(caret[0], caret[1]);
    else el.setSelectionRange(el.value.length, el.value.length);
    el.scrollIntoView({ block: 'nearest' });
  }, [key]);

  // A suggestion seeded while this composer is already open.
  useEffect(
    () =>
      onSeed((seeded) => {
        if (seeded !== key) return;
        const next = unsent.get(key) ?? '';
        setText(next);
        requestAnimationFrame(() => {
          const el = ref.current;
          const caret = caretFor(key, next);
          if (!el) return;
          grow();
          el.focus();
          if (caret) el.setSelectionRange(caret[0], caret[1]);
        });
      }),
    [key],
  );

  const change = (value: string) => {
    setText(value);
    unsent.set(key, value);
    requestAnimationFrame(grow);
  };
  const clear = () => {
    unsent.delete(key);
    setText('');
  };
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    unsent.delete(key);
    onSubmit(body);
  };

  const insertSuggestion = () => {
    if (!suggestion) return;
    const el = ref.current;
    const block = suggestionBlock(suggestion.text, suggestion.above);
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const pad = before && !before.endsWith('\n') ? '\n' : '';
    const next = `${before}${pad}${block}\n${text.slice(end)}`;
    change(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      // Select the suggested lines so they can be edited right away.
      const [from, to] = blockLines(block, before.length + pad.length);
      el.setSelectionRange(from, to);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const id = `rv-composer-${key.replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <div className="rv-composer">
      <label htmlFor={id} className="rv-composer__label">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        className="rv-composer__input"
        rows={2}
        value={text}
        placeholder="Write a comment… Markdown works."
        spellCheck
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="rv-composer__actions">
        <Button size="sm" variant="plain" onClick={onCancel} title="Close (esc). Your text is kept.">
          Cancel
        </Button>
        <span className="rv-composer__gap" />
        {suggestion !== undefined && (
          <Button
            size="sm"
            onClick={insertSuggestion}
            disabled={suggestion === null}
            title={
              suggestion === null
                ? 'Suggestions work on lines of the new version'
                : suggestion.above > 0
                  ? `Insert a suggestion block with these ${suggestion.above + 1} lines`
                  : 'Insert a suggestion block with this line'
            }
          >
            Suggest change
          </Button>
        )}
        {extra?.(text.trim(), clear)}
        <Button size="sm" variant="primary" shortcut="mod+enter" onClick={submit} disabled={!text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Notes                                                                    */
/* ------------------------------------------------------------------------ */

function NoteView({ comment, reply }: { comment: Comment; reply?: boolean }) {
  const { avatars, me, baseUrl } = useReview();
  const status =
    comment.isLocal && comment.syncStatus === 'failed'
      ? <Tag tone="fail">Not sent</Tag>
      : comment.isLocal && comment.syncStatus !== 'synced'
        ? <Tag tone="neutral">Sending…</Tag>
        : null;
  return (
    <div className={cx('rv-note', reply && 'rv-note--reply')}>
      <Avatar username={comment.authorUsername} src={avatars?.[comment.authorUsername]} size={reply ? 20 : 24} />
      <div className="rv-note__main">
        <div className="rv-note__meta">
          <strong>{comment.authorUsername === me ? 'You' : comment.authorUsername}</strong>
          <span className="rv-note__age" title={new Date(comment.createdAt * 1000).toLocaleString()}>
            · {when(comment.createdAt)}
          </span>
          {status}
        </div>
        <Markdown source={comment.body} baseUrl={baseUrl} className="rv-note__body selectable" />
      </div>
    </div>
  );
}

function DraftNote({ draft, reply }: { draft: Draft; reply?: boolean }) {
  const { avatars, me, baseUrl, composer, openComposer, updateDraft, removeDraft } = useReview();
  const editing = composer?.kind === 'edit' && composer.draftId === draft.id;
  if (editing) {
    return (
      <Composer
        target={{ kind: 'edit', draftId: draft.id }}
        label="Edit your pending comment"
        initial={draft.body}
        submitLabel="Save"
        onSubmit={(body) => {
          updateDraft(draft.id, body);
          openComposer(null);
        }}
        onCancel={() => openComposer(null)}
      />
    );
  }
  return (
    <div className={cx('rv-note rv-note--draft', reply && 'rv-note--reply')}>
      <Avatar username={me ?? 'you'} src={me ? avatars?.[me] : undefined} size={reply ? 20 : 24} />
      <div className="rv-note__main">
        <div className="rv-note__meta">
          <strong>You</strong>
          <Tag tone="warn">Pending</Tag>
          {draft.from && draft.side && draft.line && (
            <span className="rv-note__range">
              {linesLabel({ side: draft.side, line: draft.line }, draft.from)}
            </span>
          )}
          <span className="rv-spacer" />
          <button type="button" className="rv-link" onClick={() => openComposer({ kind: 'edit', draftId: draft.id })}>
            Edit
          </button>
          <button type="button" className="rv-link rv-link--danger" onClick={() => removeDraft(draft.id)}>
            Delete
          </button>
        </div>
        <Markdown source={draft.body} baseUrl={baseUrl} className="rv-note__body selectable" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Thread card                                                              */
/* ------------------------------------------------------------------------ */

export function ThreadCard({ thread, compact }: { thread: Thread; compact?: boolean }) {
  const { drafts, composer, openComposer, addDraft, resolve, suggestion: suggestionFor } = useReview();
  const [expanded, setExpanded] = useState(!thread.resolved);
  const [busy, setBusy] = useState(false);
  const pending = drafts.filter((d) => d.discussionId && d.discussionId === thread.discussionId);
  const replying = composer?.kind === 'reply' && composer.threadId === thread.id;
  const canReply = !!thread.discussionId;
  const canResolve = canReply && thread.resolvable;

  const toggleResolved = async () => {
    setBusy(true);
    try {
      await resolve(thread, !thread.resolved);
      if (!thread.resolved) setExpanded(false);
    } finally {
      setBusy(false);
    }
  };

  if (!expanded && !replying) {
    return (
      <button
        type="button"
        id={`rv-thread-${thread.id}`}
        className={cx('rv-thread rv-thread--collapsed', compact && 'rv-thread--compact')}
        onClick={() => setExpanded(true)}
        title="Show the resolved thread"
      >
        <Tag tone="ok">Resolved</Tag>
        <strong>{thread.root.authorUsername}</strong>
        <span className="rv-thread__summary">{snippet(thread.root.body, 120)}</span>
        {thread.replies.length > 0 && (
          <span className="rv-thread__count">
            {thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}
          </span>
        )}
      </button>
    );
  }

  const suggestion =
    thread.filePath && thread.line && thread.side === 'new'
      ? suggestionFor(thread.filePath, undefined, { side: 'new', line: thread.line })
      : null;

  return (
    <div id={`rv-thread-${thread.id}`} className={cx('rv-thread', compact && 'rv-thread--compact', thread.resolved && 'is-resolved')}>
      <div className="rv-thread__notes">
        <NoteView comment={thread.root} />
        {thread.replies.map((c) => (
          <NoteView key={c.id} comment={c} reply />
        ))}
        {pending.map((d) => (
          <DraftNote key={d.id} draft={d} reply />
        ))}
      </div>
      {replying ? (
        <div className="rv-thread__footer">
          <Composer
            target={{ kind: 'reply', threadId: thread.id }}
            label="Your reply · saved as draft until you finish the review"
            suggestion={thread.filePath ? suggestion : undefined}
            onSubmit={(body) => {
              addDraft({
                body,
                discussionId: thread.discussionId!,
                parentId: thread.root.id,
                filePath: thread.filePath ?? undefined,
                side: thread.side,
                line: thread.line ?? undefined,
              });
              openComposer(null);
            }}
            onCancel={() => openComposer(null)}
            extra={(body, clear) =>
              canResolve && (
              <Button
                size="sm"
                busy={busy}
                title={
                  thread.resolved
                    ? 'Reopen this thread now'
                    : body
                      ? 'Resolve the thread now and add your reply to the review'
                      : 'Resolve the thread now'
                }
                onClick={async () => {
                  if (body && !thread.resolved) {
                    addDraft({
                      body,
                      discussionId: thread.discussionId!,
                      parentId: thread.root.id,
                      filePath: thread.filePath ?? undefined,
                      side: thread.side,
                      line: thread.line ?? undefined,
                    });
                    clear();
                  }
                  openComposer(null);
                  await toggleResolved();
                }}
              >
                {thread.resolved ? 'Unresolve' : 'Resolve'}
              </Button>
              )
            }
          />
        </div>
      ) : (
        canReply && (
          <div className="rv-thread__actions">
            <Button size="sm" variant="plain" onClick={() => openComposer({ kind: 'reply', threadId: thread.id })}>
              Reply
            </Button>
            {canResolve && (
              <Button size="sm" variant="plain" busy={busy} onClick={() => void toggleResolved()}>
                {thread.resolved ? 'Unresolve' : 'Resolve'}
              </Button>
            )}
            {thread.resolved && (
              <Button size="sm" variant="plain" onClick={() => setExpanded(false)}>
                Collapse
              </Button>
            )}
          </div>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* New comment: composer card and pending draft card                        */
/* ------------------------------------------------------------------------ */

export function NewCommentCard({ target }: { target: Extract<ComposerTarget, { kind: 'new' }> }) {
  const { openComposer, addDraft, suggestion } = useReview();
  const to = { side: target.side, line: target.line };
  return (
    <div className="rv-thread rv-thread--new" id="rv-new-comment">
      <Composer
        target={target}
        label={`Comment on ${linesLabel(to, target.from)} · saved as draft until you finish the review`}
        suggestion={suggestion(target.filePath, target.from, to)}
        onSubmit={(body) => {
          addDraft({
            body,
            filePath: target.filePath,
            side: target.side,
            line: target.line,
            lineKind: target.lineKind,
            ...(target.from ? { from: target.from } : {}),
          });
          openComposer(null);
        }}
        onCancel={() => openComposer(null)}
      />
    </div>
  );
}

export function DraftCard({ draft }: { draft: Draft }) {
  return (
    <div className="rv-thread rv-thread--draft" id={`rv-draft-${draft.id}`}>
      <div className="rv-thread__notes">
        <DraftNote draft={draft} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* CI failure callout                                                       */
/* ------------------------------------------------------------------------ */

export function CiCallout({
  jobName,
  excerpt,
  line,
  outside,
  onShow,
}: {
  jobName: string;
  excerpt: string | null;
  line?: number;
  /** The failing line isn't part of the diff; say where it is. */
  outside?: boolean;
  onShow: () => void;
}) {
  return (
    <div className="rv-ci" role="note">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="rv-ci__icon">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </svg>
      <div className="rv-ci__main">
        <span className="rv-ci__title">
          {jobName} failed {outside && line ? `at line ${line} of this file` : 'near this change'}
        </span>
        {excerpt && <span className="rv-ci__excerpt selectable">{excerpt}</span>}
        <button type="button" className="rv-link rv-ci__link" onClick={onShow}>
          Show in log →
        </button>
      </div>
    </div>
  );
}
