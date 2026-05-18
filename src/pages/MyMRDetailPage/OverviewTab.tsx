/**
 * Overview tab for MyMRDetailPage — details, description, approvals, merge.
 */

import { useMemo } from 'react';
import { formatRelativeTime, reviewerStatusClass, reviewerStatusLabel } from './utils';
import { MergeSection } from './MergeSection';
import { PipelinesSection } from './PipelinesSection';
import type { MergeActions } from './MergeSection';
import UserAvatar from '../../components/UserAvatar/UserAvatar';
import Markdown, { type IssueLinkContext } from '../../components/Markdown';
import type { MergeRequest, MrReviewer } from '../../types';
import type { MergeState, MergeAction } from './mergeReducer';

interface OverviewTabProps {
  mr: MergeRequest;
  reviewers: MrReviewer[];
  approvedCount: number;
  mergeState: MergeState;
  mergeDispatch: React.Dispatch<MergeAction>;
  mrId: number;
  setMr: React.Dispatch<React.SetStateAction<MergeRequest | null>>;
  mergeActionsRef?: React.MutableRefObject<MergeActions>;
  onMerged?: () => void;
}

export function OverviewTab({
  mr,
  reviewers,
  approvedCount,
  mergeState,
  mergeDispatch,
  mrId,
  setMr,
  mergeActionsRef,
  onMerged,
}: OverviewTabProps) {
  const requiredCount = mr.approvalsRequired ?? 0;

  const issueLinkContext = useMemo<IssueLinkContext | undefined>(() => {
    if (!mr.webUrl) return undefined;
    try {
      const url = new URL(mr.webUrl);
      const m = url.pathname.match(/^\/(.+?)\/-\/merge_requests\//);
      if (!m) return undefined;
      return {
        instanceId: mr.instanceId,
        projectId: mr.projectId,
        instanceOrigin: url.origin,
        projectPath: m[1],
      };
    } catch {
      return undefined;
    }
  }, [mr.webUrl, mr.instanceId, mr.projectId]);

  return (
    <div className="my-mr-overview">
      <section className="my-mr-overview-section">
        <h3>Details</h3>
        <dl className="my-mr-detail-list">
          <dt>State</dt>
          <dd>
            <span className={`my-mr-state-badge ${mr.state}`}>
              {mr.state === 'opened' ? 'Open' : mr.state}
            </span>
          </dd>
          <dt>Branches</dt>
          <dd className="my-mr-branches">
            <code>{mr.sourceBranch}</code>
            <span className="my-mr-arrow">&rarr;</span>
            <code>{mr.targetBranch}</code>
          </dd>
          <dt>Updated</dt>
          <dd>{formatRelativeTime(mr.updatedAt)}</dd>
          {mr.labels.length > 0 && (
            <>
              <dt>Labels</dt>
              <dd className="my-mr-labels">
                {mr.labels.map(label => (
                  <span key={label} className="my-mr-label">{label}</span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </section>

      {mr.description && (
        <section className="my-mr-overview-section">
          <h3>Description</h3>
          <Markdown
            content={mr.description}
            className="my-mr-description"
            issueLinkContext={issueLinkContext}
          />
        </section>
      )}

      <section className="my-mr-overview-section">
        <h3>
          Approvals
          {requiredCount > 0 && (
            <span className="my-mr-approval-summary">
              {approvedCount} of {requiredCount} required
            </span>
          )}
        </h3>
        {reviewers.length === 0 ? (
          <p className="my-mr-no-reviewers">No reviewers assigned</p>
        ) : (
          <div className="my-mr-reviewer-row">
            {reviewers.map(reviewer => (
              <div key={reviewer.username} className={`my-mr-reviewer-chip ${reviewerStatusClass(reviewer.status)}`}>
                <div className="my-mr-reviewer-avatar">
                  <UserAvatar instanceId={mr.instanceId} username={reviewer.username} size={24} />
                </div>
                <span className="my-mr-reviewer-name">{reviewer.username}</span>
                <span className="my-mr-reviewer-dot" title={reviewerStatusLabel(reviewer.status)} />
              </div>
            ))}
          </div>
        )}
      </section>

      <PipelinesSection mrId={mrId} instanceId={mr.instanceId} projectName={mr.projectName} />

      <MergeSection
        mr={mr}
        mergeState={mergeState}
        mergeDispatch={mergeDispatch}
        mrId={mrId}
        setMr={setMr}
        actionsRef={mergeActionsRef}
        onMerged={onMerged}
      />
    </div>
  );
}
