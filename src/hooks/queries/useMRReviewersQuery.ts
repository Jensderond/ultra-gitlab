import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getMrReviewers } from '../../services/tauri';

export function useMRReviewersQuery(mrId: number) {
  return useQuery({
    queryKey: queryKeys.mrReviewers(mrId),
    queryFn: () => getMrReviewers(mrId),
    enabled: mrId > 0,
  });
}
