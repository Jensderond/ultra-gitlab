/**
 * The right pane: a merge request at a glance. Reviewer mode leads with
 * "Start review"; my-MR mode leads with merge actions. Both share the same
 * cards (why/status, approvals, discussions), the pipeline card and the
 * changes summary.
 */

import { useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import type { Comment, DiffFile, MergeRequest, MrReviewer, PipelineJob } from '../../api/types';
import { useKeys } from '../../app/keys';
import { navigate, paths } from '../../app/router';
import { useAvatars, useComments, useDiffFiles, useMRPipelines, useReviewers } from '../../data/hooks';
import { invalidate, useQuery } from '../../data/query';
import { ago, compact, duration, humanize, plural, splitPath, stripDraft } from '../../lib/format';
import {
  Avatar,
  Button,
  Card,
  cx,
  EmptyState,
  IconButton,
  Progress,
  Sheet,
  Spinner,
  StatusIcon,
  Tag,
  toast,
  pipelineLabel,
} from '../../ui/components';
import { ExternalIcon, MoreIcon } from '../../ui/icons';
import { Markdown } from '../../ui/Markdown';
import { PipelineStrip, usePipelineFailure } from '../pipelines/shared';
import { useGeneratedMatcher, useViewedFiles } from '../review/state';
import {
  copyCheckout,
  openInGitLab,
  popupMenu,
  refreshMR,
  rowMenu,
  setApproved,
  startReview,
  unsnooze,
} from './actions';
import { clientName, formatSnooze, isDraft, isSnoozed, projectPath } from './model';
import './preview.css';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "bob", "bob and carol", "bob, carol and 2 others". */
function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  if (list.length === 3) return `${list[0]}, ${list[1]} and ${list[2]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} others`;
}

/* ------------------------------------------------------------------------ */
/* Summary cards                                                            */
/* ------------------------------------------------------------------------ */

function SummaryCard({ label, title, sub, tone }: { label: string; title: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'fail' }) {
  return (
    <div className="inbox-card">
      <span className="inbox-card__label">{label}</span>
      <span className={cx('inbox-card__title', tone && `is-${tone}`)}>{title}</span>
      {sub && <span className="inbox-card__sub">{sub}</span>}
    </div>
  );
}

function discussionStats(comments: Comment[] | undefined) {
  const threads = new Map<string, Comment[]>();
  let plain = 0;
  for (const c of comments ?? []) {
    if (c.system) continue;
    if (!c.discussionId) {
      plain++;
      continue;
    }
    const t = threads.get(c.discussionId) ?? [];
    t.push(c);
    threads.set(c.discussionId, t);
  }
  let resolved = 0;
  let unresolved = 0;
  for (const notes of threads.values()) {
    // GitLab says which discussions can be resolved; individual comments can't.
    const resolvable = notes.some((n) => n.resolvable);
    if (notes.every((n) => n.resolved)) resolved++;
    else if (resolvable) unresolved++;
    else plain++;
  }
  return { resolved, unresolved, plain };
}

function approvalsCard(mr: MergeRequest, reviewers: MrReviewer[] | undefined, comments: Comment[] | undefined, me: string | null) {
  const required = mr.approvalsRequired ?? 0;
  const count = mr.approvalsCount ?? 0;
  const title = required > 0 ? `${count} of ${required} required` : count > 0 ? plural(count, 'approval') : 'Not required';
  const approved = (reviewers ?? []).filter((r) => r.status === 'approved').map((r) => (r.username === me ? 'You' : r.username));
  const changes = (reviewers ?? []).filter((r) => r.status === 'changes_requested').map((r) => r.username);
  const commenters = [
    ...new Set(
      (comments ?? [])
        .filter((c) => !c.system && c.authorUsername !== mr.authorUsername && c.authorUsername !== me)
        .map((c) => c.authorUsername),
    ),
  ];
  let sub: string;
  if (changes.length) sub = `${names(changes)} requested changes`;
  else if (approved.length) sub = `${names(approved)} approved`;
  else if (mr.userHasApproved) sub = 'You approved';
  else if (commenters.length) sub = `${names(commenters)} commented`;
  else sub = 'No reviews yet';
  const tone = changes.length ? 'warn' : required > 0 && count >= required ? 'ok' : undefined;
  return { title, sub, tone } as const;
}

