/** The inspector on the right: reviewers, discussions, pipeline, description. */

import { useState } from 'react';
import type { MergeRequest, MrReviewer, PipelineJob, PipelineStatus } from '../../api/types';
import { Avatar, Kbd, Label, StatusIcon, cx } from '../../ui/components';
import { Markdown } from '../../ui/Markdown';
import { duration, splitPath } from '../../lib/format';
import { ThreadCard } from './Notes';
import { snippet, type Thread } from './threads';

interface Props {
  mr: MergeRequest;
  me: string | null;
  reviewers: MrReviewer[] | undefined;
  avatars: Record<string, string> | undefined;
  threads: Thread[];
  /** Usernames who commented on this MR (to show "Commented"). */
  commenters: Set<string>;
  onJump: (thread: Thread) => void;
  pipeline: PipelineStatus | undefined;
  jobs: PipelineJob[] | undefined;
  onOpenJob: (job?: PipelineJob) => void;
}

function reviewerStatus(r: MrReviewer, isMe: boolean, commented: boolean): { text: string; tone: string } {
  if (r.status === 'approved') return { text: 'Approved', tone: 'ok' };
  if (r.status === 'changes_requested') return { text: 'Requested changes', tone: 'fail' };
  if (isMe) return { text: 'Reviewing', tone: 'accent' };
  if (commented) return { text: 'Commented', tone: 'muted' };
  return { text: 'Not started', tone: 'muted' };
}

const JOB_LIMIT = 8;
const DISCUSSION_LIMIT = 5;

