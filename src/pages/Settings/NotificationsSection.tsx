import { useState, useEffect } from 'react';
import { getNotificationSettings, updateNotificationSettings, sendNativeNotification } from '../../services/tauri';
import type { NotificationSettings } from '../../types';
import { useToast } from '../../components/Toast';

/**
 * Notification settings section.
 */
export default function NotificationsSection() {
  const { addToast } = useToast();
  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadNotificationSettings();
  }, []);

  async function loadNotificationSettings() {
    try {
      setLoading(true);
      const settings = await getNotificationSettings();
      setNotifSettings(settings);
    } catch (err) {
      console.error('Failed to load notification settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleNotifToggle(field: keyof NotificationSettings, checked: boolean) {
    if (!notifSettings) return;
    const newSettings = { ...notifSettings, [field]: checked };
    setNotifSettings(newSettings);
    try {
      setSaving(true);
      await updateNotificationSettings(newSettings);
    } catch (err) {
      console.error('Failed to save notification settings:', err);
      setNotifSettings(notifSettings);
    } finally {
      setSaving(false);
    }
  }

  function handleTestNotification() {
    addToast({
      type: 'mr-ready',
      title: 'MR Ready to Merge',
      body: 'feat: add notifications — My Project',
      url: 'https://gitlab.com',
    });
    if (notifSettings?.nativeNotificationsEnabled) {
      sendNativeNotification('MR Ready to Merge', 'feat: add notifications — My Project').catch(() => {});
    }
  }

  return (
    <section className="settings-section">
      <div className="section-header">
        <h2>Notifications</h2>
        <button
          className="add-button"
          onClick={handleTestNotification}
        >
          Test Notification
        </button>
      </div>

      {loading ? (
        <p className="loading">Loading settings...</p>
      ) : notifSettings ? (
        <div className="sync-settings-form">
          <div className="checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={notifSettings.mrReadyToMerge}
                onChange={(e) => handleNotifToggle('mrReadyToMerge', e.target.checked)}
                disabled={saving}
              />
              <span>
                MR ready to merge
                <span className="checkbox-description">Notify when your MR has all approvals and pipeline passed</span>
              </span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={notifSettings.pipelineStatusPinned}
                onChange={(e) => handleNotifToggle('pipelineStatusPinned', e.target.checked)}
                disabled={saving}
              />
              <span>
                Pipeline status (pinned projects)
                <span className="checkbox-description">Notify when a pinned project pipeline status changes</span>
              </span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={notifSettings.nativeNotificationsEnabled}
                onChange={(e) => handleNotifToggle('nativeNotificationsEnabled', e.target.checked)}
                disabled={saving}
              />
              <span>
                Native OS notifications
                <span className="checkbox-description">Show notifications in macOS Notification Center</span>
              </span>
            </label>
          </div>

          {saving && (
            <p className="saving-indicator">Saving...</p>
          )}
        </div>
      ) : (
        <p className="error-message">Failed to load notification settings</p>
      )}
    </section>
  );
}
