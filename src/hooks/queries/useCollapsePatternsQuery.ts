import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getCollapsePatterns } from '../../services/tauri';

export function useCollapsePatternsQuery() {
  return useQuery({
    queryKey: queryKeys.collapsePatterns(),
    queryFn: getCollapsePatterns,
  });
}
