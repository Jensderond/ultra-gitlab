import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { queryKeys } from '../../lib/queryKeys';
import { listMyMergeRequests } from '../../services/tauri';
import { pendingMerges } from '../../lib/pendingMerges';

export function useMyMRListQuery(instanceId: number | undefined) {
  const pending = useSyncExternalStore(
    pendingMerges.subscribe,
    pendingMerges.getSnapshot,
    pendingMerges.getSnapshot,
  );
  const query = useQuery({
    queryKey: queryKeys.myMRList(String(instanceId ?? '')),
    queryFn: () => listMyMergeRequests(instanceId!),
    enabled: !!instanceId,
  });
  return {
    ...query,
    data: pending.size > 0 ? query.data?.filter((mr) => !pending.has(mr.id)) : query.data,
  };
}
