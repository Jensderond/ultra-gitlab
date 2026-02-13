/**
 * Pipelines dashboard page.
 *
 * Displays pipeline status for tracked GitLab projects in a responsive card grid.
 * Pinned projects appear first, then recent projects sorted by last visited.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listInstances, type GitLabInstanceWithStatus } from '../services/gitlab';
import {
  listPipelineProjects,
  getPipelineStatuses,
  searchProjects,
  visitPipelineProject,
  togglePinPipelineProject,
  removePipelineProject,
} from '../services/tauri';
import type { PipelineProject, PipelineStatus, ProjectSearchResult } from '../types';
import './PipelinesPage.css';

type PipelineStatusName = PipelineStatus['status'];

/**
 * Format an ISO 8601 date string as a relative time string.
 */
function formatRelativeTime(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString();
}

/**
 * Human-readable status label.
 */
function statusLabel(status: PipelineStatusName): string {
  switch (status) {
    case 'success': return 'passed';
    case 'failed': return 'failed';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'canceled': return 'canceled';
    case 'skipped': return 'skipped';
  }
}

/**
 * Format pipeline duration in human-readable form.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

// SVG icon components
function PinIcon({ filled }: { filled: boolean }) {
  if (filled) {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4A.5.5 0 0 1 3 9.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z"/>
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5a.5.5 0 0 1-1 0V10h-4A.5.5 0 0 1 3 9.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354zm1.853 1.853L6 6.96a.5.5 0 0 1-.243.412 4.93 4.93 0 0 0-.606.436C4.648 8.251 4.199 8.836 4.069 9.5H8v4l.5.5.5-.5V9.5h3.931c-.13-.664-.579-1.249-1.082-1.692a4.93 4.93 0 0 0-.606-.436A.5.5 0 0 1 11 6.96l.001-4.96A1.28 1.28 0 0 0 11.354 2H5.646a1.28 1.28 0 0 0 .353 0z"/>
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.5">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
      <path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity="0.6">
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25z"/>
    </svg>
  );
}

export default function PipelinesPage() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [statuses, setStatuses] = useState<Map<number, PipelineStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProjectSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const firstLoadDoneRef = useRef(false);

  /**
   * Compare old and new pipeline statuses for pinned projects and emit
   * window custom events for any status changes detected.
   * Skips first load (when there are no previous statuses).
   */
  const emitPipelineChanges = useCallback(
    (newStatusMap: Map<number, PipelineStatus>) => {
      if (!firstLoadDoneRef.current) {
        firstLoadDoneRef.current = true;
        return;
      }

      const oldStatuses = statusesRef.current;
      const currentProjects = projectsRef.current;
      const pinnedIds = new Set(
        currentProjects.filter((p) => p.pinned).map((p) => p.projectId)
      );

      for (const [projectId, newStatus] of newStatusMap) {
        if (!pinnedIds.has(projectId)) continue;
        const oldStatus = oldStatuses.get(projectId);
        if (!oldStatus) continue; // no previous status to compare
        if (oldStatus.status === newStatus.status) continue;

        const project = currentProjects.find((p) => p.projectId === projectId);
        window.dispatchEvent(
          new CustomEvent('notification:pipeline-changed', {
            detail: {
              projectName: project?.nameWithNamespace ?? `Project ${projectId}`,
              oldStatus: oldStatus.status,
              newStatus: newStatus.status,
              refName: newStatus.refName,
              webUrl: newStatus.webUrl,
            },
          })
        );
      }
    },
    []
  );

  // Load instances
  useEffect(() => {
    async function loadInstances() {
      try {
        const data = await listInstances();
        setInstances(data);
        if (data.length > 0 && !selectedInstanceId) {
          setSelectedInstanceId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to load instances:', error);
      }
    }
    loadInstances();
  }, [selectedInstanceId]);

  // Load projects and their pipeline statuses
  const loadProjects = useCallback(async () => {
    if (!selectedInstanceId) return;
    try {
      setLoading(true);
      const projectList = await listPipelineProjects(selectedInstanceId);
      setProjects(projectList);

      // Fetch statuses for all projects
      const projectIds = projectList.map((p) => p.projectId);
      if (projectIds.length > 0) {
        setStatusesLoading(true);
        const statusList = await getPipelineStatuses(selectedInstanceId, projectIds);
        const statusMap = new Map(statusList.map((s) => [s.projectId, s]));
        emitPipelineChanges(statusMap);
        setStatuses(statusMap);
        setLastFetched(new Date());
        setStatusesLoading(false);
      }
    } catch (error) {
      console.error('Failed to load pipeline projects:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedInstanceId, emitPipelineChanges]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Refresh only pipeline statuses (used by polling)
  const refreshStatuses = useCallback(async () => {
    if (!selectedInstanceId || projects.length === 0) return;
    try {
      const projectIds = projects.map((p) => p.projectId);
      const statusList = await getPipelineStatuses(selectedInstanceId, projectIds);
      const statusMap = new Map(statusList.map((s) => [s.projectId, s]));
      emitPipelineChanges(statusMap);
      setStatuses(statusMap);
      setLastFetched(new Date());
    } catch (error) {
      console.error('Failed to refresh pipeline statuses:', error);
    }
  }, [selectedInstanceId, projects, emitPipelineChanges]);

  // Auto-refresh polling with adaptive interval
  useEffect(() => {
    if (!selectedInstanceId || projects.length === 0) return;

    function getInterval() {
      const hasActive = Array.from(statusesRef.current.values()).some(
        (s) => s.status === 'running' || s.status === 'pending'
      );
      return hasActive ? 30_000 : 120_000;
    }

    function scheduleNextPoll() {
      pollTimerRef.current = setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          await refreshStatuses();
        }
        scheduleNextPoll();
      }, getInterval());
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        refreshStatuses().then(scheduleNextPoll);
      } else {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      }
    }

    scheduleNextPoll();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedInstanceId, projects, refreshStatuses]);

  // Search: debounced call to searchProjects
  useEffect(() => {
    if (!searchQuery.trim() || !selectedInstanceId) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    // Debounce the API-backed search at 300ms
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchProjects(selectedInstanceId, searchQuery.trim());
        setSearchResults(results);
      } catch (error) {
        console.error('Search failed:', error);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, selectedInstanceId]);

  // `/` keyboard shortcut to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside to close search dropdown
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Handle selecting a search result
  const handleSelectResult = useCallback(
    async (result: ProjectSearchResult) => {
      if (!selectedInstanceId) return;
      try {
        await visitPipelineProject(selectedInstanceId, result.id);
        setSearchQuery('');
        setSearchResults([]);
        setSearchOpen(false);
        // Reload the dashboard to show the newly added project
        loadProjects();
      } catch (error) {
        console.error('Failed to add project:', error);
      }
    },
    [selectedInstanceId, loadProjects]
  );

  // Handle pin/unpin toggle
  const handleTogglePin = useCallback(
    async (projectId: number) => {
      if (!selectedInstanceId) return;
      try {
        await togglePinPipelineProject(selectedInstanceId, projectId);
        // Reload to get updated sort order
        const projectList = await listPipelineProjects(selectedInstanceId);
        setProjects(projectList);
      } catch (error) {
        console.error('Failed to toggle pin:', error);
      }
    },
    [selectedInstanceId]
  );

  // Handle remove project from dashboard
  const handleRemoveProject = useCallback(
    async (projectId: number) => {
      if (!selectedInstanceId) return;
      try {
        await removePipelineProject(selectedInstanceId, projectId);
        setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
      } catch (error) {
        console.error('Failed to remove project:', error);
      }
    },
    [selectedInstanceId]
  );

  if (loading && instances.length === 0) {
    return (
      <div className="pipelines-page">
        <div className="pipelines-loading">Loading...</div>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="pipelines-page">
        <div className="pipelines-empty">
          <h2>No GitLab Instances Configured</h2>
          <p>Add a GitLab instance in Settings to get started.</p>
          <button onClick={() => navigate('/settings')} className="primary-button">
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  const pinnedProjects = projects.filter((p) => p.pinned);
  const recentProjects = projects.filter((p) => !p.pinned);

  return (
    <div className="pipelines-page">
      <header className="pipelines-header">
        <div className="pipelines-header-left">
          <h1>Pipelines</h1>
          {lastFetched && (
            <span className="pipelines-freshness">
              updated {formatRelativeTime(lastFetched.toISOString())}
            </span>
          )}
        </div>
        {instances.length > 1 && (
          <select
            value={selectedInstanceId ?? ''}
            onChange={(e) => setSelectedInstanceId(Number(e.target.value))}
            className="instance-selector"
          >
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name || instance.url}
              </option>
            ))}
          </select>
        )}
      </header>

      <div className="pipelines-search-container" ref={searchContainerRef}>
        <div className="pipelines-search-input-wrapper">
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="text"
            className="pipelines-search-input"
            placeholder="Search projects to add..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => {
              if (searchQuery.trim()) setSearchOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchQuery('');
                setSearchResults([]);
                setSearchOpen(false);
                searchInputRef.current?.blur();
              }
            }}
          />
          {searchLoading && <span className="pipelines-search-spinner" />}
          {!searchQuery && (
            <kbd className="pipelines-search-hint">/</kbd>
          )}
        </div>
        {searchOpen && searchQuery.trim() && (
          <div className="pipelines-search-dropdown">
            {searchResults.length > 0 ? (
              searchResults.map((result) => (
                <button
                  key={result.id}
                  className="pipelines-search-result"
                  onClick={() => handleSelectResult(result)}
                >
                  <span className="pipelines-search-result-name">
                    {result.nameWithNamespace}
                  </span>
                  <span className="pipelines-search-result-path">
                    {result.pathWithNamespace}
                  </span>
                </button>
              ))
            ) : searchLoading ? (
              <div className="pipelines-search-empty">Searching...</div>
            ) : (
              <div className="pipelines-search-empty">No projects found</div>
            )}
          </div>
        )}
      </div>

      <main className="pipelines-content">
        {loading ? (
          <div className="pipelines-loading">Loading pipeline projects...</div>
        ) : projects.length === 0 ? (
          <div className="pipelines-empty">
            <p>No projects tracked yet.</p>
            <p className="pipelines-empty-hint">
              Use the search above to add projects to your dashboard.
            </p>
          </div>
        ) : (
          <div className="pipelines-grid-container">
            {pinnedProjects.length > 0 && (
              <section className="pipelines-section">
                <h2 className="pipelines-section-title">Pinned</h2>
                <div className="pipelines-grid">
                  {pinnedProjects.map((project) => (
                    <ProjectCard
                      key={project.projectId}
                      project={project}
                      status={statuses.get(project.projectId)}
                      statusLoading={statusesLoading}
                      onTogglePin={handleTogglePin}
                      onRemove={handleRemoveProject}
                    />
                  ))}
                </div>
              </section>
            )}
            {recentProjects.length > 0 && (
              <section className="pipelines-section">
                {pinnedProjects.length > 0 && (
                  <h2 className="pipelines-section-title">Recent</h2>
                )}
                <div className="pipelines-grid">
                  {recentProjects.map((project) => (
                    <ProjectCard
                      key={project.projectId}
                      project={project}
                      status={statuses.get(project.projectId)}
                      statusLoading={statusesLoading}
                      onTogglePin={handleTogglePin}
                      onRemove={handleRemoveProject}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectCard
// ---------------------------------------------------------------------------

interface ProjectCardProps {
  project: PipelineProject;
  status?: PipelineStatus;
  statusLoading: boolean;
  onTogglePin: (projectId: number) => void;
  onRemove: (projectId: number) => void;
}

function ProjectCard({ project, status, statusLoading, onTogglePin, onRemove }: ProjectCardProps) {
  const statusName = status?.status;

  return (
    <div className={`pipeline-card ${statusName ? `pipeline-card--${statusName}` : ''}`}>
      <div className="pipeline-card-header">
        <span className="pipeline-card-name" title={project.nameWithNamespace}>
          {project.pinned && (
            <span className="pipeline-card-pin">
              <PinIcon filled />
            </span>
          )}
          {project.nameWithNamespace}
        </span>
        <div className="pipeline-card-actions">
          <button
            className="pipeline-card-action-btn"
            onClick={() => openUrl(`${project.webUrl}/-/pipelines`)}
            title="Open in browser"
          >
            <ExternalLinkIcon />
          </button>
          <button
            className={`pipeline-card-action-btn ${project.pinned ? 'pipeline-card-action-btn--active' : ''}`}
            onClick={() => onTogglePin(project.projectId)}
            title={project.pinned ? 'Unpin project' : 'Pin project'}
          >
            <PinIcon filled={project.pinned} />
          </button>
          <button
            className="pipeline-card-action-btn pipeline-card-action-btn--remove"
            onClick={() => onRemove(project.projectId)}
            title="Remove from dashboard"
          >
            <RemoveIcon />
          </button>
        </div>
      </div>

      <div className="pipeline-card-status-row">
        {statusLoading && !status ? (
          <span className="pipeline-badge pipeline-badge--loading">loading</span>
        ) : status ? (
          <span className={`pipeline-badge pipeline-badge--${statusName}`}>
            {statusName === 'running' && <span className="pipeline-badge-pulse" />}
            {statusLabel(statusName!)}
          </span>
        ) : (
          <span className="pipeline-badge pipeline-badge--none">no pipeline</span>
        )}
        {status?.duration != null && (
          <span className="pipeline-card-duration">{formatDuration(status.duration)}</span>
        )}
      </div>

      {status && (
        <div className="pipeline-card-meta">
          <span className="pipeline-card-ref">
            <BranchIcon />
            {status.refName}
          </span>
          <span className="pipeline-card-sha">{status.sha}</span>
        </div>
      )}

      <div className="pipeline-card-footer">
        {status && (
          <span className="pipeline-card-time">
            {formatRelativeTime(status.createdAt)}
          </span>
        )}
        {project.lastVisitedAt && !status && (
          <span className="pipeline-card-time">
            visited {formatRelativeTime(project.lastVisitedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
