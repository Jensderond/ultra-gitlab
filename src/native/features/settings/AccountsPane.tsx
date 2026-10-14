/** Settings → Accounts: connected GitLab instances, tokens, avatars cookie. */

import { useState, type FormEvent } from 'react';
import { api, openExternal, type InstanceWithStatus } from '../../api/client';
import { useKeys } from '../../app/keys';
import { navigate, paths } from '../../app/router';
import { useActiveInstance, useAvatars } from '../../data/hooks';
import { invalidate, useQuery } from '../../data/query';
import type { TokenInfo } from '../../api/types';
import { Avatar, Button, Sheet, Spinner, Tag, toast } from '../../ui/components';
import { ExternalIcon, PlusIcon, WarningIcon } from '../../ui/icons';
import { Group, Notice, Row, TextField } from './form';
import { hostOf, TokenSheet } from './TokenSheet';

const DAY = 86_400_000;

/** Human token status; `tone` drives the colour. */
export function tokenStatus(info: TokenInfo | undefined, now = Date.now()): { text: string; tone: 'ok' | 'warn' | 'fail' | 'muted' } {
  if (!info) return { text: 'Checking token…', tone: 'muted' };
  if (!info.active) return { text: 'This token was revoked or has expired.', tone: 'fail' };
  if (!info.expiresAt) return { text: 'The token never expires.', tone: 'ok' };
  const expires = new Date(info.expiresAt);
  const days = Math.ceil((expires.getTime() - now) / DAY);
  const date = expires.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (days < 0) return { text: `The token expired on ${date}.`, tone: 'fail' };
  if (days === 0) return { text: 'The token expires today.', tone: 'fail' };
  if (days <= 14) return { text: `The token expires in ${days} day${days === 1 ? '' : 's'} (${date}).`, tone: 'warn' };
  return { text: `The token expires on ${date}.`, tone: days <= 30 ? 'warn' : 'ok' };
}

