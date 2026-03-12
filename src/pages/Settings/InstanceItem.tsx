import { useState } from 'react';
import { formatRelativeTime } from '../../services/storage';
import { updateInstanceToken, updateSessionCookie, refreshAvatars } from '../../services/tauri';
import { clearAvatarCache } from '../../components/UserAvatar/UserAvatar';
import type { TokenInfo } from '../../types';
import type { GitLabInstanceWithStatus } from '../../services/gitlab';

interface InstanceItemProps {
  inst: GitLabInstanceWithStatus;
  tokenInfo: TokenInfo | 'error' | undefined;
  onDelete: (id: number) => void;
  onTokenUpdated: () => void;
  onSetDefault: (id: number) => void;
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
 * Single instance card in the settings page.
 */
export default function InstanceItem({ inst, tokenInfo, onDelete, onTokenUpdated, onSetDefault }: InstanceItemProps) {
  const [editing, setEditing] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Cookie state
  const [editingCookie, setEditingCookie] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [cookieSaving, setCookieSaving] = useState(false);
  const [cookieError, setCookieError] = useState<string | null>(null);
  const [cookieSuccess, setCookieSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  function startCookieEdit() {
    setEditingCookie(true);
    setCookieInput('');
    setCookieError(null);
    setCookieSuccess(null);
  }

  function cancelCookieEdit() {
    setEditingCookie(false);
    setCookieInput('');
    setCookieError(null);
    setCookieSuccess(null);
  }

  async function handleCookieSave() {
    if (!cookieInput.trim()) return;
    try {
      setCookieSaving(true);
      setCookieError(null);
      await updateSessionCookie(inst.id, cookieInput.trim());
      setCookieSuccess('Session cookie saved');
      setCookieInput('');
      setTimeout(() => {
        cancelCookieEdit();
        onTokenUpdated();
      }, 1500);
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : 'Failed to save cookie');
    } finally {
      setCookieSaving(false);
    }
  }

  async function handleClearCookie() {
    try {
      setCookieSaving(true);
      await updateSessionCookie(inst.id, null);
      setCookieSuccess('Cookie cleared');
      onTokenUpdated();
      setTimeout(() => setCookieSuccess(null), 1500);
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : 'Failed to clear cookie');
    } finally {
      setCookieSaving(false);
    }
  }

  async function handleRefreshAvatars() {
    try {
      setRefreshing(true);
      setCookieError(null);
      const count = await refreshAvatars(inst.id);
      clearAvatarCache();
      setCookieSuccess(`Downloaded ${count} avatar${count === 1 ? '' : 's'}`);
      setTimeout(() => setCookieSuccess(null), 3000);
    } catch (err) {
      setCookieError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  const hasCookie = !!inst.sessionCookie;

  return (
    <li className={`instance-item${inst.isDefault ? ' instance-item--default' : ''}`}>
      {/* ── Header row: identity + actions ── */}
      <div className="instance-header">
        <div className="instance-identity">
          <span className="instance-name">{inst.name || inst.url}</span>
          {inst.isDefault && (
            <span className="instance-default-badge">Default</span>
          )}
        </div>
        <div className="instance-header-actions">
          {!inst.isDefault && (
            <button
              className="instance-action-btn instance-action-btn--default"
              onClick={() => onSetDefault(inst.id)}
            >
              Set as Default
            </button>
          )}
          <button
            className="instance-action-btn instance-action-btn--delete"
            onClick={() => onDelete(inst.id)}
            title="Remove instance"
          >
            Remove
          </button>
        </div>
      </div>

      {/* ── Meta row: URL + date + token status ── */}
      <div className="instance-meta-row">
        <span className="instance-url">{inst.url}</span>
        <span className="instance-meta-separator" />
        <span className="instance-meta-text">
          Added {formatRelativeTime(inst.createdAt)}
        </span>
        {!inst.hasToken && (
          <span className="instance-status-pill instance-status-pill--warn">Token missing</span>
        )}
        {tokenInfo && tokenInfo !== 'error' && (() => {
          const { text, daysLeft } = formatExpiration(tokenInfo);
          return (
            <>
              <span className="instance-meta-separator" />
              <span className="instance-meta-text">{text}</span>
              {daysLeft !== null && daysLeft < 0 && (
                <span className="instance-status-pill instance-status-pill--error">Expired</span>
              )}
              {daysLeft !== null && daysLeft >= 0 && daysLeft < 30 && (
                <span className="instance-status-pill instance-status-pill--warn">Expiring soon</span>
              )}
            </>
          );
        })()}
      </div>

      {/* ── Inline actions row ── */}
      <div className="instance-controls">
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

        {editingCookie ? (
          <div className="edit-token-form">
            <textarea
              className="edit-token-input session-cookie-input"
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelCookieEdit();
              }}
              placeholder="Paste _gitlab_session cookie value..."
              disabled={cookieSaving}
              rows={2}
              autoFocus
            />
            <div className="edit-token-actions">
              <button
                className="edit-token-save"
                onClick={handleCookieSave}
                disabled={cookieSaving || !cookieInput.trim()}
              >
                {cookieSaving ? 'Saving...' : 'Save'}
              </button>
              {hasCookie && (
                <button
                  className="edit-token-cancel"
                  onClick={handleClearCookie}
                  disabled={cookieSaving}
                >
                  Clear
                </button>
              )}
              <button
                className="edit-token-cancel"
                onClick={cancelCookieEdit}
                disabled={cookieSaving}
              >
                Cancel
              </button>
            </div>
            <span className="session-cookie-hint">
              Cookie expires with your browser session. Re-paste after logging in again.
            </span>
            {cookieError && <span className="edit-token-error">{cookieError}</span>}
            {cookieSuccess && <span className="edit-token-success">{cookieSuccess}</span>}
          </div>
        ) : (
          <>
            <button className="edit-token-button" onClick={startCookieEdit}>
              {hasCookie ? 'Update Cookie' : 'Set Session Cookie'}
            </button>
            {hasCookie && (
              <button
                className="edit-token-button"
                onClick={handleRefreshAvatars}
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Refresh Avatars'}
              </button>
            )}
          </>
        )}
        {!editingCookie && cookieError && <span className="edit-token-error">{cookieError}</span>}
        {!editingCookie && cookieSuccess && <span className="edit-token-success">{cookieSuccess}</span>}
      </div>
    </li>
  );
}
