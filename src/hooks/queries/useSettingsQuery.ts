import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getSettings } from '../../services/tauri';

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: getSettings,
  });
}
