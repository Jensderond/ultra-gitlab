/**
 * Settings page orchestrator.
 *
 * Desktop (≥768px): sidebar rail of categories on the left, one category's
 * settings rendered in a detail pane on the right. Each category has its own
 * route (/settings/:section) so deep links work.
 *
 * Narrow screens (<768px): /settings renders the category list full-screen;
 * picking a category navigates to its detail page with a back button.
 *
 * The rail doubles as a status board: each category shows its live value
 * (current theme, sync interval, instance count, …).
 */

import { useState, useEffect } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import { isTauri } from '../../services/transport';
import { getNotificationSettings } from '../../services/tauri';
import type { UpdateCheckerState } from '../../hooks/useUpdateChecker';
import type { NotificationSettings } from '../../types';
import { useSyncSettingsQuery } from '../../hooks/queries/useSyncSettingsQuery';
import { useInstancesQuery } from '../../hooks/queries/useInstancesQuery';
import useTheme from '../../hooks/useTheme';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import UpdatesSection from './UpdatesSection';
import InstancesSection from './InstancesSection';
import SyncSettingsSection from './SyncSettingsSection';
import CliSection from './CliSection';
import AppearanceSection from './AppearanceSection';
import NotificationsSection from './NotificationsSection';
import CollapsePatternsEditor from './CollapsePatternsEditor';
import NavigationSection from './NavigationSection';
import ShortcutEditor from './ShortcutEditor';
import '../Settings.css';

interface SettingsProps {
  updateChecker?: UpdateCheckerState;
}

type SectionId =
  | 'instances'
  | 'sync'
  | 'appearance'
  | 'notifications'
  | 'shortcuts'
  | 'generated-files'
  | 'file-navigation'
  | 'cli'
  | 'updates';

interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  tauriOnly?: boolean;
  /** Hide on small screens (features that need a physical keyboard). */
  desktopOnly?: boolean;
}

interface SectionGroup {
  label: string;
  sections: SectionDef[];
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: 'Connection',
    sections: [
      {
        id: 'instances',
        label: 'GitLab Instances',
        description: 'Connected servers and access tokens',
      },
      {
        id: 'sync',
        label: 'Sync',
        description: 'How often merge request data refreshes',
      },
    ],
  },
  {
    label: 'Interface',
    sections: [
      {
        id: 'appearance',
        label: 'Appearance',
        description: 'Theme, fonts and list density',
      },
      {
        id: 'notifications',
        label: 'Notifications',
        description: 'Desktop alerts for merge requests and pipelines',
        tauriOnly: true,
      },
      {
        id: 'shortcuts',
        label: 'Keyboard Shortcuts',
        description: 'Rebind keys for any command',
        tauriOnly: true,
        desktopOnly: true,
      },
    ],
  },
  {
    label: 'Review tools',
    sections: [
      {
        id: 'generated-files',
        label: 'Generated Files',
        description: 'Patterns for files collapsed by default in diffs',
        tauriOnly: true,
      },
      {
        id: 'file-navigation',
        label: 'File Navigation',
        description: 'Arrow-key jump distance in the diff viewer',
        tauriOnly: true,
      },
      {
        id: 'cli',
        label: 'Command Line',
        description: 'Review MRs from your shell with the ultra CLI',
        tauriOnly: true,
      },
    ],
  },
  {
    label: 'Application',
    sections: [
      {
        id: 'updates',
        label: 'Updates',
        description: 'App version and new releases',
        tauriOnly: true,
      },
    ],
  },
];

/** Map sync interval seconds to display label. */
const SYNC_INTERVAL_LABELS: Record<number, string> = {
  60: '1 min', 120: '2 min', 300: '5 min', 600: '10 min', 900: '15 min', 1800: '30 min',
};

function useNotificationSubtitle(): string | undefined {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    getNotificationSettings().then(setSettings).catch(() => {});
  }, []);
  if (!settings) return undefined;
  const enabled = [
    settings.mrReadyToMerge && 'MR ready',
    settings.pipelineStatusPinned && 'Pipelines',
  ].filter(Boolean);
  if (enabled.length === 0) return 'Off';
  if (enabled.length === 2) return 'All enabled';
  return `Only ${enabled[0]}`;
}

function useAppVersion(): string {
  const [version, setVersion] = useState('');
  useEffect(() => {
    if (!isTauri) { setVersion('browser'); return; }
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion().then(setVersion))
      .catch(() => {});
  }, []);
  return version;
}

function SectionContent({
  id,
  updateChecker,
  highlightCondensed,
}: {
  id: SectionId;
  updateChecker?: UpdateCheckerState;
  highlightCondensed: boolean;
}) {
  switch (id) {
    case 'instances': return <InstancesSection />;
    case 'sync': return <SyncSettingsSection />;
    case 'appearance': return <AppearanceSection highlightCondensed={highlightCondensed} />;
    case 'notifications': return <NotificationsSection />;
    case 'shortcuts': return <ShortcutEditor />;
    case 'generated-files': return <CollapsePatternsEditor />;
    case 'file-navigation': return <NavigationSection />;
    case 'cli': return <CliSection />;
    case 'updates': return updateChecker ? <UpdatesSection updateChecker={updateChecker} /> : null;
  }
}

/**
 * Settings page for managing GitLab instances and application preferences.
 */
