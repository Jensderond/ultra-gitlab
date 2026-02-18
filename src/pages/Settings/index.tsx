/**
 * Settings page orchestrator.
 *
 * Composes all settings sub-sections into the full settings page.
 */

import BackButton from '../../components/BackButton';
import { isTauri } from '../../services/transport';
import type { UpdateCheckerState } from '../../hooks/useUpdateChecker';
import UpdatesSection from './UpdatesSection';
import InstancesSection from './InstancesSection';
import SyncSettingsSection from './SyncSettingsSection';
import CompanionServerSection from './CompanionServerSection';
import AppearanceSection from './AppearanceSection';
import NotificationsSection from './NotificationsSection';
import CollapsePatternsEditor from './CollapsePatternsEditor';
import ShortcutEditor from './ShortcutEditor';
import '../Settings.css';

interface SettingsProps {
  updateChecker?: UpdateCheckerState;
}

/**
 * Settings page for managing GitLab instances and application preferences.
 */
export default function Settings({ updateChecker }: SettingsProps) {
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

        <InstancesSection />

        <SyncSettingsSection />

        {isTauri && (
          <section className="settings-section">
            <CompanionServerSection />
          </section>
        )}

        <section className="settings-section">
          <AppearanceSection />
        </section>

        {isTauri && <NotificationsSection />}

        {isTauri && (
          <section className="settings-section">
            <CollapsePatternsEditor />
          </section>
        )}

        {isTauri && (
          <section className="settings-section">
            <ShortcutEditor />
          </section>
        )}
      </main>
    </div>
  );
}