export function Aside({ mr, me, reviewers, avatars, threads, commenters, onJump, pipeline, jobs, onOpenJob }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const [openGeneral, setOpenGeneral] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sortedReviewers = [...(reviewers ?? [])].sort((a, b) => (a.username === me ? -1 : b.username === me ? 1 : 0));
  // Plain comments can't be resolved: list them, but they aren't "open".
  const visible = threads.filter((t) => !t.resolved);
  const unresolved = visible.filter((t) => t.resolvable);
  const resolved = threads.filter((t) => t.resolved);
  const matching = showResolved ? threads : visible;
  const shown = showAll ? matching : matching.slice(0, DISCUSSION_LIMIT);

  // Short lists keep pipeline order; long ones lead with what needs attention.
  // GitLab lists jobs newest first; show them in pipeline order.
  const inOrder = jobs ? [...jobs].sort((a, b) => a.id - b.id) : [];
  const orderedJobs = inOrder.length <= JOB_LIMIT ? inOrder : inOrder.sort((a, b) => rank(a) - rank(b));
  const visibleJobs = orderedJobs.slice(0, JOB_LIMIT);

  return (
    <div className="rv-aside__inner">
      <section className="rv-aside__section" aria-label="Reviewers">
        <Label>Reviewers</Label>
        {sortedReviewers.length === 0 && <span className="rv-aside__muted">No reviewers assigned</span>}
        {sortedReviewers.map((r) => {
          const isMe = r.username === me;
          const status = reviewerStatus(r, isMe, commenters.has(r.username));
          return (
            <div key={r.username} className="rv-reviewer">
              <Avatar username={r.username} src={avatars?.[r.username]} size={22} />
              <span className="rv-reviewer__name">{isMe ? 'You' : r.username}</span>
              <span className={cx('rv-reviewer__status', `is-${status.tone}`)}>{status.text}</span>
            </div>
          );
        })}
      </section>

      <section className="rv-aside__section" aria-label="Discussions">
        <div className="rv-aside__head">
          <Label>Discussions{unresolved.length ? ` · ${unresolved.length} open` : ''}</Label>
          {unresolved.length > 0 && (
            <span className="rv-aside__hint" title="Jump to the next unresolved discussion">
              <Kbd>N</Kbd> next
            </span>
          )}
        </div>
        {threads.length === 0 && <span className="rv-aside__muted">No discussions yet</span>}
        {threads.length > 0 && visible.length === 0 && !showResolved && (
          <span className="rv-aside__muted">All discussions are resolved</span>
        )}
        {shown.map((t) => {
          const where = t.filePath ? `${splitPath(t.filePath).name}${t.line ? `:${t.line}` : ''}` : 'General';
          if (!t.filePath && openGeneral === t.id) {
            return (
              <div key={t.id} className="rv-aside__thread">
                <button type="button" className="rv-link rv-aside__collapse" onClick={() => setOpenGeneral(null)}>
                  ‹ {t.resolved ? 'Resolved' : t.resolvable ? 'Unresolved' : 'Comment'} · General
                </button>
                <ThreadCard thread={t} compact />
              </div>
            );
          }
          return (
            <button
              key={t.id}
              type="button"
              className={cx('rv-dcard', t.resolved && 'is-resolved')}
              onClick={() => (t.filePath ? onJump(t) : setOpenGeneral(t.id))}
              title={t.filePath ? `${t.filePath}${t.line ? `:${t.line}` : ''}` : 'Open this discussion'}
            >
              <span className="rv-dcard__where">
                {t.resolved ? 'Resolved' : t.resolvable ? 'Unresolved' : 'Comment'} · {where}
              </span>
              <span className="rv-dcard__text">
                <strong>{t.root.authorUsername === me ? 'You' : t.root.authorUsername}:</strong> {snippet(t.root.body, 80)}
              </span>
              {t.replies.length > 0 && (
                <span className="rv-dcard__replies">
                  {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
                </span>
              )}
            </button>
          );
        })}
        {matching.length > shown.length && (
          <button type="button" className="rv-link rv-aside__toggle" onClick={() => setShowAll(true)}>
            Show {matching.length - shown.length} more
          </button>
        )}
        {resolved.length > 0 && (
          <button type="button" className="rv-link rv-aside__toggle" onClick={() => setShowResolved((v) => !v)}>
            {showResolved
              ? 'Hide resolved threads'
              : `${resolved.length} resolved thread${resolved.length === 1 ? '' : 's'} hidden`}
          </button>
        )}
      </section>

      {pipeline && (
        <section className="rv-aside__section" aria-label="Pipeline">
          <button type="button" className="rv-aside__head rv-aside__headlink" onClick={() => onOpenJob()} title="Open the pipeline (P)">
            <Label>Pipeline #{pipeline.id}</Label>
            <StatusIcon status={pipeline.status} size={14} />
          </button>
          {!jobs && <span className="rv-aside__muted">Loading jobs…</span>}
          {jobs && jobs.length === 0 && <span className="rv-aside__muted">No jobs</span>}
          <div className="rv-jobs">
            {visibleJobs.map((j) => (
              <button
                key={j.id}
                type="button"
                className={cx('rv-job', j.status === 'failed' && (j.allowFailure ? 'is-allowed' : 'is-failed'))}
                onClick={() => onOpenJob(j)}
                title={`${j.stage} · ${j.status}${j.allowFailure ? ' (allowed to fail)' : ''}`}
              >
                <StatusIcon status={j.status} size={12} />
                <span className="rv-job__name">{j.name}</span>
                <span className="rv-job__time tabular">
                  {j.status === 'skipped' || j.status === 'manual' || j.status === 'created'
                    ? j.status === 'created'
                      ? 'waiting'
                      : j.status
                    : duration(j.duration)}
                </span>
              </button>
            ))}
            {orderedJobs.length > JOB_LIMIT && (
              <button type="button" className="rv-link rv-aside__toggle" onClick={() => onOpenJob()}>
                {orderedJobs.length - JOB_LIMIT} more jobs →
              </button>
            )}
          </div>
        </section>
      )}

      <section className="rv-aside__section" aria-label="Description">
        <Label>Description</Label>
        {mr.description?.trim() ? (
          <Markdown source={mr.description} baseUrl={mr.webUrl} className="rv-aside__desc selectable" />
        ) : (
          <span className="rv-aside__muted">No description</span>
        )}
      </section>
    </div>
  );
}

/** Failures first, then what's running, then the rest in pipeline order. */
function rank(j: PipelineJob) {
  if (j.status === 'failed' && !j.allowFailure) return 0;
  if (j.status === 'running' || j.status === 'pending') return 1;
  return 2;
}