/* ------------------------------------------------------------------------ */
/* Pipeline                                                                 */
/* ------------------------------------------------------------------------ */

function matchChanged(path: string, files: DiffFile[] | undefined): DiffFile | undefined {
  const p = path.replace(/^\.?\//, '');
  return files?.find((f) => f.newPath === p || p.endsWith(`/${f.newPath}`) || f.newPath.endsWith(`/${p}`));
}

function PipelineCard({ mr, files }: { mr: MergeRequest; files: DiffFile[] | undefined }) {
  const { data: pipelines, loading } = useMRPipelines(mr.state === 'opened' ? mr.id : undefined);
  const head = pipelines?.[0];
  const status = head?.status ?? mr.headPipelineStatus;
  const failed = status === 'failed';
  const { data: failure } = usePipelineFailure(mr.instanceId, head?.projectId ?? mr.projectId, head?.id);

  const openPipeline = (job?: PipelineJob) =>
    head && navigate(paths.pipeline(mr.instanceId, head.projectId ?? mr.projectId, head.id, job?.id));

  if (!status) {
    if (loading) return null;
    return <div className="inbox-pipeline-none">No pipeline has run for this merge request.</div>;
  }

  if (failed) {
    const job = failure?.failedJobs[0];
    const location = failure?.locations.find((l) => matchChanged(l.path, files)) ?? failure?.locations[0];
    const changed = location ? matchChanged(location.path, files) : undefined;
    return (
      <Card tone="fail" className="inbox-pipeline is-failed">
        <div className="inbox-pipeline__head">
          <span className="inbox-pipeline__title">
            <StatusIcon status="failed" />
            {head ? `Pipeline #${head.id} failed` : 'Pipeline failed'}
            {job && ` in ${job.stage}`}
          </span>
          {head && (
            <button type="button" className="inbox-link" onClick={() => openPipeline(job)}>
              Open log →
            </button>
          )}
        </div>
        {failure && failure.jobs.length > 0 && <PipelineStrip jobs={failure.jobs} onJob={openPipeline} />}
        {failure?.headline && <div className="inbox-pipeline__headline">{failure.headline}</div>}
        {failure?.excerpt && <code className="inbox-pipeline__excerpt selectable">{failure.excerpt}</code>}
        {location && (
          <span className="inbox-pipeline__points">
            Points to{' '}
            {changed ? (
              <button type="button" className="inbox-path" onClick={() => navigate(paths.review(mr.id, changed.newPath))}>
                {location.path}
                {location.line ? `:${location.line}` : ''}
              </button>
            ) : (
              <span className="inbox-path">
                {location.path}
                {location.line ? `:${location.line}` : ''}
              </span>
            )}
            {changed ? ', changed in this merge request.' : ', which this merge request doesn’t touch.'}
          </span>
        )}
      </Card>
    );
  }

  const running = status === 'running' || status === 'pending';
  const when = head ? (running ? `started ${ago(head.createdAt)}` : ago(head.updatedAt ?? head.createdAt)) : '';
  return (
    <div className={cx('inbox-pipeline is-compact', running && 'is-running')}>
      <div className="inbox-pipeline__head">
        <span className="inbox-pipeline__title">
          <StatusIcon status={status} />
          {head ? `Pipeline #${head.id}` : 'Pipeline'} {pipelineLabel(status).toLowerCase()}
          <span className="inbox-pipeline__meta">
            {head?.duration ? ` · ${duration(head.duration)}` : ''}
            {when ? ` · ${when}` : ''}
          </span>
        </span>
        {head && (
          <button type="button" className="inbox-link" onClick={() => openPipeline()}>
            Open →
          </button>
        )}
      </div>
      {running && failure && failure.jobs.length > 0 && <PipelineStrip jobs={failure.jobs} onJob={openPipeline} />}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Changes                                                                  */
/* ------------------------------------------------------------------------ */

const KINDS: [RegExp, string][] = [
  [/\.(tsx?|mts|cts)$/, 'TypeScript'],
  [/\.(jsx?|mjs|cjs)$/, 'JavaScript'],
  [/\.php$/, 'PHP'],
  [/\.twig$/, 'Twig'],
  [/\.(s?css|less|sass)$/, 'CSS'],
  [/\.(html?|vue|svelte)$/, 'markup'],
  [/\.rs$/, 'Rust'],
  [/\.py$/, 'Python'],
  [/\.go$/, 'Go'],
  [/\.rb$/, 'Ruby'],
  [/\.(java|kt)$/, 'JVM'],
  [/\.(md|mdx|rst|txt)$/, 'docs'],
  [/\.(sql)$/, 'SQL'],
  [/\.(svg|png|jpe?g|gif|webp|ico)$/, 'images'],
  [/(\.(ya?ml|json|toml|ini|xml|neon|lock|env|conf)$)|(^|\/)(Dockerfile|Makefile|\.[\w-]+rc|\.gitlab-ci\.yml)$/, 'config'],
];

function kindOf(path: string): string {
  for (const [re, label] of KINDS) if (re.test(path)) return label;
  const ext = splitPath(path).name.split('.').pop();
  return ext && ext !== splitPath(path).name ? ext : 'other';
}

function breakdown(files: DiffFile[]): string {
  const counts = new Map<string, number>();
  for (const f of files) counts.set(kindOf(f.newPath), (counts.get(kindOf(f.newPath)) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = sorted.slice(0, 3).map(([k, n]) => `${n} ${k}`);
  const rest = sorted.slice(3).reduce((n, [, c]) => n + c, 0);
  if (rest) shown.push(`${rest} other`);
  return shown.join(' · ');
}

function Changes({ mr, files, loading }: { mr: MergeRequest; files: DiffFile[] | undefined; loading: boolean }) {
  const isGenerated = useGeneratedMatcher(mr.instanceId, mr.projectId);
  const { viewed } = useViewedFiles(mr.id);
  const all = files ?? [];
  const generated = all.filter((f) => isGenerated(f.newPath));
  const reviewable = all.filter((f) => !isGenerated(f.newPath));
  const seen = reviewable.filter((f) => viewed.has(f.newPath)).length;
  const adds = reviewable.reduce((n, f) => n + f.additions, 0);
  const dels = reviewable.reduce((n, f) => n + f.deletions, 0);

  return (
    <section className="inbox-section" aria-label="Changes">
      <div className="inbox-section__head">
        <span className="inbox-section__title">Changes</span>
        {reviewable.length > 0 && (
          <span className="inbox-section__aside tabular">
            {seen} of {plural(reviewable.length, 'file')} viewed
          </span>
        )}
      </div>
      {loading && !files ? (
        <div className="inbox-muted-line">
          <Spinner size={12} /> Loading changes…
        </div>
      ) : all.length === 0 ? (
        <div className="inbox-muted-line">The diff hasn’t synced yet. It appears here after the next sync.</div>
      ) : (
        <>
          <Progress value={seen} max={reviewable.length} label="Files viewed" />
          <div className={cx('inbox-changes', generated.length > 0 && 'has-generated')}>
            <button type="button" className="inbox-card inbox-card--button" onClick={() => startReview(mr)}>
              <span className="inbox-card__title">
                {reviewable.length - seen === reviewable.length
                  ? `${plural(reviewable.length, 'file')} to review`
                  : `${reviewable.length - seen} of ${plural(reviewable.length, 'file')} left`}
              </span>
              <span className="inbox-card__sub">
                {breakdown(reviewable)}
                {reviewable.length > 0 && ' · '}
                <span className="mono tabular">
                  <span className="inbox-add">+{compact(adds)}</span> <span className="inbox-del">−{compact(dels)}</span>
                </span>
              </span>
            </button>
            {generated.length > 0 && (
              <div className="inbox-card is-dashed">
                <span className="inbox-card__title is-quiet">
                  {plural(generated.length, 'generated file')} tucked away
                </span>
                <span className="inbox-card__sub" title={generated.map((f) => f.newPath).join('\n')}>
                  {generated
                    .slice(0, 3)
                    .map((f) => splitPath(f.newPath).name)
                    .join(' · ')}
                  {generated.length > 3 && ` · ${generated.length - 3} more`}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Reviewers (my MR mode)                                                   */
/* ------------------------------------------------------------------------ */

const REVIEWER_STATUS: Record<MrReviewer['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  approved: { label: 'Approved', tone: 'ok' },
  changes_requested: { label: 'Changes requested', tone: 'warn' },
  pending: { label: 'Not reviewed yet', tone: 'neutral' },
};

function Reviewers({
  mr,
  reviewers,
  avatars,
  me,
}: {
  mr: MergeRequest;
  reviewers: MrReviewer[] | undefined;
  avatars: Record<string, string> | undefined;
  me: string | null;
}) {
  const list: MrReviewer[] =
    reviewers ?? mr.reviewers.map((username) => ({ mrId: mr.id, username, status: 'pending', cachedAt: 0 }));
  return (
    <section className="inbox-section" aria-label="Reviewers">
      <div className="inbox-section__head">
        <span className="inbox-section__title">Reviewers</span>
      </div>
      {list.length === 0 ? (
        <div className="inbox-muted-line">No reviewers yet — assign someone in GitLab.</div>
      ) : (
        <div className="inbox-reviewers">
          {list.map((r) => (
            <div key={r.username} className="inbox-reviewer">
              <Avatar username={r.username} src={avatars?.[r.username]} size={22} />
              <span className="inbox-reviewer__name">
                {r.username}
                {r.username === me && <span className="inbox-you"> (you)</span>}
              </span>
              <Tag tone={REVIEWER_STATUS[r.status].tone}>{REVIEWER_STATUS[r.status].label}</Tag>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Merge (my MR mode)                                                       */
/* ------------------------------------------------------------------------ */

function mergeStatusText(status: string | null | undefined): { title: string; tone?: 'ok' | 'warn' | 'fail' } {
  switch (status) {
    case 'mergeable':
      return { title: 'Ready to merge', tone: 'ok' };
    case 'need_rebase':
      return { title: 'Needs a rebase', tone: 'warn' };
    case 'ci_must_pass':
    case 'ci_still_running':
      return { title: 'Waiting for the pipeline' };
    case 'not_approved':
    case 'approvals_syncing':
      return { title: 'Waiting for approval' };
    case 'discussions_not_resolved':
      return { title: 'Unresolved discussions', tone: 'warn' };
    case 'draft_status':
      return { title: 'Still a draft' };
    case 'conflict':
    case 'broken_status':
      return { title: 'Has conflicts', tone: 'fail' };
    case 'requested_changes':
      return { title: 'Changes requested', tone: 'warn' };
    case 'blocked_status':
      return { title: 'Blocked by another MR', tone: 'warn' };
    case 'checking':
    case 'unchecked':
    case 'preparing':
      return { title: 'Checking mergeability…' };
    case undefined:
    case null:
      return { title: 'Checking mergeability…' };
    default:
      return { title: humanize(status) };
  }
}

function autoMergeText(status: string | null): string {
  switch (status) {
    case null:
      return 'waiting for the first check';
    case 'mergeable':
      return 'merging on the next sync';
    case 'need_rebase':
      return 'rebasing on the next sync';
    case 'ci_must_pass':
    case 'ci_still_running':
      return 'waiting for the pipeline';
    case 'not_approved':
      return 'waiting for approval';
    case 'discussions_not_resolved':
      return 'waiting for discussions to resolve';
    case 'draft_status':
      return 'waiting — still a draft';
    case 'conflict':
      return 'has conflicts, can’t merge automatically';
    default:
      return `waiting — ${status.replace(/_/g, ' ')}`;
  }
}

function useMergeStatus(mr: MergeRequest, enabled: boolean) {
  return useQuery(
    enabled && mr.state === 'opened' ? ['mr', mr.id, 'merge-status'] : null,
    () => api.mergeStatus(mr.id),
    { staleTime: 30_000 },
  );
}

function useAutoMerge(mr: MergeRequest, enabled: boolean) {
  return useQuery(
    enabled && mr.state === 'opened' ? ['mr', mr.id, 'auto-merge'] : null,
    () => api.autoMergeClaim(mr.id),
    { staleTime: 10_000 },
  );
}

/* ------------------------------------------------------------------------ */
/* Preview                                                                  */
/* ------------------------------------------------------------------------ */

export function Preview({
  mr,
  mineMode,
  me,
  loading,
  error,
}: {
  mr: MergeRequest | undefined;
  mineMode: boolean;
  me: string | null;
  loading: boolean;
  error?: Error;
}) {
  if (!mr) {
    if (loading) {
      return (
        <div className="inbox-preview is-empty">
          <Spinner />
        </div>
      );
    }
    return (
      <div className="inbox-preview is-empty">
        <EmptyState
          title={error ? 'Couldn’t open this merge request' : 'No merge request selected'}
          message={error ? error.message : 'Pick one from the list, or move with J and K.'}
        />
      </div>
    );
  }
  return <PreviewBody key={mr.id} mr={mr} mineMode={mineMode} me={me} />;
}

function PreviewBody({ mr, mineMode, me }: { mr: MergeRequest; mineMode: boolean; me: string | null }) {
  const files = useDiffFiles(mr.id);
  const { data: reviewers } = useReviewers(mr.id);
  const { data: comments } = useComments(mr.id);
  const avatars = useAvatars(mr.instanceId, [mr.authorUsername, ...mr.reviewers]);
  const open = mr.state === 'opened';
  const mine = mineMode || mr.authorUsername === me;
  const canApprove = open && mr.authorUsername !== me;
  const draft = isDraft(mr);

  const mergeStatus = useMergeStatus(mr, mine);
  const autoMerge = useAutoMerge(mr, mine);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [busy, setBusy] = useState<null | 'merge' | 'rebase' | 'ready' | 'auto'>(null);

  const mergeable = open && !draft && mergeStatus.data === 'mergeable';

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(kind);
    try {
      await fn();
      toast(done, { tone: 'success' });
    } catch (e) {
      toast(`${failed}: ${errMessage(e)}`, { tone: 'error' });
    } finally {
      setBusy(null);
      refreshMR(mr.id);
    }
  };

  const doMerge = () => {
    setConfirmMerge(false);
    void run('merge', () => api.merge(mr.id), `Merged !${mr.iid} into ${mr.targetBranch}`, `Couldn’t merge !${mr.iid}`);
  };
  const doRebase = () =>
    void run('rebase', () => api.rebase(mr.id), `Rebasing !${mr.iid} onto ${mr.targetBranch}…`, 'Rebase failed').then(() =>
      setTimeout(() => void invalidate(['mr', mr.id, 'merge-status']), 3000),
    );
  const doReady = () =>
    void run('ready', () => api.markReady(mr.id), `!${mr.iid} is ready for review`, 'Couldn’t mark as ready');
  const toggleAuto = () => {
    const on = !!autoMerge.data;
    void run(
      'auto',
      () => (on ? api.unclaimAutoMerge(mr.id) : api.claimAutoMerge(mr.id)),
      on ? 'Auto-merge cancelled' : `!${mr.iid} will merge as soon as it’s ready`,
      on ? 'Couldn’t cancel auto-merge' : 'Couldn’t turn on auto-merge',
    );
  };

  useKeys({
    'mod+shift+a': canApprove && (() => void setApproved(mr, !mr.userHasApproved)),
    'mod+enter': mine && open && (() => (mergeable ? setConfirmMerge(true) : toast(mergeStatusText(mergeStatus.data).title))),
  });

  const client = clientName(mr);
  const discussions = discussionStats(comments);
  const approvals = approvalsCard(mr, reviewers, comments, me);
  const reviewerOthers = mr.reviewers.filter((r) => r !== me);
  const status = mergeStatusText(draft ? 'draft_status' : mergeStatus.data);

  const moreMenu = (e: React.MouseEvent<HTMLButtonElement>) =>
    void popupMenu(e.currentTarget, [
      ...rowMenu(mr, { canApprove }).map((entry) =>
        'label' in entry && (entry.label === 'Approve' || entry.label === 'Remove Approval')
          ? { ...entry, shortcut: 'CmdOrCtrl+Shift+A' }
          : entry,
      ),
    ]);

  let actions: ReactNode;
  if (!open) {
    actions = (
      <>
        <Button variant="primary" size="lg" shortcut="enter" onClick={() => startReview(mr)}>
          View changes
        </Button>
        <Button size="lg" onClick={() => openInGitLab(mr)} icon={<ExternalIcon size={13} />}>
          Open in GitLab
        </Button>
      </>
    );
  } else if (mine) {
    actions = (
      <>
        {draft ? (
          <Button variant="primary" size="lg" busy={busy === 'ready'} onClick={doReady}>
            Mark as ready
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            shortcut="mod+enter"
            disabled={!mergeable}
            busy={busy === 'merge'}
            onClick={() => setConfirmMerge(true)}
            title={mergeable ? 'Merge (⌘↩)' : status.title}
          >
            Merge
          </Button>
        )}
        {!draft && (
          <Button size="lg" busy={busy === 'auto'} onClick={toggleAuto} aria-pressed={!!autoMerge.data}>
            {autoMerge.data ? 'Cancel auto-merge' : 'Merge when ready'}
          </Button>
        )}
        {mergeStatus.data === 'need_rebase' && (
          <Button size="lg" busy={busy === 'rebase'} onClick={doRebase}>
            Rebase
          </Button>
        )}
        <Button size="lg" shortcut="enter" onClick={() => startReview(mr)}>
          View changes
        </Button>
        <Button size="lg" onClick={() => openInGitLab(mr)}>
          Open in GitLab
        </Button>
      </>
    );
  } else {
    actions = (
      <>
        <Button variant="primary" size="lg" shortcut="enter" onClick={() => startReview(mr)}>
          Start review
        </Button>
        <Button size="lg" onClick={() => copyCheckout(mr)} title={`git fetch origin ${mr.sourceBranch} && git checkout ${mr.sourceBranch}`}>
          Check out locally
        </Button>
        <Button size="lg" onClick={() => openInGitLab(mr)}>
          Open in GitLab
        </Button>
      </>
    );
  }

  return (
    <div className="inbox-preview">
      <article className="inbox-preview__inner" aria-label="Selected merge request">
        <header className="inbox-head">
          <div className="inbox-crumbs">
            <span>{client}</span>
            <span aria-hidden="true">›</span>
            <span className="mono">{projectPath(mr)}</span>
            <span aria-hidden="true">›</span>
            <span className="mono selectable">!{mr.iid}</span>
            {draft && <Tag>Draft</Tag>}
            {isSnoozed(mr) && mr.snoozedUntil && (
              <>
                <Tag>Snoozed until {formatSnooze(mr.snoozedUntil)}</Tag>
                <button type="button" className="inbox-link" onClick={() => void unsnooze(mr)}>
                  Unsnooze
                </button>
              </>
            )}
          </div>
          <h1 className="inbox-title selectable">{stripDraft(mr.title)}</h1>
          <div className="inbox-byline">
            <Avatar username={mr.authorUsername} src={avatars?.[mr.authorUsername]} size={22} />
            <span>
              {mr.authorUsername === me ? 'You' : mr.authorUsername} {open ? (mr.authorUsername === me ? 'want to merge' : 'wants to merge') : 'merged'}
            </span>
            <code className="inbox-branch">{mr.sourceBranch}</code>
            <span aria-hidden="true">→</span>
            <code className="inbox-branch">{mr.targetBranch}</code>
            <span className="inbox-byline__when" title={new Date((mr.createdAt < 1e12 ? mr.createdAt * 1000 : mr.createdAt)).toLocaleString()}>
              · {open || !mr.mergedAt ? `opened ${ago(mr.createdAt)}` : ago(mr.mergedAt)}
            </span>
          </div>
        </header>

        <div className="inbox-actions">
          {actions}
          <IconButton label="More actions" onClick={moreMenu} className="inbox-more">
            <MoreIcon size={16} />
          </IconButton>
        </div>
        {mine && open && autoMerge.data && (
          <div className={cx('inbox-automerge', autoMerge.data.lastError && 'is-error')}>
            <Spinner size={12} />
            <span>
              Merge when ready is on — {autoMergeText(autoMerge.data.lastStatus)}
              {autoMerge.data.lastError && `. Last attempt failed: ${autoMerge.data.lastError}`}
            </span>
          </div>
        )}

        <div className="inbox-cards">
          {mine ? (
            <SummaryCard
              label="Status"
              title={!open ? 'Merged' : status.title}
              tone={!open ? 'ok' : status.tone}
              sub={mr.authorUsername === me ? 'You’re the author' : `Assigned to you · by ${mr.authorUsername}`}
            />
          ) : (
            <SummaryCard
              label="Why you’re here"
              title={me && mr.reviewers.includes(me) ? 'Assigned reviewer' : 'In your review queue'}
              sub={
                me && mr.reviewers.includes(me)
                  ? reviewerOthers.length
                    ? `Together with ${names(reviewerOthers)}`
                    : 'You’re the only reviewer'
                  : 'You’re not a requested reviewer'
              }
            />
          )}
          <SummaryCard label="Approvals" title={approvals.title} sub={approvals.sub} tone={approvals.tone} />
          <SummaryCard
            label="Discussions"
            title={
              discussions.unresolved
                ? `${discussions.unresolved} unresolved`
                : discussions.resolved
                  ? 'All resolved'
                  : discussions.plain
                    ? plural(discussions.plain, 'comment')
                    : 'No discussions'
            }
            sub={
              comments === undefined
                ? '\u00a0'
                : [
                    discussions.resolved && `${discussions.resolved} resolved`,
                    discussions.plain && (discussions.unresolved || discussions.resolved) && plural(discussions.plain, 'comment'),
                  ]
                    .filter(Boolean)
                    .join(' · ') ||
                  (discussions.unresolved ? 'None resolved yet' : discussions.plain ? 'No open threads' : 'Nobody has commented yet')
            }
          />
        </div>

        <PipelineCard mr={mr} files={files.data} />

        <Changes mr={mr} files={files.data} loading={files.loading} />

        {mine && <Reviewers mr={mr} reviewers={reviewers} avatars={avatars} me={me} />}

        {mr.description?.trim() && (
          <section className="inbox-section" aria-label="Description">
            <div className="inbox-section__head">
              <span className="inbox-section__title">Description</span>
            </div>
            <Markdown source={mr.description} baseUrl={mr.webUrl} className="inbox-description selectable" />
          </section>
        )}
      </article>

      <Sheet
        open={confirmMerge}
        onClose={() => setConfirmMerge(false)}
        title={`Merge !${mr.iid}?`}
        width={460}
        footer={
          <>
            <Button data-autofocus-skip onClick={() => setConfirmMerge(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={doMerge}>
              Merge
            </Button>
          </>
        }
      >
        <p className="inbox-sheet-text">
          <strong>{stripDraft(mr.title)}</strong>
        </p>
        <p className="inbox-sheet-text inbox-muted">
          <code className="inbox-branch">{mr.sourceBranch}</code> will be merged into{' '}
          <code className="inbox-branch">{mr.targetBranch}</code> in <span className="mono">{projectPath(mr)}</span>.
        </p>
      </Sheet>
    </div>
  );
}
