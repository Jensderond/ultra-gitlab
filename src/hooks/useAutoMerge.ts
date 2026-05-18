import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  claimAutoMerge,
  getAutoMergeClaim,
  unclaimAutoMerge,
  type AutoMergeClaim,
} from '../services/tauri';

const autoMergeClaimKey = (mrId: number) => ['autoMergeClaim', mrId] as const;

export interface UseAutoMergeResult {
  claim: AutoMergeClaim | null;
  isClaimed: boolean;
  isLoading: boolean;
  setClaimed: (next: boolean) => void;
  toggle: () => void;
  /** True while a claim/unclaim mutation is in flight. */
  isMutating: boolean;
}

/**
 * Hook for reading and toggling the local auto-merge claim for an MR.
 *
 * Claims persist in SQLite and are processed by the background sync engine
 * — this hook just exposes the row to the UI and provides toggle mutations.
 */
export function useAutoMerge(mrId: number): UseAutoMergeResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: autoMergeClaimKey(mrId),
    queryFn: () => getAutoMergeClaim(mrId),
    enabled: mrId > 0,
    staleTime: 0,
  });

  const claimMutation = useMutation({
    mutationFn: () => claimAutoMerge(mrId),
    onSuccess: (claim) => {
      queryClient.setQueryData(autoMergeClaimKey(mrId), claim);
      // The backend kicks the processor right after inserting the claim,
      // so we don't need to trigger anything else here. The auto-merge-updated
      // event will refresh the claim once processing finishes.
    },
  });

  const unclaimMutation = useMutation({
    mutationFn: () => unclaimAutoMerge(mrId),
    onSuccess: () => {
      queryClient.setQueryData(autoMergeClaimKey(mrId), null);
    },
  });

  const setClaimed = useCallback(
    (next: boolean) => {
      if (next) {
        claimMutation.mutate();
      } else {
        unclaimMutation.mutate();
      }
    },
    [claimMutation, unclaimMutation],
  );

  const claim = query.data ?? null;

  const toggle = useCallback(() => {
    if (claim) {
      unclaimMutation.mutate();
    } else {
      claimMutation.mutate();
    }
  }, [claim, claimMutation, unclaimMutation]);

  return {
    claim,
    isClaimed: !!claim,
    isLoading: query.isLoading,
    setClaimed,
    toggle,
    isMutating: claimMutation.isPending || unclaimMutation.isPending,
  };
}
