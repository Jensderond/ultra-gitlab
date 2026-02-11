/**
 * Pipelines dashboard page.
 *
 * Displays pipeline status for tracked GitLab projects.
 */

import './PipelinesPage.css';

export default function PipelinesPage() {
  return (
    <div className="pipelines-page">
      <div className="pipelines-header">
        <h1>Pipelines</h1>
      </div>
      <div className="pipelines-empty">
        <p>No projects tracked yet.</p>
        <p className="pipelines-empty-hint">Use the search above to add projects to your dashboard.</p>
      </div>
    </div>
  );
}
