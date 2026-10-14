/**
 * First run, and "Add GitLab instance…": a calm, centred onboarding panel.
 * Connect validates the token against GitLab (the backend fetches the user),
 * then switches the app to the new instance and starts the first sync.
 */

import { useState, type FormEvent } from 'react';
import { api, openExternal } from '../../api/client';
import { useKeys } from '../../app/keys';
import { navigate, paths } from '../../app/router';
import { setActiveInstanceId, useInstances } from '../../data/hooks';
import { invalidate } from '../../data/query';
import { Button, toast, Toolbar } from '../../ui/components';
import { ExternalIcon, WarningIcon } from '../../ui/icons';
import { Body, Window } from '../../ui/layout';
import appIcon from '../../../assets/favicon/web-app-manifest-192x192.png';
import { describeError } from '../settings/errors';
import { leave } from '../settings/leave';
import { Notice, TextField, tokenPageUrl } from '../settings/form';
import './setup.css';

/** `gitlab.example.com/` → `https://gitlab.example.com`. Null if it can't be a URL. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function SetupScreen() {
  const { data: instances } = useInstances();
  const adding = (instances?.length ?? 0) > 0;
  const [url, setUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: 'url' | 'token' | null; text: string } | null>(null);

  const normalized = normalizeUrl(url);
  const host = normalized ? new URL(normalized).host : null;

  const cancel = leave;

  const connect = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!normalized) {
      setError({ field: 'url', text: 'Enter the address of your GitLab server, like https://gitlab.com.' });
      return;
    }
    if (!token.trim()) {
      setError({ field: 'token', text: 'Paste a personal access token to sign in.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { instance, username } = await api.setupInstance({
        url: normalized,
        token: token.trim(),
        name: name.trim() || undefined,
      });
      await invalidate(['instances']);
      setActiveInstanceId(instance.id);
      api.triggerSync(false).catch(() => {});
      toast(`Connected to ${host} as @${username}`, { tone: 'success' });
      navigate(paths.inbox(), { replace: true });
    } catch (err) {
      const text = describeError(err, normalized);
      setError({ field: /token|scope/i.test(text) ? 'token' : /reach|URL|GitLab server/.test(text) ? 'url' : null, text });
    } finally {
      setBusy(false);
    }
  };

  useKeys({
    'mod+enter': () => void connect(),
    escape: adding ? () => cancel() : undefined,
  });

  return (
    <Window className="su-window">
      <Toolbar>
        <span />
      </Toolbar>
      <Body className="su-body">
        <form className="su-panel" onSubmit={connect} noValidate>
          <img className="su-icon" src={appIcon} alt="" width={64} height={64} draggable={false} />
          <h1 className="su-title">{adding ? 'Add a GitLab instance' : 'Welcome to Ultra GitLab'}</h1>
          <p className="su-lede">
            {adding
              ? 'Connect another GitLab server. You can switch between instances from the account menu.'
              : 'Review merge requests and follow pipelines from a fast, native window. Connect your GitLab account to start.'}
          </p>

          <div className="su-form">
            <label className="su-label" htmlFor="su-url">
              GitLab URL
            </label>
            <TextField
              id="su-url"
              type="url"
              inputMode="url"
              value={url}
              autoFocus={adding}
              invalid={error?.field === 'url'}
              placeholder="https://gitlab.com"
              onChange={(e) => {
                setUrl(e.target.value);
                if (error?.field === 'url') setError(null);
              }}
            />

            <label className="su-label" htmlFor="su-token">
              Access token
            </label>
            <div className="su-stack">
              <TextField
                id="su-token"
                type="password"
                value={token}
                autoFocus={!adding}
                invalid={error?.field === 'token'}
                placeholder="glpat-…"
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error?.field === 'token') setError(null);
                }}
              />
              <span className="su-help">
                A personal access token with the <code>api</code> scope.{' '}
                <button
                  type="button"
                  className="su-link"
                  disabled={!normalized}
                  onClick={() => normalized && void openExternal(tokenPageUrl(normalized))}
                >
                  Create one on {host ?? 'GitLab'} <ExternalIcon size={11} />
                </button>
              </span>
            </div>

            <label className="su-label" htmlFor="su-name">
              Name
            </label>
            <div className="su-stack">
              <TextField
                id="su-name"
                value={name}
                placeholder={host ? `${host} (optional)` : 'Optional'}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="su-error" aria-live="polite">
            {error && (
              <Notice>
                <WarningIcon size={13} />
                {error.text}
              </Notice>
            )}
          </div>

          <div className="su-buttons">
            <span className="su-note">Your token stays on this Mac.</span>
            {adding && (
              <Button type="button" onClick={cancel} disabled={busy}>
                Cancel
              </Button>
            )}
            <Button type="submit" variant="primary" busy={busy} shortcut="mod+enter">
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
        </form>
      </Body>
    </Window>
  );
}
