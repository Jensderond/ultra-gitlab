import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addIssueNote,
  getCachedIssueDetail,
  listCachedIssueNotes,
  listIssueAssigneeCandidates,
  refreshIssueDetail,
  setIssueAssignees,
  setIssueState,
} from '../../services/tauri';
import { queryKeys } from '../../lib/queryKeys';
import type { IssueAssigneeCandidate, IssueNote, IssueWithProject } from '../../types';

/**
 * Read the issue from SQLite. Returns `null` when nothing is cached for this
 * issue yet (first-ever visit) — the view distinguishes that from a loaded row.
 */
export function useIssueDetailQuery(
  instanceId: number | null,
  projectId: number,
  issueIid: number,
) {
  return useQuery<IssueWithProject | null>({
    queryKey:
      instanceId == null
        ? ['issue', 'disabled']
        : queryKeys.issue(instanceId, projectId, issueIid),
    queryFn: () => getCachedIssueDetail(instanceId as number, projectId, issueIid),
    enabled: instanceId != null && projectId > 0 && issueIid > 0,
    staleTime: Infinity,
  });
}

/**
 * Read cached notes for the issue.
 */
export function useIssueNotesQuery(
  instanceId: number | null,
  projectId: number,
  issueIid: number,
) {
  return useQuery<IssueNote[]>({
    queryKey:
      instanceId == null
        ? ['issueNotes', 'disabled']
        : queryKeys.issueNotes(instanceId, projectId, issueIid),
    queryFn: () => listCachedIssueNotes(instanceId as number, projectId, issueIid),
    enabled: instanceId != null && projectId > 0 && issueIid > 0,
    staleTime: Infinity,
  });
}

/**
 * Fire a single background refresh for the issue (+ notes). On success,
 * invalidate the cached-read queries so they re-read from SQLite.
 *
 * Exposes `isRefreshing` so the view can show an "updating…" indicator.
 * Network errors are swallowed here (logged only) — an offline user should
 * still see their cached data without a disruptive error banner.
 */
export function useIssueBackgroundRefresh(
  instanceId: number | null,
  projectId: number,
  issueIid: number,
) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => refreshIssueDetail(instanceId as number, projectId, issueIid),
    onSuccess: () => {
      if (instanceId == null) return;
      qc.invalidateQueries({
        queryKey: queryKeys.issue(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.issueNotes(instanceId, projectId, issueIid),
      });
    },
    onError: (err) => {
      console.warn('[issue] background refresh failed', err);
    },
  });

  useEffect(() => {
    if (instanceId == null || projectId <= 0 || issueIid <= 0) return;
    mutation.mutate();
    // Intentionally depend only on identity — we want ONE refresh on mount /
    // when the issue identity changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, projectId, issueIid]);

  return { isRefreshing: mutation.isPending };
}

export function useAssigneeCandidatesQuery(
  instanceId: number | null,
  projectId: number,
  enabled: boolean,
) {
  return useQuery<IssueAssigneeCandidate[]>({
    queryKey:
      instanceId == null
        ? ['issueAssigneeCandidates', 'disabled']
        : queryKeys.issueAssigneeCandidates(instanceId, projectId),
    queryFn: () => listIssueAssigneeCandidates(instanceId as number, projectId),
    enabled: enabled && instanceId != null && projectId > 0,
    staleTime: 60_000,
  });
}

export function useAddIssueNote(
  instanceId: number,
  projectId: number,
  issueIid: number,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addIssueNote(instanceId, projectId, issueIid, body),
    onSuccess: async () => {
      await refreshIssueDetail(instanceId, projectId, issueIid);
      qc.invalidateQueries({
        queryKey: queryKeys.issueNotes(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.issue(instanceId, projectId, issueIid),
      });
    },
  });
}

export function useSetIssueAssignees(
  instanceId: number,
  projectId: number,
  issueIid: number,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assigneeIds: number[]) =>
      setIssueAssignees(instanceId, projectId, issueIid, assigneeIds),
    onSuccess: async () => {
      await refreshIssueDetail(instanceId, projectId, issueIid);
      qc.invalidateQueries({
        queryKey: queryKeys.issue(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({ queryKey: ['issues', String(instanceId)] });
    },
  });
}

export function useSetIssueState(
  instanceId: number,
  projectId: number,
  issueIid: number,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stateEvent: 'close' | 'reopen') =>
      setIssueState(instanceId, projectId, issueIid, stateEvent),
    onSuccess: async () => {
      await refreshIssueDetail(instanceId, projectId, issueIid);
      qc.invalidateQueries({
        queryKey: queryKeys.issue(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.issueNotes(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({ queryKey: ['issues', String(instanceId)] });
    },
  });
}
