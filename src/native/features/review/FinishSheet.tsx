/** "Finish review": publish drafts, optionally approve, record what you reviewed. */

import { useEffect, useState } from 'react';
import { useKeys } from '../../app/keys';
import { Button, Sheet, cx } from '../../ui/components';
import { splitPath } from '../../lib/format';
import type { Draft } from './state';
import { snippet } from './threads';

export type Verdict = 'comment' | 'approve';

interface Props {
  open: boolean;
  onClose: () => void;
  drafts: Draft[];
  onRemoveDraft: (id: string) => void;
  canApprove: boolean;
  approveHint: string | null;
  onSubmit: (input: { verdict: Verdict; body: string }) => Promise<void>;
}

function where(d: Draft) {
  if (!d.filePath) return d.discussionId ? 'Reply · General' : 'General';
  const name = splitPath(d.filePath).name;
  const from = d.from && d.from.side === d.side && d.from.line !== d.line ? `${d.from.line}–` : '';
  const line = d.line ? `:${from}${d.line}` : '';
  return `${d.discussionId ? 'Reply · ' : ''}${name}${line}`;
}

export function FinishSheet({ open, onClose, drafts, onRemoveDraft, canApprove, approveHint, onSubmit }: Props) {
  const [verdict, setVerdict] = useState<Verdict>('comment');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  // Default to Approve when there's nothing to say, so ⌘⇧↩ then ⌘↩ approves.
  // Chosen once per opening; discarding drafts in the sheet doesn't flip it.
  useEffect(() => {
    if (!open) return;
    setBusy(false);
    setVerdict(drafts.length > 0 ? 'comment' : 'approve');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const n = drafts.length;
  const approving = verdict === 'approve' && canApprove;
  const hasContent = n > 0 || body.trim().length > 0;
  const label = approving
    ? n > 0
      ? `Approve & post ${n}`
      : 'Approve'
    : hasContent
      ? n > 0
        ? `Post ${n} comment${n === 1 ? '' : 's'}`
        : 'Post comment'
      : 'Done reviewing';

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit({ verdict: approving ? 'approve' : 'comment', body: body.trim() });
      setBody('');
    } catch (e) {
      // The screen reported it; keep what was typed unless it was already posted.
      if ((e as { bodyPosted?: boolean } | null)?.bodyPosted) setBody('');
    } finally {
      setBusy(false);
    }
  };

  useKeys({ 'mod+enter': () => void submit() }, { enabled: open });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Finish review"
      width={560}
      footer={
        <>
          <span className="rv-sheet__note">
            {hasContent || approving
              ? 'Comments are posted to GitLab in the background.'
              : 'Nothing will be posted; this marks the current commits as reviewed.'}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" shortcut="mod+enter" busy={busy} onClick={() => void submit()}>
            {label}
          </Button>
        </>
      }
    >
      <div className="rv-sheet">
        <label className="rv-sheet__label" htmlFor="rv-finish-body">
          Overall comment <span className="rv-sheet__optional">optional</span>
        </label>
        <textarea
          id="rv-finish-body"
          className="rv-composer__input rv-sheet__body"
          rows={4}
          value={body}
          placeholder="Summarise your review… Markdown works."
          onChange={(e) => setBody(e.target.value)}
        />

        <div className="rv-verdicts" role="radiogroup" aria-label="Verdict">
          <button
            type="button"
            role="radio"
            aria-checked={verdict === 'comment' || !canApprove}
            className={cx('rv-verdict', (verdict === 'comment' || !canApprove) && 'is-on')}
            onClick={() => setVerdict('comment')}
          >
            <span className="rv-verdict__title">Comment</span>
            <span className="rv-verdict__text">Post your feedback without approving.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={approving}
            disabled={!canApprove}
            title={approveHint ?? undefined}
            className={cx('rv-verdict', approving && 'is-on')}
            onClick={() => setVerdict('approve')}
          >
            <span className="rv-verdict__title">Approve</span>
            <span className="rv-verdict__text">{approveHint ?? 'Post your feedback and approve the merge request.'}</span>
          </button>
        </div>

        <div className="rv-sheet__label">
          {n > 0 ? `${n} pending comment${n === 1 ? '' : 's'}` : 'No pending comments'}
        </div>
        {n > 0 && (
          <ul className="rv-pending">
            {drafts.map((d) => (
              <li key={d.id} className="rv-pending__item">
                <span className="rv-pending__where mono">{where(d)}</span>
                <span className="rv-pending__text">{snippet(d.body, 120)}</span>
                <button
                  type="button"
                  className="rv-pending__remove"
                  aria-label="Discard this comment"
                  title="Discard this comment"
                  onClick={() => onRemoveDraft(d.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
