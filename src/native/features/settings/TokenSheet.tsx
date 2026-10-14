/**
 * Sheet that replaces an instance's personal access token. Used for the
 * "session expired" prompt and for Settings → Accounts → Replace token.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { api, openExternal } from '../../api/client';
import { useKeys } from '../../app/keys';
import { invalidate } from '../../data/query';
import { Button, Sheet, toast } from '../../ui/components';
import { ExternalIcon, WarningIcon } from '../../ui/icons';
import { Notice, TextField, tokenPageUrl } from './form';
import { describeError } from './errors';
import './settings.css';

export function TokenSheet({
  open,
  instanceId,
  instanceUrl,
  title,
  message,
  cancelLabel = 'Cancel',
  onClose,
}: {
  open: boolean;
  instanceId: number;
  instanceUrl: string;
  title: ReactNode;
  message: ReactNode;
  cancelLabel?: string;
  /** `updated` is true once the new token was accepted. */
  onClose: (updated: boolean) => void;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = hostOf(instanceUrl);

  const close = (updated: boolean) => {
    setToken('');
    setError(null);
    onClose(updated);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const username = await api.updateToken(instanceId, token.trim());
      toast(`Signed in to ${host} as @${username}`, { tone: 'success' });
      close(true);
      await invalidate();
      api.triggerSync(false).catch(() => {});
    } catch (err) {
      setError(describeError(err, instanceUrl));
    } finally {
      setBusy(false);
    }
  };

  useKeys({ 'mod+enter': () => void submit() }, { enabled: open });

  return (
    <Sheet
      open={open}
      onClose={() => close(false)}
      width={460}
      title={title}
      footer={
        <>
          <Button onClick={() => close(false)}>{cancelLabel}</Button>
          <Button variant="primary" busy={busy} disabled={!token.trim()} onClick={() => void submit()} shortcut="mod+enter">
            Update token
          </Button>
        </>
      }
    >
      <form className="st-sheet-form" onSubmit={submit}>
        <p className="st-sheet-text">{message}</p>
        <label className="st-field">
          <span className="st-field__label">New personal access token</span>
          <TextField
            type="password"
            value={token}
            placeholder="glpat-…"
            autoFocus
            invalid={!!error}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <button type="button" className="st-linkbtn" onClick={() => void openExternal(tokenPageUrl(instanceUrl))}>
          Create a token on {host} <ExternalIcon size={11} />
        </button>
        {error && (
          <Notice>
            <WarningIcon size={13} />
            {error}
          </Notice>
        )}
      </form>
    </Sheet>
  );
}

export function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
