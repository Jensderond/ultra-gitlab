import { useEffect, useMemo, useRef, useState } from 'react';
import UserAvatar from '../../components/UserAvatar/UserAvatar';
import { useAssigneeCandidatesQuery } from './useIssueData';
import type { IssueAssigneeCandidate } from '../../types';

interface Props {
  instanceId: number;
  projectId: number;
  currentUsernames: string[];
  onApply: (assigneeIds: number[]) => void;
  onClose: () => void;
  busy: boolean;
}

export function AssigneePicker({
  instanceId,
  projectId,
  currentUsernames,
  onApply,
  onClose,
  busy,
}: Props) {
  const { data: candidates, isLoading } = useAssigneeCandidatesQuery(
    instanceId,
    projectId,
    true,
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (initializedRef.current || !candidates) return;
    const ids = new Set<number>();
    for (const c of candidates) {
      if (currentUsernames.includes(c.username)) ids.add(c.id);
    }
    setSelected(ids);
    initializedRef.current = true;
  }, [candidates, currentUsernames]);

  const filtered = useMemo(() => {
    const list = candidates ?? [];
    if (!filter.trim()) return list;
    const q = filter.toLowerCase();
    return list.filter(
      (c) => c.username.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [candidates, filter]);

  const toggle = (c: IssueAssigneeCandidate) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.add(c.id);
      return next;
    });
  };

  const handleApply = () => {
    onApply(Array.from(selected));
  };

  const handleClear = () => {
    onApply([]);
  };

  return (
    <div className="issue-assignee-overlay" onClick={onClose}>
      <div
        className="issue-assignee-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Change assignees"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Assignees</h3>
        <input
          ref={inputRef}
          className="issue-assignee-filter"
          type="text"
          placeholder="Filter members…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="issue-assignee-list">
          {isLoading && <div className="issue-assignee-loading">Loading members…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="issue-assignee-empty">No members found</div>
          )}
          {filtered.map((c) => {
            const checked = selected.has(c.id);
            return (
              <label key={c.id} className={`issue-assignee-row${checked ? ' checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c)}
                />
                <UserAvatar instanceId={instanceId} username={c.username} size={24} />
                <div className="issue-assignee-text">
                  <span className="issue-assignee-name">{c.name}</span>
                  <span className="issue-assignee-username">@{c.username}</span>
                </div>
              </label>
            );
          })}
        </div>
        <div className="issue-assignee-actions">
          <button type="button" className="secondary-button" onClick={handleClear} disabled={busy}>
            Clear all
          </button>
          <div className="issue-assignee-actions-right">
            <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleApply} disabled={busy}>
              {busy ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
