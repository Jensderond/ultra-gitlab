import { useQueries } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { listMyMergeRequests } from '../../services/tauri';
import { useInstancesQuery } from './useInstancesQuery';

export function useHasApprovedMRsQuery(): boolean {
  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];

  const results = useQueries({
    queries: instances.map((instance) => ({
      queryKey: queryKeys.myMRList(String(instance.id)),
      queryFn: () => listMyMergeRequests(instance.id),
    })),
  });

  return results.some((result) =>
    result.data?.some((mr) => mr.approvalStatus === 'approved')
  );
}
