import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { listMergeRequests } from '../../services/gitlab';

export function useMRListQuery(instanceId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.mrList(String(instanceId ?? '')),
    queryFn: () => listMergeRequests(instanceId!),
    enabled: !!instanceId,
  });
}
