/**
 * Issue Detail page.
 *
 * Route: /issues/:instanceId/:projectId/:issueIid
 *
 * Shows a single GitLab issue with description, metadata sidebar, comments,
 * and basic mutations (add comment, change assignees, close/reopen).
 * Notes and mutations hit GitLab directly and refresh via React Query;
 * they are NOT persisted in SQLite or routed through the sync queue.
 *
 * Clicking an in-app issue link pushes a stacked dialog rather than navigating,
 * so the originating issue is preserved when the user closes it.
 */

import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { IssueRef } from '../../components/Markdown';
import IssueDetailView from './IssueDetailView';
import { IssueDetailDialog } from './IssueDetailDialog';
import './IssueDetailPage.css';

export default function IssueDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ instanceId: string; projectId: string; issueIid: string }>();
  const instanceId = Number(params.instanceId);
  const projectId = Number(params.projectId);
  const issueIid = Number(params.issueIid);

  const [stack, setStack] = useState<IssueRef[]>([]);

  const pushIssue = useCallback((ref: IssueRef) => {
    setStack((s) => [...s, ref]);
  }, []);

  const popIssue = useCallback(() => {
    setStack((s) => s.slice(0, -1));
  }, []);

  const goBackToList = useCallback(() => {
    navigate('/issues');
  }, [navigate]);

  const top = stack.length > 0 ? stack[stack.length - 1] : null;

  return (
    <>
      <IssueDetailView
        instanceId={instanceId}
        projectId={projectId}
        issueIid={issueIid}
        isActive={stack.length === 0}
        onClose={goBackToList}
        onOpenIssue={pushIssue}
      />
      {top && (
        <IssueDetailDialog
          key={`${top.instanceId}-${top.projectId}-${top.issueIid}-${stack.length}`}
          instanceId={top.instanceId}
          projectId={top.projectId}
          issueIid={top.issueIid}
          onClose={popIssue}
          onOpenIssue={pushIssue}
        />
      )}
    </>
  );
}
