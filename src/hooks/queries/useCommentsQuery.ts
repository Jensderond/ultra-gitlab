import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getComments } from '../../services/tauri';

export function useCommentsQuery(mrId: number) {
  return useQuery({
    queryKey: queryKeys.mrComments(mrId),
    queryFn: () => getComments(mrId),
    enabled: !!mrId,
  });
}
