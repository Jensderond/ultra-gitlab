import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getMergeRequestFiles } from '../../services/gitlab';

export function useDiffFilesQuery(mrId: number) {
  return useQuery({
    queryKey: queryKeys.mrFiles(mrId),
    queryFn: () => getMergeRequestFiles(mrId),
    enabled: mrId > 0,
  });
}
