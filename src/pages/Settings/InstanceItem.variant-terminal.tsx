import { useState } from 'react';
import { formatRelativeTime } from '../../services/storage';
import { renameInstance, updateInstanceToken, updateSessionCookie, refreshAvatars } from '../../services/tauri';
import { clearAvatarCache } from '../../components/UserAvatar/UserAvatar';
import type { TokenInfo } from '../../types';
import type { GitLabInstanceWithStatus } from '../../services/gitlab';
import './InstanceItem.variant-terminal.css';

interface InstanceItemProps {
  inst: GitLabInstanceWithStatus;
  tokenInfo: TokenInfo | 'error' | undefined;
  onDelete: (id: number) => void;
  onTokenUpdated: () => void;
  onSetDefault: (id: number) => void;
}

function formatExpiration(info: TokenInfo): { text: string; daysLeft: number | null } {
  if (!info.expiresAt) return { text: 'no-expiry', daysLeft: null };
  const expires = new Date(info.expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const formatted = expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (daysLeft < 0) return { text: `EXPIRED ${formatted}`, daysLeft };
  return { text: `expires ${formatted} (${daysLeft}d)`, daysLeft };
}

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

  function startEdit() { setEditing(true); setTokenInput(''); setError(null); setSuccess(null); }
  function cancelEdit() { setEditing(false); setTokenInput(''); setError(null); setSuccess(null); }

  async function handleSave() {
    if (!tokenInput.trim()) return;
    try {
      setSaving(true); setError(null);
      const username = await updateInstanceToken(inst.id, tokenInput.trim());
      setSuccess(`token updated → ${username}`);
      setTokenInput('');
      setTimeout(() => { cancelEdit(); onTokenUpdated(); }, 1500);
    } catch (err) { setError(err instanceof Error ? err.message : 'invalid token'); }
    finally { setSaving(false); }
  }

  function startCookieEdit() { setEditingCookie(true); setCookieInput(''); setCookieError(null); setCookieSuccess(null); }
  function cancelCookieEdit() { setEditingCookie(false); setCookieInput(''); setCookieError(null); setCookieSuccess(null); }

  async function handleCookieSave() {
    if (!cookieInput.trim()) return;
    try {
      setCookieSaving(true); setCookieError(null);
      await updateSessionCookie(inst.id, cookieInput.trim());
      setCookieSuccess('cookie saved');
      setCookieInput('');
      setTimeout(() => { cancelCookieEdit(); onTokenUpdated(); }, 1500);
    } catch (err) { setCookieError(err instanceof Error ? err.message : 'save failed'); }
    finally { setCookieSaving(false); }
  }

  async function handleClearCookie() {
    try {
      setCookieSaving(true);
      await updateSessionCookie(inst.id, null);
      setCookieSuccess('cookie cleared');
      onTokenUpdated();
      setTimeout(() => setCookieSuccess(null), 1500);
    } catch (err) { setCookieError(err instanceof Error ? err.message : 'clear failed'); }
    finally { setCookieSaving(false); }
  }

  async function handleRefreshAvatars() {
    try {
      setRefreshing(true); setCookieError(null);
      const count = await refreshAvatars(inst.id);
      clearAvatarCache();
      setCookieSuccess(`fetched ${count} avatar${count === 1 ? '' : 's'}`);
      setTimeout(() => setCookieSuccess(null), 3000);
    } catch (err) { setCookieError(err instanceof Error ? err.message : 'refresh failed'); }
    finally { setRefreshing(false); }
  }

  const hasCookie = !!inst.sessionCookie;
  const tokenExp = tokenInfo && tokenInfo !== 'error' ? formatExpiration(tokenInfo) : null;

  return (
    <li className={`term-card${inst.isDefault ? ' term-card--default' : ''}`}>
      {/* Titlebar */}
      <div className="term-card__titlebar">
        <div className="term-card__dots">
          <span className="term-card__dot term-card__dot--red" />
          <span className="term-card__dot term-card__dot--yellow" />
          <span className="term-card__dot term-card__dot--green" />
        </div>
        {renaming ? (
          <span className="term-card__title term-card__title--editing">
            <input
              type="text"
              className="term-card__title-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.currentTarget.blur(); }
                if (e.key === 'Escape') { e.currentTarget.dataset.cancelled = '1'; cancelRename(); }
              }}
              onBlur={(e) => { if (e.currentTarget.dataset.cancelled) return; if (nameInput.trim()) handleRename(); else cancelRename(); }}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
            />
          </span>
        ) : (
          <span className="term-card__title">
            {inst.name || inst.url}
            <button className="term-card__rename-btn" onClick={startRename} title="Rename">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
            </button>
          </span>
        )}
        <div className="term-card__titlebar-actions">
          {!inst.isDefault && (
            <button className="term-card__cmd" onClick={() => onSetDefault(inst.id)}>
              $ set-default
            </button>
          )}
          <button className="term-card__cmd term-card__cmd--danger" onClick={() => onDelete(inst.id)}>
            $ rm
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="term-card__body">
        {/* Connection info line */}
        <div className="term-card__line">
          <span className="term-card__prompt">{'>'}</span>
          <span className="term-card__url">{inst.url}</span>
          <span className="term-card__dim">added {formatRelativeTime(inst.createdAt)}</span>
        </div>

        {/* Status line */}
        <div className="term-card__line">
          <span className="term-card__prompt">{'>'}</span>
          {!inst.hasToken && (
            <span className="term-card__tag term-card__tag--warn">TOKEN_MISSING</span>
          )}
          {inst.isDefault && (
            <span className="term-card__tag term-card__tag--active">DEFAULT</span>
          )}
          {tokenExp && (
            <>
              <span className={`term-card__tag ${
                tokenExp.daysLeft !== null && tokenExp.daysLeft < 0 ? 'term-card__tag--error' :
                tokenExp.daysLeft !== null && tokenExp.daysLeft < 30 ? 'term-card__tag--warn' :
                'term-card__tag--ok'
              }`}>
                {tokenExp.text}
              </span>
            </>
          )}
        </div>

        {/* Separator */}
        <div className="term-card__separator" />

        {/* Actions */}
        {editing ? (
          <div className="term-card__input-block">
            <div className="term-card__line">
              <span className="term-card__prompt term-card__prompt--input">$</span>
              <input
                type="password"
                className="term-card__input"
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
            </div>
            <div className="term-card__actions">
              <button className="term-card__btn" onClick={handleSave} disabled={saving || !tokenInput.trim()}>
                {saving ? 'validating...' : 'save'}
              </button>
              <button className="term-card__btn term-card__btn--ghost" onClick={cancelEdit} disabled={saving}>
                cancel
              </button>
            </div>
            {error && <div className="term-card__output term-card__output--error">ERR: {error}</div>}
            {success && <div className="term-card__output term-card__output--ok">OK: {success}</div>}
          </div>
        ) : editingCookie ? (
          <div className="term-card__input-block">
            <div className="term-card__line">
              <span className="term-card__prompt term-card__prompt--input">$</span>
              <textarea
                className="term-card__input term-card__input--multi"
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') cancelCookieEdit(); }}
                placeholder="_gitlab_session=..."
                disabled={cookieSaving}
                rows={2}
                autoFocus
              />
            </div>
            <div className="term-card__actions">
              <button className="term-card__btn" onClick={handleCookieSave} disabled={cookieSaving || !cookieInput.trim()}>
                {cookieSaving ? 'saving...' : 'save'}
              </button>
              {hasCookie && (
                <button className="term-card__btn term-card__btn--ghost" onClick={handleClearCookie} disabled={cookieSaving}>
                  clear
                </button>
              )}
              <button className="term-card__btn term-card__btn--ghost" onClick={cancelCookieEdit} disabled={cookieSaving}>
                cancel
              </button>
            </div>
            <div className="term-card__hint">// cookie expires with browser session</div>
            {cookieError && <div className="term-card__output term-card__output--error">ERR: {cookieError}</div>}
            {cookieSuccess && <div className="term-card__output term-card__output--ok">OK: {cookieSuccess}</div>}
          </div>
        ) : (
          <div className="term-card__cmds">
            <button className="term-card__cmd" onClick={startEdit}>$ edit-token</button>
            <button className="term-card__cmd" onClick={startCookieEdit}>
              $ {hasCookie ? 'update-cookie' : 'set-cookie'}
            </button>
            {hasCookie && (
              <button className="term-card__cmd" onClick={handleRefreshAvatars} disabled={refreshing}>
                $ {refreshing ? 'refreshing...' : 'refresh-avatars'}
              </button>
            )}
          </div>
        )}

        {!editing && !editingCookie && cookieError && (
          <div className="term-card__output term-card__output--error">ERR: {cookieError}</div>
        )}
        {!editing && !editingCookie && cookieSuccess && (
          <div className="term-card__output term-card__output--ok">OK: {cookieSuccess}</div>
        )}
      </div>
    </li>
  );
}
