/**
 * Single issue row. Mirrors MRListItem visually so the Issues section
 * feels like a first-class citizen of the app.
 */

import { forwardRef, useMemo } from 'react';
import type { IssueWithProject } from '../../types';
import UserAvatar from '../UserAvatar/UserAvatar';
import HighlightText from '../HighlightText/HighlightText';
import { StarIcon } from '../icons';
import { splitProjectName } from '../../lib/projectName';
import './IssueListItem.css';

/**
 * Root group hidden from the label outright rather than just dimmed — the one
 * local convention here. Every other group still shows, so an instance that
 * doesn't use this layout loses nothing.
 */
const HIDDEN_ROOT_GROUP = /^customers$/i;

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

  // The leading group is shared by nearly every project, so a filter never
  // matches it (see lib/projectName). It's still shown — dimmed, so the row
  // reads as "this part isn't what you searched" — unless it's the one root
  // group that's on literally every row.
  const { namespace, rest: projectLabel } = splitProjectName(
    issue.projectCustomName && issue.projectCustomName.trim().length > 0
      ? issue.projectCustomName
      : issue.projectNameWithNamespace,
  );
  const projectNamespace = HIDDEN_ROOT_GROUP.test(namespace) ? '' : namespace;

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
        <StarIcon filled={issue.starred} size={16} />
      </button>

      <div className="issue-item-body">
        <div className="issue-item-header">
          {issue.starred && (
            <span className="issue-star-inline" aria-label="Starred">
              <StarIcon filled size={12} />
            </span>
          )}
          <span className="issue-iid">#{issue.iid}</span>
          {projectLabel && (
            <span className="issue-project" title={projectTooltip}>
              {projectNamespace && (
                <span className="issue-project-namespace">{projectNamespace} / </span>
              )}
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
