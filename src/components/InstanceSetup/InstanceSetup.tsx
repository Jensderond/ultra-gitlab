/**
 * GitLab instance setup form component.
 *
 * Handles adding a new GitLab instance with URL and token validation.
 */

import { useState } from 'react';
import { addGitLabInstance } from '../../services/gitlab';
import './InstanceSetup.css';

interface InstanceSetupProps {
  /** Callback when setup is complete */
  onComplete: () => void;
  /** Callback when setup is cancelled */
  onCancel: () => void;
}

/**
 * Form for adding a new GitLab instance.
 */
export default function InstanceSetup({ onComplete, onCancel }: InstanceSetupProps) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!url.trim()) {
      setError('URL is required');
      return;
    }
    if (!token.trim()) {
      setError('Personal Access Token is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await addGitLabInstance({
        url: url.trim(),
        token: token.trim(),
        name: name.trim() || undefined,
      });

      setSuccess(`Successfully connected as ${result.username}`);

      // Brief delay to show success message
      setTimeout(() => {
        onComplete();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add instance');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="instance-setup">
      <h3>Add GitLab Instance</h3>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="instance-url">GitLab URL</label>
          <input
            id="instance-url"
            type="text"
            placeholder="https://gitlab.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <span className="form-help">
            The URL of your GitLab instance (e.g., gitlab.com or self-hosted)
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="instance-token">Personal Access Token</label>
          <input
            id="instance-token"
            type="password"
            placeholder="glpat-..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={loading}
          />
          <span className="form-help">
            Create a token with <code>read_api</code> and <code>api</code> scopes
            in GitLab → Settings → Access Tokens
          </span>
        </div>

        <div className="form-group">
          <label htmlFor="instance-name">Display Name (optional)</label>
          <input
            id="instance-name"
            type="text"
            placeholder="Work GitLab"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={loading}
          />
          <span className="form-help">
            A friendly name to identify this instance
          </span>
        </div>

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

        <div className="form-actions">
          <button
            type="button"
            className="cancel-button"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="submit-button"
            disabled={loading}
          >
            {loading ? 'Validating...' : 'Add Instance'}
          </button>
        </div>
      </form>
    </div>
  );
}
