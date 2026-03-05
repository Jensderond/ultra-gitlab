import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getGitattributesPatterns } from '../../services/gitlab';

export function useGitattributesQuery(instanceId: number, projectId: number) {
  return useQuery({
    queryKey: queryKeys.gitattributes(String(instanceId), projectId),
    queryFn: () => getGitattributesPatterns(instanceId, projectId),
    staleTime: 10 * 60_000,
    enabled: !!instanceId && !!projectId,
  });
}
