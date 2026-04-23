import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { invoke } from '../../services/tauri';

interface SyncConfig {
  interval_secs: number;
  max_mrs_per_sync: number;
  issue_interval_secs: number;
}

export function useSyncSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.syncSettings(),
    queryFn: async () => {
      const settings = await invoke<{ sync: SyncConfig }>('get_settings');
      return settings.sync;
    },
  });
}
