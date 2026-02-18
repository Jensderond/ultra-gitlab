/**
 * GitLab instance setup form component.
 *
 * Handles adding a new GitLab instance with URL and token validation.
 */

import { useReducer } from 'react';
import { addGitLabInstance } from '../../services/gitlab';
import './InstanceSetup.css';

interface InstanceSetupProps {
  /** Callback when setup is complete */
  onComplete: () => void;
  /** Callback when setup is cancelled */
  onCancel: () => void;
}

interface SetupState {
  url: string;
  token: string;
  name: string;
  loading: boolean;
  error: string | null;
  success: string | null;
}

type SetupAction =
  | { type: 'SET_FIELD'; field: 'url' | 'token' | 'name'; value: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_SUCCESS'; message: string }
  | { type: 'SUBMIT_ERROR'; error: string }
  | { type: 'SUBMIT_END' };

function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SUBMIT_START':
      return { ...state, loading: true, error: null };
    case 'SUBMIT_SUCCESS':
      return { ...state, success: action.message };
    case 'SUBMIT_ERROR':
      return { ...state, error: action.error };
    case 'SUBMIT_END':
      return { ...state, loading: false };
  }
}

/**
 * Form for adding a new GitLab instance.
 */
export default function InstanceSetup({ onComplete, onCancel }: InstanceSetupProps) {
  const [state, dispatch] = useReducer(setupReducer, {
    url: '',
    token: '',
    name: '',
    loading: false,
    error: null,
    success: null,
  });

  const { url, token, name, loading, error, success } = state;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!url.trim()) {
      dispatch({ type: 'SUBMIT_ERROR', error: 'URL is required' });
      return;
    }
    if (!token.trim()) {
      dispatch({ type: 'SUBMIT_ERROR', error: 'Personal Access Token is required' });
      return;
    }

    try {
      dispatch({ type: 'SUBMIT_START' });

      const result = await addGitLabInstance({
        url: url.trim(),
        token: token.trim(),
        name: name.trim() || undefined,
      });

      dispatch({ type: 'SUBMIT_SUCCESS', message: `Successfully connected as ${result.username}` });

      // Brief delay to show success message
      setTimeout(() => {
        onComplete();
      }, 1000);
    } catch (err) {
      dispatch({ type: 'SUBMIT_ERROR', error: err instanceof Error ? err.message : 'Failed to add instance' });
    } finally {
      dispatch({ type: 'SUBMIT_END' });
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
            onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'url', value: e.target.value })}
            disabled={loading}
            autoFocus // autoFocus: user-initiated form (clicked "Add Instance") — focus first field
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
            onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'token', value: e.target.value })}
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
            onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
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
