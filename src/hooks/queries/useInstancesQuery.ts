import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { listInstances } from '../../services/gitlab';

export function useInstancesQuery() {
  return useQuery({
    queryKey: queryKeys.instances(),
    queryFn: listInstances,
    staleTime: 60_000,
  });
}
