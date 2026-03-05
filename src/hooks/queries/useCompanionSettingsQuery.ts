import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getCompanionSettings } from '../../services/tauri';

export function useCompanionSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.companionSettings(),
    queryFn: getCompanionSettings,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}
