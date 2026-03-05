import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getCompanionStatus } from '../../services/tauri';

export function useCompanionStatusQuery() {
  return useQuery({
    queryKey: queryKeys.companionStatus(),
    queryFn: getCompanionStatus,
    refetchInterval: 30_000,
  });
}
