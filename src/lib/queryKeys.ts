export const queryKeys = {
  instances: () => ["instances"] as const,
  settings: () => ["settings"] as const,
  collapsePatterns: () => ["collapsePatterns"] as const,
  notificationSettings: () => ["notificationSettings"] as const,
  mrList: (instanceId: string) => ["mrList", instanceId] as const,
  myMRList: (instanceId: string) => ["myMRList", instanceId] as const,
  mr: (mrId: number) => ["mr", mrId] as const,
  mrFiles: (mrId: number) => ["mrFiles", mrId] as const,
  mrDiffRefs: (mrId: number) => ["mrDiffRefs", mrId] as const,
  mrComments: (mrId: number) => ["mrComments", mrId] as const,
  mrFileComments: (mrId: number, filePath: string) =>
    ["mrFileComments", mrId, filePath] as const,
  mrReviewers: (mrId: number) => ["mrReviewers", mrId] as const,
  fileContent: (
    instanceId: string,
    projectId: number,
    filePath: string,
    sha: string
  ) => ["fileContent", instanceId, projectId, filePath, sha] as const,
  fileContentBase64: (
    instanceId: string,
    projectId: number,
    filePath: string,
    sha: string
  ) => ["fileContentBase64", instanceId, projectId, filePath, sha] as const,
  gitattributes: (instanceId: string, projectId: number) =>
    ["gitattributes", instanceId, projectId] as const,
  issues: (
    instanceId: string,
    scope: "all" | "assigned" | "starred",
    projectId: number | "all",
  ) => ["issues", instanceId, scope, projectId] as const,
  issueProjects: (instanceId: string) => ["issueProjects", instanceId] as const,
  issue: (instanceId: number, projectId: number, issueIid: number) =>
    ["issue", instanceId, projectId, issueIid] as const,
  issueNotes: (instanceId: number, projectId: number, issueIid: number) =>
    ["issueNotes", instanceId, projectId, issueIid] as const,
  issueAssigneeCandidates: (instanceId: number, projectId: number) =>
    ["issueAssigneeCandidates", instanceId, projectId] as const,
  pipelineProjects: (instanceId: string) =>
    ["pipelineProjects", instanceId] as const,
  pipelineStatuses: (instanceId: string, projectIds: number[]) =>
    ["pipelineStatuses", instanceId, projectIds] as const,
  pipelineJobs: (instanceId: string, projectId: number, pipelineId: number) =>
    ["pipelineJobs", instanceId, projectId, pipelineId] as const,
  pipelineHistory: (instanceId: string, projectId: number) =>
    ["pipelineHistory", instanceId, projectId] as const,
  jobTrace: (instanceId: string, projectId: number, jobId: number) =>
    ["jobTrace", instanceId, projectId, jobId] as const,
  companionStatus: () => ["companionStatus"] as const,
  companionSettings: () => ["companionSettings"] as const,
  syncSettings: () => ["syncSettings"] as const,
};
