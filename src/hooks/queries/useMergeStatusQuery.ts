import { useQuery } from '@tanstack/react-query';
import { checkMergeStatus } from '../../services/tauri';

/**
 * Fetch the live `detailed_merge_status` for an MR from GitLab.
 *
 * Drives the conditional Rebase/Merge buttons on the list — we
 * don't want to ask GitLab for every row up-front, so the query is gated by
 * `enabled` (typically: row is focused) and cached briefly.
 */
export function useMergeStatusQuery(mrId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['mergeStatus', mrId],
    queryFn: () => checkMergeStatus(mrId),
    enabled,
    staleTime: 15_000,
    gcTime: 60_000,
  });
}
