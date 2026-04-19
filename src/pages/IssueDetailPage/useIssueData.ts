import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getIssueDetail,
  listIssueNotes,
  addIssueNote,
  setIssueAssignees,
  setIssueState,
  listIssueAssigneeCandidates,
} from '../../services/tauri';
import { queryKeys } from '../../lib/queryKeys';
import type { IssueAssigneeCandidate, IssueNote, IssueWithProject } from '../../types';

export function useIssueDetailQuery(
  instanceId: number | null,
  projectId: number,
  issueIid: number,
) {
  return useQuery<IssueWithProject>({
    queryKey:
      instanceId == null
        ? ['issue', 'disabled']
        : queryKeys.issue(instanceId, projectId, issueIid),
    queryFn: () => getIssueDetail(instanceId as number, projectId, issueIid),
    enabled: instanceId != null && projectId > 0 && issueIid > 0,
  });
}

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
    queryFn: () => listIssueNotes(instanceId as number, projectId, issueIid),
    enabled: instanceId != null && projectId > 0 && issueIid > 0,
  });
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
    onSuccess: () => {
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
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.issue(instanceId, projectId, issueIid), data);
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
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.issue(instanceId, projectId, issueIid), data);
      qc.invalidateQueries({
        queryKey: queryKeys.issueNotes(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({ queryKey: ['issues', String(instanceId)] });
    },
  });
}
