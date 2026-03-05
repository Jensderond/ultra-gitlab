import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { invoke } from '../../services/tauri';

interface SyncConfig {
  interval_secs: number;
  sync_authored: boolean;
  sync_reviewing: boolean;
  max_mrs_per_sync: number;
}

export function useUpdateSyncSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (syncConfig: SyncConfig) =>
      invoke<void>('update_sync_settings', { syncConfig }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}
