/**
 * The home window: unified toolbar + source-list sidebar + content. Both the
 * merge request inbox and the pipelines dashboard render inside it, so
 * switching between them (⌘1 / ⌘2 or the segmented control) keeps the
 * sidebar and toolbar still — only the content changes.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { onSyncProgress } from '../../api/events';
import { invalidate } from '../../data/query';
import { setActiveInstanceId, useActiveInstance, useAvatars } from '../../data/hooks';
import { SearchJump } from '../../features/palette/SearchJump';
import {
  Avatar,
  IconButton,
  Segmented,
  showContextMenu,
  Toolbar,
  ToolbarTitle,
  toast,
  type MenuEntry,
} from '../../ui/components';
import { RefreshIcon } from '../../ui/icons';
import { Body, Window } from '../../ui/layout';
import { homePath, navigate, paths } from '../router';
import { HomeSidebar } from './HomeSidebar';
import './home.css';

export type HomeSection = 'mrs' | 'pipelines';

/** Kick a background sync and refresh what's on screen. Shared with ⌘R. */
export async function refreshAll() {
  try {
    await api.triggerSync(false);
  } catch (e) {
    toast(`Sync failed: ${(e as Error).message}`, { tone: 'error' });
  }
  await invalidate();
}

// Each home screen mounts its own HomeLayout, so switching views replaces the
// toolbar. Set when the switch came from a focused segment, so the new
// toolbar can put keyboard focus back on it instead of dropping it to <body>.
let refocusSwitcher = false;

export function useSyncing() {
  const [syncing, setSyncing] = useState(false);
  useEffect(
    () =>
      onSyncProgress((p) => {
        if (p.type === 'started' || p.type === 'progress') setSyncing(true);
        if (p.type === 'completed' || p.type === 'error') setSyncing(false);
      }),
    [],
  );
  return syncing;
}

export function HomeLayout({
  section,
  title,
  subtitle,
  children,
}: {
  section: HomeSection;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const { instance, instances } = useActiveInstance();
  const me = instance?.authenticatedUsername ?? '';
  const avatars = useAvatars(instance?.id, me ? [me] : []);
  const syncing = useSyncing();
  const [manual, setManual] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!refocusSwitcher) return;
    refocusSwitcher = false;
    switcherRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }, []);

  const onRefresh = async () => {
    setManual(true);
    await refreshAll();
    setManual(false);
  };

  const accountMenu = (e: React.MouseEvent) => {
    const entries: MenuEntry[] = [
      ...instances.map((i) => ({
        label: `${i.id === instance?.id ? '✓ ' : '   '}${i.name || new URL(i.url).host}`,
        action: () => setActiveInstanceId(i.id),
      })),
      { separator: true },
      { label: 'Add GitLab instance…', action: () => navigate(paths.setup()) },
      { label: 'Settings…', action: () => navigate(paths.settings()), shortcut: 'CmdOrCtrl+,' },
    ];
    void showContextMenu(e, entries);
  };

  return (
    <Window>
      {/* Title | view switcher | actions on a 1fr/auto/1fr grid: the switcher
          stays put while the title changes width between views. */}
      <Toolbar className="home-toolbar">
        <ToolbarTitle title={title} subtitle={subtitle} />
        <div ref={switcherRef} className="home-toolbar__switcher">
          <Segmented<HomeSection>
            label="View"
            value={section}
            onChange={(v) => {
              if (v === section) return;
              refocusSwitcher = !!switcherRef.current?.contains(document.activeElement);
              navigate(homePath(v === 'mrs' ? 'inbox' : 'pipelines'));
            }}
            options={[
              { value: 'mrs', label: 'Merge requests', title: '⌘1' },
              { value: 'pipelines', label: 'Pipelines', title: '⌘2' },
            ]}
          />
        </div>
        <div className="home-toolbar__end">
          <SearchJump />
          <IconButton label="Refresh (⌘R)" onClick={onRefresh} className={syncing || manual ? 'is-spinning' : ''}>
            <RefreshIcon size={16} />
          </IconButton>
          <button
            type="button"
            className="home-account"
            aria-label={me ? `Signed in as ${me}` : 'Account'}
            title={instance ? `${me} · ${new URL(instance.url).host}` : 'Account'}
            onClick={accountMenu}
            onContextMenu={accountMenu}
          >
            <Avatar username={me || '?'} src={avatars?.[me]} size={28} />
          </button>
        </div>
      </Toolbar>
      <Body>
        <HomeSidebar section={section} />
        <div className="home-content">{children}</div>
      </Body>
    </Window>
  );
}
