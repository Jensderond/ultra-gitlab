import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getDiffRefs } from '../../services/gitlab';

export function useDiffRefsQuery(mrId: number) {
  return useQuery({
    queryKey: queryKeys.mrDiffRefs(mrId),
    queryFn: () => getDiffRefs(mrId),
    enabled: mrId > 0,
  });
}
