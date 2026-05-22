import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { queryKeys } from '../../lib/queryKeys';
import { listMyMergeRequests } from '../../services/tauri';
import { pendingMerges } from '../../lib/pendingMerges';

export function useMyMRListQuery(
  instanceId: number | undefined,
  includeRecentlyMerged: boolean = false,
) {
  const pending = useSyncExternalStore(
    pendingMerges.subscribe,
    pendingMerges.getSnapshot,
    pendingMerges.getSnapshot,
  );
  const query = useQuery({
    queryKey: queryKeys.myMRList(String(instanceId ?? ''), includeRecentlyMerged),
    queryFn: () => listMyMergeRequests(instanceId!, includeRecentlyMerged),
    enabled: !!instanceId,
  });
  return {
    ...query,
    data: pending.size > 0 ? query.data?.filter((mr) => !pending.has(mr.id)) : query.data,
  };
}
