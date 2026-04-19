/**
 * Single issue row. Mirrors MRListItem visually so the Issues section
 * feels like a first-class citizen of the app.
 */

import { forwardRef, useMemo } from 'react';
import type { IssueWithProject } from '../../types';
import UserAvatar from '../UserAvatar/UserAvatar';
import HighlightText from '../HighlightText/HighlightText';
import './IssueListItem.css';

interface IssueListItemProps {
  issue: IssueWithProject;
  selected?: boolean;
  onClick?: () => void;
  onToggleStar?: () => void;
  highlightQuery?: string;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const IssueListItem = forwardRef<HTMLDivElement, IssueListItemProps>(function IssueListItem(
  { issue, selected, onClick, onToggleStar, highlightQuery },
  ref,
) {
  const classNames = ['issue-list-item'];
  if (selected) classNames.push('selected');
  if (issue.state === 'closed') classNames.push('state-closed');

  const labels = useMemo(() => {
    try {
      return JSON.parse(issue.labels) as string[];
    } catch {
      return [] as string[];
    }
  }, [issue.labels]);

  const assignees = useMemo(() => {
    try {
      return JSON.parse(issue.assigneeUsernames) as string[];
    } catch {
      return [] as string[];
    }
  }, [issue.assigneeUsernames]);

  const projectLabel =
    issue.projectCustomName && issue.projectCustomName.trim().length > 0
      ? issue.projectCustomName
      : issue.projectNameWithNamespace ?? '';

  const projectOriginal = issue.projectNameWithNamespace ?? issue.projectPathWithNamespace ?? '';
  const projectTooltip =
    issue.projectCustomName && projectOriginal
      ? `Original name: ${projectOriginal}`
      : projectOriginal;

  return (
    <div
      ref={ref}
      className={classNames.join(' ')}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
        }
      }}
    >
      <button
        type="button"
        className={`issue-star-button${issue.starred ? ' is-starred' : ''}`}
        aria-label={issue.starred ? 'Unstar issue' : 'Star issue'}
        title={issue.starred ? 'Unstar issue' : 'Star issue'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar?.();
        }}
      >
        <StarIcon filled={issue.starred} />
      </button>

      <div className="issue-item-body">
        <div className="issue-item-header">
          <span className="issue-iid">#{issue.iid}</span>
          {projectLabel && (
            <span className="issue-project" title={projectTooltip}>
              {highlightQuery ? (
                <HighlightText text={projectLabel} query={highlightQuery} />
              ) : (
                projectLabel
              )}
              {issue.projectStarred && <span className="issue-project-star" aria-hidden>★</span>}
            </span>
          )}
          <span className={`issue-state issue-state--${issue.state}`}>
            {issue.state === 'opened' ? 'Open' : 'Closed'}
          </span>
          <span className="issue-time">{formatRelativeTime(issue.updatedAt)}</span>
        </div>

        <h4 className="issue-title">
          {highlightQuery ? <HighlightText text={issue.title} query={highlightQuery} /> : issue.title}
        </h4>

        <div className="issue-item-meta">
          <span className="issue-author">
            <UserAvatar
              instanceId={issue.instanceId}
              username={issue.authorUsername}
              size={18}
              className="issue-author-avatar"
            />
            {issue.authorUsername}
          </span>
          {assignees.length > 0 && (
            <span className="issue-assignees">
              <span className="issue-assignees-label">assigned:</span>
              {assignees.slice(0, 3).map((u) => (
                <UserAvatar
                  key={u}
                  instanceId={issue.instanceId}
                  username={u}
                  size={16}
                  className="issue-assignee-avatar"
                />
              ))}
              {assignees.length > 3 && (
                <span className="issue-assignee-more">+{assignees.length - 3}</span>
              )}
            </span>
          )}
          {issue.assignedToMe && (
            <span className="issue-assigned-me">assigned to you</span>
          )}
        </div>

        {labels.length > 0 && (
          <div className="issue-item-footer">
            <span className="issue-labels">
              {labels.slice(0, 4).map((label) => (
                <span key={label} className="issue-label">
                  {label}
                </span>
              ))}
              {labels.length > 4 && (
                <span className="issue-label-more">+{labels.length - 4}</span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

export default IssueListItem;
