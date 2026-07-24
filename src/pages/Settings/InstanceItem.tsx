import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { formatRelativeTime } from '../../services/storage';
import { renameInstance, updateInstanceToken, updateSessionCookie, refreshAvatars } from '../../services/tauri';
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
  if (!info.expiresAt) return { text: 'token never expires', daysLeft: null };
  const expires = new Date(info.expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const formatted = expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (daysLeft < 0) return { text: `token expired ${formatted}`, daysLeft };
  return { text: `token expires ${formatted}`, daysLeft };
}

/**
 * One GitLab instance as a native settings row: identity + status on the
 * left, quiet actions on the right, token/cookie editors expanding below.
 */
export default function InstanceItem({ inst, tokenInfo, onDelete, onTokenUpdated, onSetDefault }: InstanceItemProps) {
  const [editing, setEditing] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingCookie, setEditingCookie] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [cookieSaving, setCookieSaving] = useState(false);
  const [cookieError, setCookieError] = useState<string | null>(null);
  const [cookieSuccess, setCookieSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState('');

  function startRename() { setRenaming(true); setNameInput(inst.name || ''); }
  function cancelRename() { setRenaming(false); setNameInput(''); }

  function handleRename() {
    if (!nameInput.trim()) return;
    setRenaming(false);
    renameInstance(inst.id, nameInput.trim()).then(() => onTokenUpdated());
  }

  function startEdit() { setEditingCookie(false); setEditing(true); setTokenInput(''); setError(null); setSuccess(null); }
  function cancelEdit() { setEditing(false); setTokenInput(''); setError(null); setSuccess(null); }

  async function handleSave() {
    if (!tokenInput.trim()) return;
    try {
      setSaving(true); setError(null);
      const username = await updateInstanceToken(inst.id, tokenInput.trim());
      setSuccess(`Token updated — authenticated as ${username}`);
      setTokenInput('');
      setTimeout(() => { cancelEdit(); onTokenUpdated(); }, 1500);
    } catch (err) { setError(err instanceof Error ? err.message : 'Invalid token'); }
    finally { setSaving(false); }
  }

  function startCookieEdit() { setEditing(false); setEditingCookie(true); setCookieInput(''); setCookieError(null); setCookieSuccess(null); }
  function cancelCookieEdit() { setEditingCookie(false); setCookieInput(''); setCookieError(null); setCookieSuccess(null); }

  async function handleCookieSave() {
    if (!cookieInput.trim()) return;
    try {
      setCookieSaving(true); setCookieError(null);
      await updateSessionCookie(inst.id, cookieInput.trim());
      setCookieSuccess('Cookie saved');
      setCookieInput('');
      setTimeout(() => { cancelCookieEdit(); onTokenUpdated(); }, 1500);
    } catch (err) { setCookieError(err instanceof Error ? err.message : 'Save failed'); }
    finally { setCookieSaving(false); }
  }

  async function handleClearCookie() {
    try {
      setCookieSaving(true);
      await updateSessionCookie(inst.id, null);
      setCookieSuccess('Cookie cleared');
      onTokenUpdated();
      setTimeout(() => setCookieSuccess(null), 1500);
    } catch (err) { setCookieError(err instanceof Error ? err.message : 'Clear failed'); }
    finally { setCookieSaving(false); }
  }

  async function handleRefreshAvatars() {
    try {
      setRefreshing(true); setCookieError(null);
      const count = await refreshAvatars(inst.id);
      clearAvatarCache();
      setCookieSuccess(`Fetched ${count} avatar${count === 1 ? '' : 's'}`);
      setTimeout(() => setCookieSuccess(null), 3000);
    } catch (err) { setCookieError(err instanceof Error ? err.message : 'Refresh failed'); }
    finally { setRefreshing(false); }
  }

  const hasCookie = !!inst.sessionCookie;
  const tokenExp = tokenInfo && tokenInfo !== 'error' ? formatExpiration(tokenInfo) : null;
  const tokenTone: 'ok' | 'warn' | 'error' = tokenExp
    ? tokenExp.daysLeft !== null && tokenExp.daysLeft < 0
      ? 'error'
      : tokenExp.daysLeft !== null && tokenExp.daysLeft < 30
        ? 'warn'
        : 'ok'
    : 'ok';

  return (
    <li className="instance-row">
      <div className="instance-row-main">
        <div className="settings-row-text">
          <span className="settings-row-label instance-row-name">
            {renaming ? (
              <input
                type="text"
                className="instance-rename-input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.currentTarget.blur(); }
                  if (e.key === 'Escape') { e.currentTarget.dataset.cancelled = '1'; cancelRename(); }
                }}
                onBlur={(e) => { if (e.currentTarget.dataset.cancelled) return; if (nameInput.trim()) handleRename(); else cancelRename(); }}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Instance name"
              />
            ) : (
              <>
                {inst.name || inst.url}
                {inst.isDefault && <span className="instance-default-badge">Default</span>}
              </>
            )}
          </span>
          <span className="settings-row-desc">
            <span className="instance-url">{inst.url}</span>
            <span className="instance-meta-separator" aria-hidden="true">·</span>
            added {formatRelativeTime(inst.createdAt)}
            {!inst.hasToken && (
              <>
                <span className="instance-meta-separator" aria-hidden="true">·</span>
                <span className="instance-status instance-status--warn">token missing</span>
              </>
            )}
            {tokenExp && (
              <>
                <span className="instance-meta-separator" aria-hidden="true">·</span>
                <span className={`instance-status instance-status--${tokenTone}`}>{tokenExp.text}</span>
              </>
            )}
          </span>
        </div>
        <div className="settings-row-control">
          {!inst.isDefault && (
            <button className="instance-quiet-btn" onClick={() => onSetDefault(inst.id)}>
              Set Default
            </button>
          )}
          <Menu.Root>
            <Menu.Trigger className="instance-menu-trigger" aria-label={`Actions for ${inst.name || inst.url}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className="instance-menu-positioner" sideOffset={4} align="end">
                <Menu.Popup className="instance-menu-popup">
                  <Menu.Item className="instance-menu-item" onClick={startRename}>
                    Rename
                  </Menu.Item>
                  <Menu.Item className="instance-menu-item" onClick={startEdit}>
                    Edit Token…
                  </Menu.Item>
                  <Menu.Item className="instance-menu-item" onClick={startCookieEdit}>
                    {hasCookie ? 'Update Session Cookie…' : 'Set Session Cookie…'}
                  </Menu.Item>
                  {hasCookie && (
                    <Menu.Item className="instance-menu-item" onClick={handleRefreshAvatars} disabled={refreshing}>
                      {refreshing ? 'Refreshing Avatars…' : 'Refresh Avatars'}
                    </Menu.Item>
                  )}
                  <Menu.Separator className="instance-menu-separator" />
                  <Menu.Item className="instance-menu-item instance-menu-item--danger" onClick={() => onDelete(inst.id)}>
                    Remove Instance
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>

      {editing && (
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
            aria-label="Personal access token"
          />
          <div className="edit-token-actions">
            <button className="edit-token-save" onClick={handleSave} disabled={saving || !tokenInput.trim()}>
              {saving ? 'Validating…' : 'Save'}
            </button>
            <button className="edit-token-cancel" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
          {error && <div className="edit-token-error">{error}</div>}
          {success && <div className="edit-token-success">{success}</div>}
        </div>
      )}

      {editingCookie && (
        <div className="edit-token-form">
          <textarea
            className="edit-token-input session-cookie-input"
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') cancelCookieEdit(); }}
            placeholder="_gitlab_session=..."
            disabled={cookieSaving}
            rows={2}
            autoFocus
            aria-label="Session cookie"
          />
          <div className="edit-token-actions">
            <button className="edit-token-save" onClick={handleCookieSave} disabled={cookieSaving || !cookieInput.trim()}>
              {cookieSaving ? 'Saving…' : 'Save'}
            </button>
            {hasCookie && (
              <button className="edit-token-cancel" onClick={handleClearCookie} disabled={cookieSaving}>
                Clear
              </button>
            )}
            <button className="edit-token-cancel" onClick={cancelCookieEdit} disabled={cookieSaving}>
              Cancel
            </button>
          </div>
          <span className="session-cookie-hint">The cookie expires with your browser session.</span>
          {cookieError && <div className="edit-token-error">{cookieError}</div>}
          {cookieSuccess && <div className="edit-token-success">{cookieSuccess}</div>}
        </div>
      )}

      {!editing && !editingCookie && cookieError && (
        <div className="edit-token-error">{cookieError}</div>
      )}
      {!editing && !editingCookie && cookieSuccess && (
        <div className="edit-token-success">{cookieSuccess}</div>
      )}
    </li>
  );
}
