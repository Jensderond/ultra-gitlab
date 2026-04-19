import { useMemo, useState } from 'react';
import Markdown, { type IssueLinkContext } from '../../components/Markdown';
import UserAvatar from '../../components/UserAvatar/UserAvatar';
import type { IssueNote } from '../../types';

interface Props {
  instanceId: number;
  notes: IssueNote[] | undefined;
  loading: boolean;
  issueLinkContext?: IssueLinkContext;
}

function formatDate(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function IssueCommentList({ instanceId, notes, loading, issueLinkContext }: Props) {
  const [showActivity, setShowActivity] = useState(false);

  const systemCount = useMemo(
    () => (notes ? notes.filter((n) => n.system).length : 0),
    [notes],
  );
  const visibleNotes = useMemo(
    () => (showActivity ? notes ?? [] : (notes ?? []).filter((n) => !n.system)),
    [notes, showActivity],
  );

  if (loading) {
    return <div className="issue-comments-loading">Loading comments…</div>;
  }

  const toggle = systemCount > 0 && (
    <label className="issue-comments-activity-toggle">
      <input
        type="checkbox"
        checked={showActivity}
        onChange={(e) => setShowActivity(e.target.checked)}
      />
      Show activity ({systemCount})
    </label>
  );

  if (!notes || notes.length === 0) {
    return <div className="issue-comments-empty">No comments yet.</div>;
  }
  if (visibleNotes.length === 0) {
    return (
      <>
        {toggle}
        <div className="issue-comments-empty">No comments yet.</div>
      </>
    );
  }
  return (
    <>
      {toggle}
      <ol className="issue-comments-list">
      {visibleNotes.map((note) => (
        <li
          key={note.id}
          className={`issue-comment${note.system ? ' is-system' : ''}`}
        >
          {note.system ? (
            <div className="issue-comment-system-line">
              <UserAvatar
                instanceId={instanceId}
                username={note.authorUsername}
                size={16}
              />
              <span className="issue-comment-system-author">{note.authorName}</span>
              <span className="issue-comment-system-body">{note.body}</span>
              <span className="issue-comment-system-date">{formatDate(note.createdAt)}</span>
            </div>
          ) : (
            <>
              <div className="issue-comment-avatar">
                <UserAvatar
                  instanceId={instanceId}
                  username={note.authorUsername}
                  size={32}
                />
              </div>
              <div className="issue-comment-body-wrap">
                <header className="issue-comment-header">
                  <span className="issue-comment-author">{note.authorName}</span>
                  <span className="issue-comment-username">@{note.authorUsername}</span>
                  <span className="issue-comment-date">{formatDate(note.createdAt)}</span>
                </header>
                <Markdown
                  className="issue-comment-body"
                  content={note.body}
                  issueLinkContext={issueLinkContext}
                />
              </div>
            </>
          )}
        </li>
      ))}
    </ol>
    </>
  );
}
