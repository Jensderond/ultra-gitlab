/**
 * Settings page orchestrator.
 *
 * Composes all settings sub-sections into the full settings page.
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import BackButton from '../../components/BackButton';
import { isTauri } from '../../services/transport';
import { getNotificationSettings } from '../../services/tauri';
import type { UpdateCheckerState } from '../../hooks/useUpdateChecker';
import type { NotificationSettings } from '../../types';
import { useSyncSettingsQuery } from '../../hooks/queries/useSyncSettingsQuery';
import useTheme from '../../hooks/useTheme';
import CollapsibleSection from './CollapsibleSection';
import UpdatesSection from './UpdatesSection';
import InstancesSection from './InstancesSection';
import SyncSettingsSection from './SyncSettingsSection';
import CompanionServerSection from './CompanionServerSection';
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

/**
 * Settings page for managing GitLab instances and application preferences.
 */
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

export default function Settings({ updateChecker }: SettingsProps) {
  const syncQuery = useSyncSettingsQuery();
  const { theme } = useTheme();
  const notifSubtitle = useNotificationSubtitle();
  const location = useLocation();
  const highlight = new URLSearchParams(location.search).get('highlight');
  const highlightCondensed = highlight === 'condensed-mr-list';

  const syncSubtitle = syncQuery.data
    ? SYNC_INTERVAL_LABELS[syncQuery.data.interval_secs] ?? `${syncQuery.data.interval_secs}s`
    : undefined;

  return (
    <div className="settings-page">
      <header className="settings-header">
        <BackButton to="/mrs" title="Back to MRs" />
        <h1>Settings</h1>
      </header>

      <main className="settings-content">
        {isTauri && updateChecker && (
          <UpdatesSection updateChecker={updateChecker} />
        )}

        <CollapsibleSection title="GitLab Instances" defaultOpen>
          <InstancesSection />
        </CollapsibleSection>

        <CollapsibleSection title="Sync Settings" subtitle={syncSubtitle}>
          <SyncSettingsSection />
        </CollapsibleSection>

        {isTauri && (
          <CollapsibleSection title={<>Companion Server <span className="beta-badge">Beta</span></>}>
            <CompanionServerSection />
          </CollapsibleSection>
        )}

        {isTauri && (
          <CollapsibleSection title="Command Line">
            <CliSection />
          </CollapsibleSection>
        )}

        <CollapsibleSection title="Appearance" subtitle={theme.name} defaultOpen={highlightCondensed}>
          <AppearanceSection highlightCondensed={highlightCondensed} />
        </CollapsibleSection>

        {isTauri && (
          <CollapsibleSection title="Notifications" subtitle={notifSubtitle}>
            <NotificationsSection />
          </CollapsibleSection>
        )}

        {isTauri && (
          <CollapsibleSection title="Generated File Patterns">
            <CollapsePatternsEditor />
          </CollapsibleSection>
        )}

        {isTauri && (
          <CollapsibleSection title="File Navigation">
            <NavigationSection />
          </CollapsibleSection>
        )}

        {isTauri && (
          <CollapsibleSection title="Keyboard Shortcuts">
            <ShortcutEditor />
          </CollapsibleSection>
        )}
      </main>
    </div>
  );
}
