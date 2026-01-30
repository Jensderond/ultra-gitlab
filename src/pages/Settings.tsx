/**
 * Settings page component.
 *
 * Displays GitLab instance management and application settings.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import InstanceSetup from '../components/InstanceSetup/InstanceSetup';
import {
  listInstances,
  removeInstance,
  type GitLabInstanceWithStatus,
} from '../services/gitlab';
import { formatRelativeTime } from '../services/storage';
import './Settings.css';

/**
 * Settings page for managing GitLab instances.
 */
export default function Settings() {
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // Load instances on mount
  useEffect(() => {
    loadInstances();
  }, []);

  async function loadInstances() {
    try {
      setLoading(true);
      setError(null);
      const result = await listInstances();
      setInstances(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(instanceId: number) {
    try {
      await removeInstance(instanceId);
      await loadInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete instance');
    }
  }

  function handleSetupComplete() {
    setShowSetup(false);
    loadInstances();
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/mrs" className="back-link">
          ← Back to MRs
        </Link>
        <h1>Settings</h1>
      </header>

      <main className="settings-content">
        <section className="settings-section">
          <div className="section-header">
            <h2>GitLab Instances</h2>
            <button
              className="add-button"
              onClick={() => setShowSetup(true)}
              disabled={showSetup}
            >
              + Add Instance
            </button>
          </div>

          {error && <div className="error-message">{error}</div>}

          {showSetup && (
            <InstanceSetup
              onComplete={handleSetupComplete}
              onCancel={() => setShowSetup(false)}
            />
          )}

          {loading ? (
            <p className="loading">Loading instances...</p>
          ) : instances.length === 0 ? (
            <p className="empty-state">
              No GitLab instances configured.
              <br />
              Add one to start reviewing merge requests.
            </p>
          ) : (
            <ul className="instance-list">
              {instances.map((inst) => (
                <li key={inst.id} className="instance-item">
                  <div className="instance-info">
                    <span className="instance-name">
                      {inst.name || inst.url}
                    </span>
                    <span className="instance-url">{inst.url}</span>
                    <span className="instance-meta">
                      Added {formatRelativeTime(inst.createdAt)}
                      {!inst.hasToken && (
                        <span className="token-warning"> • Token missing</span>
                      )}
                    </span>
                  </div>
                  <button
                    className="delete-button"
                    onClick={() => handleDelete(inst.id)}
                    title="Remove instance"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-section">
          <h2>Sync Settings</h2>
          <p className="coming-soon">
            Sync interval and other settings will be available in a future update.
          </p>
        </section>

        <section className="settings-section">
          <h2>Keyboard Shortcuts</h2>
          <p className="coming-soon">
            Keyboard shortcut customization will be available in a future update.
          </p>
        </section>
      </main>
    </div>
  );
}
