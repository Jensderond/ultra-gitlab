/**
 * Pipelines dashboard page.
 *
 * Displays pipeline status for tracked GitLab projects in a responsive card grid.
 * Pinned projects appear first, then recent projects sorted by last visited.
 */

import { useNavigate } from 'react-router-dom';
import usePipelinesData from './usePipelinesData';
import ProjectSearch from './ProjectSearch';
import ProjectCard from './ProjectCard';
import PinnedGrid from './PinnedGrid';
import { InstanceSwitcher } from '../../components/InstanceSwitcher';
import { formatRelativeTime } from './utils';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { PullToRefreshIndicator, SyncProgressBar } from '../../components/PullToRefresh';
import '../PipelinesPage.css';

export default function PipelinesPage() {
  const navigate = useNavigate();

  const {
    instances,
    selectedInstanceId,
    projects,
    statuses,
    loading,
    statusesLoading,
    lastFetched,
    handleSelectResult,
    handleTogglePin,
    handleRemoveProject,
    handleReorderPinned,
    handleOpenDetail,
    handleSelectInstance,
    handleRefresh,
  } = usePipelinesData();

  const { containerRef: pullRef, pullDistance, refreshing } = usePullToRefresh<HTMLElement>({
    onRefresh: handleRefresh,
  });
  const isSmallScreen = useSmallScreen();

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
          {!isSmallScreen && (
            <button
              className="page-header-refresh"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh pipelines"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
          )}
          {lastFetched && (
            <span className="pipelines-freshness">
              updated {formatRelativeTime(lastFetched.toISOString())}
            </span>
          )}
        </div>
        <InstanceSwitcher
          instances={instances}
          selectedId={selectedInstanceId}
          onSelect={handleSelectInstance}
        />
      </header>

      {refreshing && <SyncProgressBar />}

      <ProjectSearch
        selectedInstanceId={selectedInstanceId}
        onSelectResult={handleSelectResult}
      />

      <main className="pipelines-content" ref={pullRef} data-tour="pipelines">
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
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
                <PinnedGrid
                  projects={pinnedProjects}
                  statuses={statuses}
                  statusesLoading={statusesLoading}
                  onTogglePin={handleTogglePin}
                  onRemove={handleRemoveProject}
                  onOpenDetail={handleOpenDetail}
                  onReorder={handleReorderPinned}
                />
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
                      onOpenDetail={handleOpenDetail}
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