export default function Settings({ updateChecker }: SettingsProps) {
  const { section: sectionParam } = useParams<{ section: string }>();
  const isSmallScreen = useSmallScreen();
  const location = useLocation();
  const syncQuery = useSyncSettingsQuery();
  const instancesQuery = useInstancesQuery();
  const { theme } = useTheme();
  const notifSubtitle = useNotificationSubtitle();
  const appVersion = useAppVersion();

  const highlight = new URLSearchParams(location.search).get('highlight');
  const highlightCondensed = highlight === 'condensed-mr-list';

  const groups = SECTION_GROUPS
    .map((group) => ({
      ...group,
      sections: group.sections.filter(
        (s) =>
          (isTauri || !s.tauriOnly) &&
          (!isSmallScreen || !s.desktopOnly) &&
          (s.id !== 'updates' || updateChecker),
      ),
    }))
    .filter((group) => group.sections.length > 0);
  const sections = groups.flatMap((g) => g.sections);

  const updateAvailable = updateChecker?.available ?? false;
  const values: Partial<Record<SectionId, string>> = {
    instances: instancesQuery.data ? String(instancesQuery.data.length) : undefined,
    sync: syncQuery.data
      ? SYNC_INTERVAL_LABELS[syncQuery.data.interval_secs] ?? `${syncQuery.data.interval_secs}s`
      : undefined,
    appearance: theme.name,
    notifications: notifSubtitle,
    updates: updateAvailable ? 'Update available' : appVersion ? `v${appVersion}` : undefined,
  };

  // Legacy deep link: /settings?highlight=condensed-mr-list opened Appearance.
  if (!sectionParam && highlightCondensed) {
    return <Navigate to={`/settings/appearance${location.search}`} replace />;
  }
  if (sectionParam && !sections.some((s) => s.id === sectionParam)) {
    return <Navigate to="/settings" replace />;
  }

  const activeId = (sectionParam as SectionId | undefined)
    ?? (isSmallScreen ? undefined : sections[0]?.id);
  const activeDef = sections.find((s) => s.id === activeId);

  // Narrow screens, no section picked: full-screen category list.
  if (isSmallScreen && !activeDef) {
    return (
      <div className="settings-page">
        <header className="settings-header settings-header--root">
          <BackButton to="/mrs" title="Back to MRs" />
          <h1>Settings</h1>
        </header>
        <main className="settings-content">
          <nav className="settings-mobile-list">
            {groups.map((group) => (
              <div className="settings-mobile-group" key={group.label}>
                <span className="settings-group-eyebrow">{group.label}</span>
                <div className="settings-mobile-card">
                  {group.sections.map((s) => (
                    <Link key={s.id} to={`/settings/${s.id}`} className="settings-mobile-row">
                      <span className="settings-mobile-text">
                        <span className="settings-mobile-label">{s.label}</span>
                        <span className="settings-mobile-desc">{s.description}</span>
                      </span>
                      {values[s.id] && (
                        <span className={`settings-value${s.id === 'updates' && updateAvailable ? ' settings-value--accent' : ''}`}>
                          {values[s.id]}
                        </span>
                      )}
                      <svg className="settings-mobile-chevron" width="14" height="14" viewBox="0 0 12 12" fill="none">
                        <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </main>
      </div>
    );
  }

  // Narrow screens, section picked: drill-in detail page with back button.
  if (isSmallScreen && activeDef) {
    return (
      <div className="settings-page">
        <header className="settings-header settings-header--sub">
          <BackButton to="/settings" title="Back to Settings" />
          <h1>{activeDef.label}</h1>
        </header>
        <main className="settings-content">
          <p className="settings-detail-description">{activeDef.description}</p>
          <div className="settings-detail-content">
            <SectionContent
              id={activeDef.id}
              updateChecker={updateChecker}
              highlightCondensed={highlightCondensed}
            />
          </div>
        </main>
      </div>
    );
  }

  // Desktop: rail + detail pane.
  return (
    <div className="settings-page">
      <header className="settings-header settings-header--root">
        <BackButton to="/mrs" title="Back to MRs" />
        <h1>Settings</h1>
      </header>
      <div className="settings-body">
        <nav className="settings-rail" aria-label="Settings sections">
          {groups.map((group) => (
            <div className="settings-rail-group" key={group.label}>
              <span className="settings-group-eyebrow">{group.label}</span>
              {group.sections.map((s) => (
                <Link
                  key={s.id}
                  to={`/settings/${s.id}`}
                  className={`settings-rail-item${s.id === activeId ? ' active' : ''}`}
                  aria-current={s.id === activeId ? 'page' : undefined}
                >
                  <span className="settings-rail-label">{s.label}</span>
                  {values[s.id] && (
                    <span className={`settings-value${s.id === 'updates' && updateAvailable ? ' settings-value--accent' : ''}`}>
                      {values[s.id]}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        {activeDef && (
          <main className="settings-detail" key={activeDef.id}>
            <header className="settings-detail-header">
              <h2>{activeDef.label}</h2>
              <p>{activeDef.description}</p>
            </header>
            <div className="settings-detail-content">
              <SectionContent
                id={activeDef.id}
                updateChecker={updateChecker}
                highlightCondensed={highlightCondensed}
              />
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
