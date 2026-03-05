import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getMergeRequestById } from '../../services/gitlab';

export function useMRDetailQuery(mrId: number) {
  return useQuery({
    queryKey: queryKeys.mr(mrId),
    queryFn: () => getMergeRequestById(mrId),
    enabled: mrId > 0,
  });
}
