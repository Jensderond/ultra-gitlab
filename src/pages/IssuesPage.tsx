/**
 * Issues dashboard page.
 *
 * Shows GitLab issues either filtered to a single project or interleaved
 * ("My issues"/"All" views) so the user can triage issues assigned to them
 * across every project in one place. Supports starring individual issues
 * and starring/renaming the projects those issues belong to.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useInstancesQuery } from '../hooks/queries/useInstancesQuery';
import { InstanceSwitcher } from '../components/InstanceSwitcher';
import { ShortcutBar } from '../components/ShortcutBar';
import type { ShortcutDef } from '../components/ShortcutBar';
import SearchBar from '../components/SearchBar/SearchBar';
import { useListSearch } from '../hooks/useListSearch';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { IssueListItem } from '../components/IssueList';
import {
  useIssuesQuery,
  useIssueProjectsQuery,
  type IssueScope,
} from '../hooks/queries/useIssuesQuery';
import { queryKeys } from '../lib/queryKeys';
import {
  syncMyIssues,
  syncProjectIssues,
  toggleIssueStar,
  toggleProjectStar,
  renameProject,
} from '../services/tauri';
import type { IssueProject, IssueWithProject } from '../types';
import './IssuesPage.css';

const listShortcuts: ShortcutDef[] = [
  { key: 'j/k', label: 'navigate' },
  { key: 'Enter', label: 'open in GitLab' },
  { key: 's', label: 'star' },
  { key: '?', label: 'help' },
];

const searchShortcuts: ShortcutDef[] = [
  { key: '\u2191/\u2193', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: 'Esc', label: 'close search' },
];

interface ScopeTab {
  id: IssueScope;
  label: string;
  hint: string;
}

const SCOPE_TABS: ScopeTab[] = [
  { id: 'assigned', label: 'Assigned to me', hint: 'Issues where you are an assignee' },
  { id: 'starred', label: 'Starred', hint: 'Issues you have starred locally' },
  { id: 'all', label: 'All', hint: 'Every cached issue' },
];

function projectDisplayName(p: IssueProject): string {
  if (p.customName && p.customName.trim().length > 0) return p.customName;
  return p.nameWithNamespace || p.name;
}

export default function IssuesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [scope, setScope] = useState<IssueScope>('assigned');
  const [selectedProjectId, setSelectedProjectId] = useState<number | 'all'>('all');
  const [renameTarget, setRenameTarget] = useState<IssueProject | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (instances.length > 0 && selectedInstanceId == null) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  const projectsQuery = useIssueProjectsQuery(selectedInstanceId ?? undefined);
  const projects = projectsQuery.data ?? [];

  const issuesQuery = useIssuesQuery(selectedInstanceId ?? undefined, scope, selectedProjectId);
  const issues = issuesQuery.data ?? [];

  const { query, isSearchOpen, setQuery, closeSearch } = useListSearch({
    items: [] as IssueWithProject[],
    getSearchableText: () => [],
  });

  const filteredIssues = useMemo(() => {
    if (!isSearchOpen || !query?.trim()) return issues;
    const q = query.toLowerCase();
    return issues.filter((i) => {
      const title = i.title?.toLowerCase() ?? '';
      const author = i.authorUsername?.toLowerCase() ?? '';
      const project = (i.projectCustomName ?? i.projectNameWithNamespace ?? '').toLowerCase();
      return title.includes(q) || author.includes(q) || project.includes(q);
    });
  }, [issues, query, isSearchOpen]);

  const filteredIssuesRef = useRef(filteredIssues);
  filteredIssuesRef.current = filteredIssues;

  const openInGitLab = useCallback((index: number) => {
    const issue = filteredIssuesRef.current[index];
    if (issue) {
      window.open(issue.webUrl, '_blank', 'noopener');
    }
  }, []);

  const { focusIndex, setFocusIndex, moveNext, movePrev, selectFocused } = useKeyboardNav({
    itemCount: filteredIssues.length,
    onSelect: openInGitLab,
    enabled: filteredIssues.length > 0,
  });

  useEffect(() => {
    if (isSearchOpen) setFocusIndex(0);
  }, [query, isSearchOpen, setFocusIndex]);

  // 's' toggles star on the focused row
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const issue = filteredIssuesRef.current[focusIndex];
        if (!issue || selectedInstanceId == null) return;
        e.preventDefault();
        toggleIssueStar(selectedInstanceId, issue.id)
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: ['issues', String(selectedInstanceId)],
            }),
          )
          .catch(console.error);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusIndex, selectedInstanceId, queryClient]);

  const invalidateIssues = useCallback(() => {
    if (selectedInstanceId == null) return;
    queryClient.invalidateQueries({ queryKey: ['issues', String(selectedInstanceId)] });
    queryClient.invalidateQueries({ queryKey: queryKeys.issueProjects(String(selectedInstanceId)) });
  }, [queryClient, selectedInstanceId]);

  const handleSync = useCallback(async () => {
    if (selectedInstanceId == null) return;
    setSyncing(true);
    try {
      if (selectedProjectId === 'all') {
        await syncMyIssues(selectedInstanceId);
      } else {
        await syncProjectIssues(selectedInstanceId, selectedProjectId);
      }
      invalidateIssues();
    } catch (err) {
      console.error('Issue sync failed', err);
    } finally {
      setSyncing(false);
    }
  }, [invalidateIssues, selectedInstanceId, selectedProjectId]);

  const handleStarIssue = useCallback(
    (issueId: number) => {
      if (selectedInstanceId == null) return;
      toggleIssueStar(selectedInstanceId, issueId).then(invalidateIssues).catch(console.error);
    },
    [invalidateIssues, selectedInstanceId],
  );

  const handleStarProject = useCallback(
    (projectId: number) => {
      if (selectedInstanceId == null) return;
      toggleProjectStar(selectedInstanceId, projectId).then(invalidateIssues).catch(console.error);
    },
    [invalidateIssues, selectedInstanceId],
  );

  const openRename = useCallback((p: IssueProject) => {
    setRenameTarget(p);
    setRenameValue(p.customName ?? '');
  }, []);

  const closeRename = useCallback(() => {
    setRenameTarget(null);
    setRenameValue('');
  }, []);

  const submitRename = useCallback(async () => {
    if (!renameTarget || selectedInstanceId == null) return;
    const trimmed = renameValue.trim();
    await renameProject(selectedInstanceId, renameTarget.id, trimmed.length === 0 ? null : trimmed);
    closeRename();
    invalidateIssues();
  }, [renameTarget, renameValue, selectedInstanceId, closeRename, invalidateIssues]);

  const starredProjects = useMemo(() => projects.filter((p) => p.starred), [projects]);
  const otherProjects = useMemo(() => projects.filter((p) => !p.starred), [projects]);

  if (instancesQuery.isLoading) {
    return (
      <div className="issues-page">
        <div className="issues-page-loading">Loading\u2026</div>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="issues-page">
        <div className="issues-page-empty">
          <h2>No GitLab Instances Configured</h2>
          <p>Add a GitLab instance in Settings to start viewing issues.</p>
          <button onClick={() => navigate('/settings')} className="primary-button">
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="issues-page">
      <header className="issues-page-header">
        <div className="header-title-group">
          <h1>Issues</h1>
          <button
            className="refresh-button"
            onClick={handleSync}
            aria-label="Sync issues from GitLab"
            disabled={syncing}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
        <div className="header-actions">
          <InstanceSwitcher
            instances={instances}
            selectedId={selectedInstanceId}
            onSelect={setSelectedInstanceId}
          />
        </div>
      </header>

      <div className="issues-page-body">
        <aside className="issues-sidebar">
          <nav className="issues-scope-nav" aria-label="Issue scope">
            {SCOPE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`issues-scope-tab${scope === tab.id ? ' active' : ''}`}
                onClick={() => setScope(tab.id)}
                title={tab.hint}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="issues-project-section">
            <div className="issues-project-section-header">Projects</div>
            <button
              type="button"
              className={`issues-project-item${selectedProjectId === 'all' ? ' active' : ''}`}
              onClick={() => setSelectedProjectId('all')}
            >
              <span className="issues-project-name">All projects</span>
              <span className="issues-project-count">{issues.length}</span>
            </button>

            {starredProjects.length > 0 && (
              <>
                <div className="issues-project-subheader">Starred</div>
                {starredProjects.map((p) => (
                  <ProjectRow
                    key={`s-${p.id}`}
                    project={p}
                    active={selectedProjectId === p.id}
                    onSelect={() => setSelectedProjectId(p.id)}
                    onToggleStar={() => handleStarProject(p.id)}
                    onRename={() => openRename(p)}
                  />
                ))}
              </>
            )}

            {otherProjects.length > 0 && (
              <>
                <div className="issues-project-subheader">More</div>
                {otherProjects.map((p) => (
                  <ProjectRow
                    key={`o-${p.id}`}
                    project={p}
                    active={selectedProjectId === p.id}
                    onSelect={() => setSelectedProjectId(p.id)}
                    onToggleStar={() => handleStarProject(p.id)}
                    onRename={() => openRename(p)}
                  />
                ))}
              </>
            )}
          </div>
        </aside>

        <main className="issues-main">
          {isSearchOpen && (
            <SearchBar
              query={query}
              onQueryChange={setQuery}
              onClose={closeSearch}
              filteredCount={filteredIssues.length}
              totalCount={issues.length}
              onArrowDown={moveNext}
              onArrowUp={movePrev}
              onSubmit={selectFocused}
            />
          )}

          {issuesQuery.isLoading ? (
            <div className="issues-main-loading">Loading issues\u2026</div>
          ) : issues.length === 0 ? (
            <div className="issues-main-empty">
              <p>
                {scope === 'assigned'
                  ? 'No open issues assigned to you.'
                  : scope === 'starred'
                    ? 'No starred issues yet.'
                    : 'No issues cached for this scope.'}
              </p>
              <button type="button" className="primary-button" onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing\u2026' : 'Sync from GitLab'}
              </button>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="issues-main-empty">
              <p>No issues match your search.</p>
            </div>
          ) : (
            <div className="issues-list">
              {filteredIssues.map((issue, index) => (
                <IssueListItem
                  key={issue.id}
                  issue={issue}
                  selected={index === focusIndex}
                  onClick={() => window.open(issue.webUrl, '_blank', 'noopener')}
                  onToggleStar={() => handleStarIssue(issue.id)}
                  highlightQuery={isSearchOpen ? query : undefined}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <footer className="issues-page-footer">
        <ShortcutBar shortcuts={isSearchOpen ? searchShortcuts : listShortcuts} variant="list" />
      </footer>

      {renameTarget && (
        <RenameProjectDialog
          project={renameTarget}
          value={renameValue}
          onChange={setRenameValue}
          onCancel={closeRename}
          onSubmit={submitRename}
        />
      )}
    </div>
  );
}

interface ProjectRowProps {
  project: IssueProject;
  active: boolean;
  onSelect: () => void;
  onToggleStar: () => void;
  onRename: () => void;
}

function ProjectRow({ project, active, onSelect, onToggleStar, onRename }: ProjectRowProps) {
  const display = projectDisplayName(project);
  const original = project.nameWithNamespace || project.pathWithNamespace || project.name;
  const isRenamed =
    project.customName != null && project.customName.trim().length > 0 && display !== original;

  return (
    <div
      className={`issues-project-item${active ? ' active' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
      title={isRenamed ? `Original name: ${original}` : original}
    >
      <button
        type="button"
        className={`issues-project-star${project.starred ? ' is-starred' : ''}`}
        aria-label={project.starred ? 'Unstar project' : 'Star project'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill={project.starred ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>
      <span className="issues-project-name">
        {display}
        {isRenamed && <span className="issues-project-rename-badge" aria-hidden>*</span>}
      </span>
      <button
        type="button"
        className="issues-project-rename"
        aria-label="Rename project"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        title="Rename project"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
    </div>
  );
}

interface RenameProjectDialogProps {
  project: IssueProject;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function RenameProjectDialog({
  project,
  value,
  onChange,
  onCancel,
  onSubmit,
}: RenameProjectDialogProps) {
  const original = project.nameWithNamespace || project.pathWithNamespace || project.name;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="issues-rename-overlay" onClick={onCancel}>
      <div
        className="issues-rename-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Rename project"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Rename project</h3>
        <p className="issues-rename-original">
          Original: <code>{original}</code>
        </p>
        <p className="issues-rename-hint">
          Set a personal display name for this project. The original name stays intact and is
          shown on hover. Leave empty to clear.
        </p>
        <input
          ref={inputRef}
          type="text"
          className="issues-rename-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={project.name}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="issues-rename-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={onSubmit}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
