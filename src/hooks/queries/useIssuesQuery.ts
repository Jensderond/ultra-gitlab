import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { listCachedIssues, listIssueProjects } from '../../services/tauri';

export type IssueScope = 'all' | 'assigned' | 'starred';

export function useIssuesQuery(
  instanceId: number | undefined,
  scope: IssueScope,
  projectId: number | 'all',
) {
  return useQuery({
    queryKey: queryKeys.issues(String(instanceId ?? ''), scope, projectId),
    queryFn: () =>
      listCachedIssues(instanceId!, {
        projectId: projectId === 'all' ? undefined : projectId,
        onlyAssignedToMe: scope === 'assigned',
        onlyStarred: scope === 'starred',
      }),
    enabled: !!instanceId,
  });
}

export function useIssueProjectsQuery(instanceId: number | undefined) {
  return useQuery({
    queryKey: queryKeys.issueProjects(String(instanceId ?? '')),
    queryFn: () => listIssueProjects(instanceId!),
    enabled: !!instanceId,
  });
}
