import { useState } from 'react';
import { formatRelativeTime } from '../../services/storage';
import { updateInstanceToken } from '../../services/tauri';
import type { TokenInfo } from '../../types';
import type { GitLabInstanceWithStatus } from '../../services/gitlab';

interface InstanceItemProps {
  inst: GitLabInstanceWithStatus;
  tokenInfo: TokenInfo | 'error' | undefined;
  onDelete: (id: number) => void;
  onTokenUpdated: () => void;
}

function formatExpiration(info: TokenInfo): { text: string; daysLeft: number | null } {
  if (!info.expiresAt) return { text: 'No expiration', daysLeft: null };
  const expires = new Date(info.expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const formatted = expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (daysLeft < 0) {
    return { text: `Expired ${formatted}`, daysLeft };
  }
  return { text: `Expires ${formatted} — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, daysLeft };
}

/**
 * Single instance row with token editing inline.
 */
export default function InstanceItem({ inst, tokenInfo, onDelete, onTokenUpdated }: InstanceItemProps) {
  const [editing, setEditing] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function startEdit() {
    setEditing(true);
    setTokenInput('');
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditing(false);
    setTokenInput('');
    setError(null);
    setSuccess(null);
  }

  async function handleSave() {
    if (!tokenInput.trim()) return;
    try {
      setSaving(true);
      setError(null);
      const username = await updateInstanceToken(inst.id, tokenInput.trim());
      setSuccess(`Token updated (${username})`);
      setTokenInput('');
      setTimeout(() => {
        cancelEdit();
        onTokenUpdated();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid token');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="instance-item">
      <div className="instance-info">
        <span className="instance-name">{inst.name || inst.url}</span>
        <span className="instance-url">{inst.url}</span>
        <span className="instance-meta">
          Added {formatRelativeTime(inst.createdAt)}
          {!inst.hasToken && (
            <span className="token-warning"> • Token missing</span>
          )}
        </span>
        {tokenInfo && tokenInfo !== 'error' && (() => {
          const { text, daysLeft } = formatExpiration(tokenInfo);
          return (
            <span className="instance-expiration">
              {text}
              {daysLeft !== null && daysLeft < 0 && (
                <span className="token-badge token-badge-expired">Expired</span>
              )}
              {daysLeft !== null && daysLeft >= 0 && daysLeft < 30 && (
                <span className="token-badge token-badge-warning">Expiring soon</span>
              )}
            </span>
          );
        })()}
        {editing ? (
          <div className="edit-token-form">
            <input
              type="password"
              className="edit-token-input"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') cancelEdit();
              }}
              placeholder="glpat-..."
              disabled={saving}
              // autoFocus: user just clicked "Edit Token" — focus the input immediately
              autoFocus
            />
            <div className="edit-token-actions">
              <button
                className="edit-token-save"
                onClick={handleSave}
                disabled={saving || !tokenInput.trim()}
              >
                {saving ? 'Validating...' : 'Save'}
              </button>
              <button
                className="edit-token-cancel"
                onClick={cancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
            {error && <span className="edit-token-error">{error}</span>}
            {success && <span className="edit-token-success">{success}</span>}
          </div>
        ) : (
          <button className="edit-token-button" onClick={startEdit}>
            Edit Token
          </button>
        )}
      </div>
      <button
        className="delete-button"
        onClick={() => onDelete(inst.id)}
        title="Remove instance"
      >
        ×
      </button>
    </li>
  );
}
