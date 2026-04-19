/**
 * Issue Detail page.
 *
 * Route: /issues/:instanceId/:projectId/:issueIid
 *
 * Shows a single GitLab issue with description, metadata sidebar, comments,
 * and basic mutations (add comment, change assignees, close/reopen).
 * Notes and mutations hit GitLab directly and refresh via React Query;
 * they are NOT persisted in SQLite or routed through the sync queue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import Markdown, { type IssueLinkContext } from '../../components/Markdown';
import UserAvatar from '../../components/UserAvatar/UserAvatar';
import { ShortcutBar } from '../../components/ShortcutBar';
import type { ShortcutDef } from '../../components/ShortcutBar';
import { openExternalUrl } from '../../services/transport';
import { useCopyToast } from '../../hooks/useCopyToast';
import { IssueCommentList } from './IssueCommentList';
import {
  IssueCommentComposer,
  type IssueCommentComposerHandle,
} from './IssueCommentComposer';
import { AssigneePicker } from './AssigneePicker';
import {
  useIssueDetailQuery,
  useIssueNotesQuery,
  useAddIssueNote,
  useSetIssueAssignees,
  useSetIssueState,
} from './useIssueData';
import './IssueDetailPage.css';

const shortcuts: ShortcutDef[] = [
  { key: 'c', label: 'comment' },
  { key: 'a', label: 'assignees' },
  { key: 'o', label: 'open in GitLab' },
  { key: 'y', label: 'yank link' },
  { key: 'esc', label: 'back' },
];

function formatDate(unixSecs: number | null | undefined): string | null {
  if (!unixSecs) return null;
  return new Date(unixSecs * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default function IssueDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ instanceId: string; projectId: string; issueIid: string }>();
  const instanceId = Number(params.instanceId);
  const projectId = Number(params.projectId);
  const issueIid = Number(params.issueIid);

  const [showCopyToast, copyToClipboard] = useCopyToast();
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const composerRef = useRef<IssueCommentComposerHandle>(null);

  const issueQuery = useIssueDetailQuery(instanceId, projectId, issueIid);
  const notesQuery = useIssueNotesQuery(instanceId, projectId, issueIid);
  const addNote = useAddIssueNote(instanceId, projectId, issueIid);
  const setAssignees = useSetIssueAssignees(instanceId, projectId, issueIid);
  const setState = useSetIssueState(instanceId, projectId, issueIid);

  const issue = issueQuery.data;
  const notes = notesQuery.data;

  const labels = useMemo(() => parseJsonArray(issue?.labels), [issue?.labels]);
  const assigneeUsernames = useMemo(
    () => parseJsonArray(issue?.assigneeUsernames),
    [issue?.assigneeUsernames],
  );

  const issueLinkContext = useMemo<IssueLinkContext | undefined>(() => {
    if (!issue?.webUrl || !issue.projectPathWithNamespace) return undefined;
    try {
      const origin = new URL(issue.webUrl).origin;
      return {
        instanceId,
        projectId,
        instanceOrigin: origin,
        projectPath: issue.projectPathWithNamespace,
      };
    } catch {
      return undefined;
    }
  }, [issue?.webUrl, issue?.projectPathWithNamespace, instanceId, projectId]);

  const goBack = useCallback(() => {
    navigate('/issues');
  }, [navigate]);

  const handleOpenInGitLab = useCallback(() => {
    if (issue?.webUrl) openExternalUrl(issue.webUrl);
  }, [issue?.webUrl]);

  const handleYank = useCallback(() => {
    if (issue?.webUrl) copyToClipboard(issue.webUrl);
  }, [issue?.webUrl, copyToClipboard]);

  const handleFocusComposer = useCallback(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (assigneePickerOpen) setAssigneePickerOpen(false);
        else goBack();
      } else if (e.key === 'c') {
        e.preventDefault();
        handleFocusComposer();
      } else if (e.key === 'a') {
        e.preventDefault();
        setAssigneePickerOpen(true);
      } else if (e.key === 'o') {
        e.preventDefault();
        handleOpenInGitLab();
      } else if (e.key === 'y') {
        e.preventDefault();
        handleYank();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [assigneePickerOpen, goBack, handleFocusComposer, handleOpenInGitLab, handleYank]);

  if (issueQuery.isLoading) {
    return (
      <div className="issue-detail">
        <div className="issue-detail-loading">Loading issue…</div>
      </div>
    );
  }

  if (issueQuery.isError || !issue) {
    return (
      <div className="issue-detail">
        <div className="issue-detail-error">
          <p>{issueQuery.error instanceof Error ? issueQuery.error.message : 'Issue not found'}</p>
          <button className="primary-button" onClick={goBack}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const isClosed = issue.state === 'closed';
  const projectLabel =
    issue.projectCustomName ||
    issue.projectNameWithNamespace ||
    issue.projectPathWithNamespace ||
    '';

  return (
    <div className="issue-detail">
      <header className="mr-detail-header">
        <div className="mr-header-top">
          <BackButton onClick={goBack} title="Back to issues" />
          <span className="mr-iid">#{issue.iid}</span>
          {projectLabel && (
            <span className="mr-project">
              {projectLabel.replace(/^Customers\s*\/\s*/, '')}
            </span>
          )}
          <div className="mr-detail-actions">
            <span className={`issue-state-pill ${isClosed ? 'closed' : 'open'}`}>
              {isClosed ? 'Closed' : 'Open'}
            </span>
          </div>
        </div>
        <div className="mr-header-bottom">
          <h1 className="mr-title">{issue.title}</h1>
          <div className="mr-detail-meta">
            <span className="mr-author">
              <UserAvatar
                instanceId={instanceId}
                username={issue.authorUsername}
                size={20}
                className="mr-author-avatar"
              />
              {issue.authorUsername}
            </span>
            {formatDate(issue.createdAt) && (
              <span className="mr-branches">{formatDate(issue.createdAt)}</span>
            )}
          </div>
        </div>
      </header>

      <div className="issue-detail-body">
        <main className="issue-detail-main">
          <section className="issue-description">
            {issue.description?.trim() ? (
              <Markdown content={issue.description} issueLinkContext={issueLinkContext} />
            ) : (
              <div className="issue-description-empty">No description.</div>
            )}
          </section>

          <section className="issue-comments-section">
            <h3>Comments</h3>
            <IssueCommentList
              instanceId={instanceId}
              notes={notes}
              loading={notesQuery.isLoading}
              issueLinkContext={issueLinkContext}
            />
            <IssueCommentComposer
              ref={composerRef}
              busy={addNote.isPending}
              onSubmit={async (body) => {
                await addNote.mutateAsync(body);
              }}
            />
          </section>
        </main>

        <aside className="issue-detail-sidebar">
          <div className="issue-sidebar-section">
            <div className="issue-sidebar-heading-row">
              <h4>Assignees</h4>
              <button
                type="button"
                className="issue-sidebar-edit"
                onClick={() => setAssigneePickerOpen(true)}
                disabled={setAssignees.isPending}
              >
                Edit
              </button>
            </div>
            {assigneeUsernames.length === 0 ? (
              <div className="issue-sidebar-empty">None</div>
            ) : (
              <ul className="issue-assignee-chips">
                {assigneeUsernames.map((username) => (
                  <li key={username} className="issue-assignee-chip">
                    <UserAvatar instanceId={instanceId} username={username} size={20} />
                    <span>@{username}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="issue-sidebar-section">
            <h4>Labels</h4>
            {labels.length === 0 ? (
              <div className="issue-sidebar-empty">None</div>
            ) : (
              <ul className="issue-label-list">
                {labels.map((l) => (
                  <li key={l} className="issue-label">
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="issue-sidebar-section">
            <h4>Dates</h4>
            <dl className="issue-date-list">
              <dt>Created</dt>
              <dd>{formatDate(issue.createdAt) ?? '—'}</dd>
              <dt>Updated</dt>
              <dd>{formatDate(issue.updatedAt) ?? '—'}</dd>
              {isClosed && (
                <>
                  <dt>Closed</dt>
                  <dd>{formatDate(issue.closedAt) ?? '—'}</dd>
                </>
              )}
              {issue.dueDate && (
                <>
                  <dt>Due</dt>
                  <dd>{issue.dueDate}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="issue-sidebar-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleOpenInGitLab}
            >
              Open in GitLab
            </button>
            <button
              type="button"
              className={isClosed ? 'primary-button' : 'secondary-button danger'}
              onClick={() => setState.mutate(isClosed ? 'reopen' : 'close')}
              disabled={setState.isPending}
            >
              {setState.isPending
                ? 'Saving…'
                : isClosed
                  ? 'Reopen issue'
                  : 'Close issue'}
            </button>
          </div>
        </aside>
      </div>

      {assigneePickerOpen && (
        <AssigneePicker
          instanceId={instanceId}
          projectId={projectId}
          currentUsernames={assigneeUsernames}
          busy={setAssignees.isPending}
          onClose={() => setAssigneePickerOpen(false)}
          onApply={(ids) => {
            setAssignees.mutate(ids, {
              onSuccess: () => setAssigneePickerOpen(false),
            });
          }}
        />
      )}

      {showCopyToast && <div className="copy-toast">Link copied</div>}

      <footer className="issue-detail-footer">
        <ShortcutBar shortcuts={shortcuts} variant="detail" />
      </footer>
    </div>
  );
}