export function AccountsPane() {
  const { instances, instance: active, loading } = useActiveInstance();

  if (loading && instances.length === 0) {
    return (
      <div className="st-loading">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      {instances.map((inst) => (
        <InstanceGroup key={inst.id} inst={inst} active={inst.id === active?.id} several={instances.length > 1} />
      ))}
      <div className="st-actions">
        <Button icon={<PlusIcon size={14} />} onClick={() => navigate(paths.setup())}>
          Add GitLab instance…
        </Button>
      </div>
    </>
  );
}

function InstanceGroup({ inst, active, several }: { inst: InstanceWithStatus; active: boolean; several: boolean }) {
  const host = hostOf(inst.url);
  const me = inst.authenticatedUsername ?? '';
  const avatars = useAvatars(inst.id, me ? [me] : []);
  const token = useQuery(['instances', 'token', inst.id], () => api.tokenInfo(inst.id), { staleTime: 5 * 60_000 });
  const status = token.error
    ? { text: `Couldn't check the token: ${token.error.message}`, tone: 'fail' as const }
    : tokenStatus(token.data);

  const [name, setName] = useState(inst.name ?? '');
  const [editingName, setEditingName] = useState(false);
  const [sheet, setSheet] = useState<null | 'token' | 'cookie' | 'remove'>(null);

  const saveName = async () => {
    setEditingName(false);
    const next = name.trim();
    if (next === (inst.name ?? '')) return;
    try {
      await api.renameInstance(inst.id, next);
      await invalidate(['instances']);
    } catch (e) {
      setName(inst.name ?? '');
      toast(`Couldn't rename: ${(e as Error).message}`, { tone: 'error' });
    }
  };

  const makeDefault = async () => {
    try {
      await api.setDefaultInstance(inst.id);
      await invalidate(['instances']);
    } catch (e) {
      toast(`Couldn't change the default: ${(e as Error).message}`, { tone: 'error' });
    }
  };

  return (
    <Group
      className="st-account"
      title={
        <span className="st-account__head">
          <Avatar username={me || host} src={avatars?.[me]} size={32} />
          <span className="st-account__names">
            <span className="st-account__name">{inst.name || host}</span>
            <span className="st-account__sub">
              {me ? `@${me} · ` : ''}
              {host}
            </span>
          </span>
          {inst.isDefault && several && <Tag tone="accent">Default</Tag>}
          {active && several && <Tag>Showing</Tag>}
        </span>
      }
    >
      <Row label="Name" description="Shown in the toolbar and account menu." htmlFor={`st-name-${inst.id}`}>
        <TextField
          id={`st-name-${inst.id}`}
          className="st-input--name"
          value={editingName ? name : (inst.name ?? '')}
          placeholder={host}
          onFocus={() => {
            setName(inst.name ?? '');
            setEditingName(true);
          }}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </Row>
      <Row
        label="Access token"
        description={
          <span className={`st-tone st-tone--${status.tone}`}>
            {(status.tone === 'fail' || status.tone === 'warn') && <WarningIcon size={12} />}
            {status.text}
            {token.data?.scopes?.length ? <span className="st-scopes"> Scopes: {token.data.scopes.join(', ')}.</span> : null}
          </span>
        }
      >
        <Button size="sm" onClick={() => setSheet('token')}>
          Replace…
        </Button>
      </Row>
      <Row
        label="Avatars"
        description={
          inst.sessionCookie
            ? 'Using your browser session to load avatars.'
            : 'Optional. Private instances only serve avatars to signed-in browsers.'
        }
      >
        {inst.sessionCookie && (
          <Button size="sm" variant="plain" onClick={() => void saveCookie(inst.id, null)}>
            Clear
          </Button>
        )}
        <Button size="sm" onClick={() => setSheet('cookie')}>
          {inst.sessionCookie ? 'Replace…' : 'Add session cookie…'}
        </Button>
      </Row>
      {several && (
        <Row label="Default instance" description="Shown first when Ultra GitLab opens.">
          {inst.isDefault ? (
            <span className="st-muted">This is the default</span>
          ) : (
            <Button size="sm" onClick={() => void makeDefault()}>
              Make default
            </Button>
          )}
        </Row>
      )}
      <Row label="Open on the web" description={inst.url}>
        <Button size="sm" variant="plain" icon={<ExternalIcon size={12} />} onClick={() => void openExternal(inst.url)}>
          Open
        </Button>
        <Button size="sm" variant="plain" className="st-danger" onClick={() => setSheet('remove')}>
          Remove…
        </Button>
      </Row>

      <TokenSheet
        open={sheet === 'token'}
        instanceId={inst.id}
        instanceUrl={inst.url}
        title={`Replace the token for ${inst.name || host}`}
        message="Paste a new personal access token with the api scope. The old one stays valid on GitLab until you revoke it there."
        onClose={() => setSheet(null)}
      />
      <CookieSheet open={sheet === 'cookie'} inst={inst} onClose={() => setSheet(null)} />
      <RemoveSheet open={sheet === 'remove'} inst={inst} onClose={() => setSheet(null)} />
    </Group>
  );
}

async function saveCookie(instanceId: number, value: string | null) {
  try {
    await api.updateSessionCookie(instanceId, value);
    toast(value ? 'Session cookie saved' : 'Session cookie removed');
    await invalidate(['instances']);
    void invalidate(['avatars']);
    return true;
  } catch (e) {
    toast(`Couldn't save the cookie: ${(e as Error).message}`, { tone: 'error' });
    return false;
  }
}

function CookieSheet({ open, inst, onClose }: { open: boolean; inst: InstanceWithStatus; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const host = hostOf(inst.url);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    const ok = await saveCookie(inst.id, value.trim());
    setBusy(false);
    if (ok) {
      setValue('');
      onClose();
    }
  };
  useKeys({ 'mod+enter': () => void submit() }, { enabled: open });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width={460}
      title="Load avatars with your browser session"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!value.trim()} onClick={() => void submit()} shortcut="mod+enter">
            Save
          </Button>
        </>
      }
    >
      <form className="st-sheet-form" onSubmit={submit}>
        <p className="st-sheet-text">
          Sign in to {host} in your browser, open the developer tools and copy the value of the{' '}
          <code>_gitlab_session</code> cookie. It's only used to fetch avatar images and expires with your browser session.
        </p>
        <label className="st-field">
          <span className="st-field__label">_gitlab_session</span>
          <TextField type="password" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
      </form>
    </Sheet>
  );
}

function RemoveSheet({ open, inst, onClose }: { open: boolean; inst: InstanceWithStatus; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = inst.name || hostOf(inst.url);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteInstance(inst.id);
      onClose();
      toast(`Removed ${name}`);
      await invalidate(['instances']);
      void invalidate(['mrs']);
      void invalidate(['pipelines']);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width={420}
      title={`Remove ${name}?`}
      footer={
        <>
          <Button onClick={onClose} autoFocus>
            Cancel
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void remove()}>
            Remove
          </Button>
        </>
      }
    >
      <p className="st-sheet-text">
        Ultra GitLab forgets this instance's token and deletes its cached merge requests, comments and pipelines from
        this Mac. Nothing changes on GitLab.
      </p>
      {error && (
        <Notice>
          <WarningIcon size={13} />
          {error}
        </Notice>
      )}
    </Sheet>
  );
}
