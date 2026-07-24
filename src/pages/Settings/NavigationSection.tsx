import { useState } from 'react';
import { useSettingsQuery } from '../../hooks/queries/useSettingsQuery';
import { saveSettings } from '../../services/storage';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { DEFAULT_FILE_JUMP_COUNT } from '../../utils/fileNavigation';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

const JUMP_OPTIONS = [2, 3, 5, 10, 15, 20];

export default function NavigationSection() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useSettingsQuery();
  const [saving, setSaving] = useState(false);

  const currentValue = settings?.fileJumpCount ?? DEFAULT_FILE_JUMP_COUNT;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = parseInt(e.target.value, 10);
    try {
      setSaving(true);
      await saveSettings({ fileJumpCount: value });
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    } catch (err) {
      console.error('Failed to save file jump count:', err);
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return null;

  return (
    <SettingsGroup footer="Use ← / → arrow keys in the diff viewer to jump multiple files at once.">
      <SettingsRow label="Arrow key jump distance" htmlFor="file-jump-count">
        <select
          id="file-jump-count"
          value={currentValue}
          onChange={handleChange}
          disabled={saving}
        >
          {JUMP_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} files
            </option>
          ))}
        </select>
      </SettingsRow>
    </SettingsGroup>
  );
}
