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
import { formatRelativeTime } from './utils';
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
    handleOpenDetail,
    handleSelectInstance,
  } = usePipelinesData();

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
            onChange={(e) => handleSelectInstance(Number(e.target.value))}
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

      <ProjectSearch
        selectedInstanceId={selectedInstanceId}
        onSelectResult={handleSelectResult}
      />

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
                      onOpenDetail={handleOpenDetail}
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
