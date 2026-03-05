import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { listMyMergeRequests } from '../../services/tauri';

export function useMyMRListQuery(instanceId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.myMRList(String(instanceId ?? '')),
    queryFn: () => listMyMergeRequests(instanceId!),
    enabled: !!instanceId,
  });
}
