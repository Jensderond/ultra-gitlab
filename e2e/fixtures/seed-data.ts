/**
 * Seeded mock data for Playwright E2E tests.
 *
 * This file provides deterministic test data that mirrors what the SQLite
 * database would contain. Since Playwright runs in a browser (no Tauri IPC),
 * the app uses companion HTTP mode. We intercept the /api/* routes with
 * this data so tests don't depend on a live GitLab instance.
 */

import type {
  MergeRequest,
  DiffFile,
  DiffRefs,
  DiffHunksResponse,
  DiffHunk,
  Comment,
  MrReviewer,
  Settings,
  SyncStatusResponse,
  PipelineProject,
  PipelineStatus,
  PipelineJob,
  NotificationSettings,
  CompanionServerSettings,
  CompanionStatus,
} from '../../src/types';

// ============================================================================
// GitLab Instances
// ============================================================================

export interface SeedInstance {
  id: number;
  url: string;
  name: string | null;
  createdAt: number;
  sessionCookie: string | null;
  hasToken: boolean;
}

export const instances: SeedInstance[] = [
  {
    id: 1,
    url: 'https://gitlab.example.com',
    name: 'Example GitLab',
    createdAt: 1700000000,
    sessionCookie: null,
    hasToken: true,
  },
];

// ============================================================================
// Merge Requests
// ============================================================================

const now = Math.floor(Date.now() / 1000);

export const mergeRequests: MergeRequest[] = [
  {
    id: 101,
    instanceId: 1,
    iid: 42,
    projectId: 10,
    projectName: 'frontend/web-app',
    title: 'feat: Add dark mode toggle to settings',
    description: 'Implements a theme toggle in the settings panel with system preference detection.',
    authorUsername: 'alice',
    sourceBranch: 'feature/dark-mode',
    targetBranch: 'main',
    state: 'opened',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/merge_requests/42',
    createdAt: now - 86400 * 3,
    updatedAt: now - 3600,
    mergedAt: null,
    approvalStatus: 'pending',
    approvalsRequired: 2,
    approvalsCount: 1,
    labels: ['feature', 'frontend'],
    reviewers: ['bob', 'carol'],
    cachedAt: now,
    userHasApproved: false,
    headPipelineStatus: 'success',
  },
  {
    id: 102,
    instanceId: 1,
    iid: 43,
    projectId: 10,
    projectName: 'frontend/web-app',
    title: 'fix: Resolve login redirect loop',
    description: 'Fixes an infinite redirect when the session token expires during navigation.',
    authorUsername: 'bob',
    sourceBranch: 'fix/login-redirect',
    targetBranch: 'main',
    state: 'opened',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/merge_requests/43',
    createdAt: now - 86400 * 1,
    updatedAt: now - 1800,
    mergedAt: null,
    approvalStatus: 'pending',
    approvalsRequired: 1,
    approvalsCount: 0,
    labels: ['bug', 'auth'],
    reviewers: ['alice'],
    cachedAt: now,
    userHasApproved: false,
    headPipelineStatus: 'success',
  },
  {
    id: 103,
    instanceId: 1,
    iid: 44,
    projectId: 11,
    projectName: 'backend/api-service',
    title: 'refactor: Extract user service from controller',
    description: 'Moves user business logic into a dedicated service layer for better testability.',
    authorUsername: 'carol',
    sourceBranch: 'refactor/user-service',
    targetBranch: 'develop',
    state: 'opened',
    webUrl: 'https://gitlab.example.com/backend/api-service/-/merge_requests/44',
    createdAt: now - 86400 * 5,
    updatedAt: now - 7200,
    mergedAt: null,
    approvalStatus: 'approved',
    approvalsRequired: 2,
    approvalsCount: 2,
    labels: ['refactor', 'backend'],
    reviewers: ['alice', 'dave'],
    cachedAt: now,
    userHasApproved: false,
    headPipelineStatus: 'success',
  },
  {
    id: 104,
    instanceId: 1,
    iid: 45,
    projectId: 10,
    projectName: 'frontend/web-app',
    title: 'Draft: WIP dashboard redesign',
    description: 'Work in progress on the new dashboard layout.',
    authorUsername: 'dave',
    sourceBranch: 'feature/dashboard-v2',
    targetBranch: 'main',
    state: 'opened',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/merge_requests/45',
    createdAt: now - 86400 * 7,
    updatedAt: now - 86400,
    mergedAt: null,
    approvalStatus: null,
    approvalsRequired: 2,
    approvalsCount: 0,
    labels: ['wip', 'frontend'],
    reviewers: [],
    cachedAt: now,
    userHasApproved: false,
    headPipelineStatus: 'running',
  },
];

// My MRs (authored by the current user "testuser")
export const myMergeRequests: MergeRequest[] = [
  {
    id: 201,
    instanceId: 1,
    iid: 50,
    projectId: 10,
    projectName: 'frontend/web-app',
    title: 'feat: Add notification preferences',
    description: 'Adds a UI for configuring push notification preferences.',
    authorUsername: 'testuser',
    sourceBranch: 'feature/notification-prefs',
    targetBranch: 'main',
    state: 'opened',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/merge_requests/50',
    createdAt: now - 86400 * 2,
    updatedAt: now - 600,
    mergedAt: null,
    approvalStatus: 'approved',
    approvalsRequired: 2,
    approvalsCount: 2,
    labels: ['feature'],
    reviewers: ['alice', 'bob'],
    cachedAt: now,
    userHasApproved: false,
    headPipelineStatus: 'success',
  },
  {
    id: 202,
    instanceId: 1,
    iid: 51,
    projectId: 10,
    projectName: 'frontend/web-app',
    title: 'Draft: Experiment with new list virtualization',
    description: null,
    authorUsername: 'testuser',
    sourceBranch: 'experiment/virtual-list',
    targetBranch: 'main',
    state: 'opened',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/merge_requests/51',
    createdAt: now - 86400,
    updatedAt: now - 3600,
    mergedAt: null,
    approvalStatus: 'pending',
    approvalsRequired: 1,
    approvalsCount: 0,
    labels: ['experiment'],
    reviewers: [],
    cachedAt: now,
    userHasApproved: false,
    headPipelineStatus: 'failed',
  },
];

// ============================================================================
// Diff Files (for MR 101)
// ============================================================================

export const diffFiles: Record<number, DiffFile[]> = {
  101: [
    {
      id: 1001,
      mrId: 101,
      oldPath: null,
      newPath: 'src/components/ThemeToggle.tsx',
      changeType: 'added',
      additions: 45,
      deletions: 0,
      filePosition: 0,
    },
    {
      id: 1002,
      mrId: 101,
      oldPath: 'src/App.tsx',
      newPath: 'src/App.tsx',
      changeType: 'modified',
      additions: 12,
      deletions: 3,
      filePosition: 1,
    },
    {
      id: 1003,
      mrId: 101,
      oldPath: 'src/styles/theme.css',
      newPath: 'src/styles/theme.css',
      changeType: 'modified',
      additions: 30,
      deletions: 5,
      filePosition: 2,
    },
  ],
};

// ============================================================================
// Diff Refs
// ============================================================================

export const diffRefsMap: Record<number, DiffRefs> = {
  101: {
    baseSha: 'abc123def456',
    headSha: 'fed654cba321',
    startSha: 'abc123def456',
  },
};

// ============================================================================
// Diff Hunks
// ============================================================================

const sampleHunk: DiffHunk = {
  oldStart: 1,
  oldCount: 5,
  newStart: 1,
  newCount: 8,
  lines: [
    { type: 'context', content: 'import React from "react";', oldLineNumber: 1, newLineNumber: 1 },
    { type: 'context', content: '', oldLineNumber: 2, newLineNumber: 2 },
    { type: 'remove', content: 'function App() {', oldLineNumber: 3, newLineNumber: null },
    { type: 'add', content: 'import { ThemeProvider } from "./ThemeProvider";', oldLineNumber: null, newLineNumber: 3 },
    { type: 'add', content: '', oldLineNumber: null, newLineNumber: 4 },
    { type: 'add', content: 'function App() {', oldLineNumber: null, newLineNumber: 5 },
    { type: 'context', content: '  return (', oldLineNumber: 4, newLineNumber: 6 },
    { type: 'context', content: '    <div className="app">', oldLineNumber: 5, newLineNumber: 7 },
  ],
};

export const diffHunksMap: Record<string, DiffHunksResponse> = {
  '101:src/App.tsx': {
    filePath: 'src/App.tsx',
    hunks: [sampleHunk],
    startIndex: 0,
    totalHunks: 1,
    hasMore: false,
  },
};

// ============================================================================
// Comments
// ============================================================================

export const comments: Record<number, Comment[]> = {
  101: [
    {
      id: 5001,
      mrId: 101,
      discussionId: 'disc-001',
      parentId: null,
      authorUsername: 'bob',
      body: 'Looks good overall! One small suggestion on the theme provider implementation.',
      filePath: null,
      oldLine: null,
      newLine: null,
      resolved: false,
      system: false,
      createdAt: now - 7200,
      updatedAt: now - 7200,
      isLocal: false,
      syncStatus: null,
    },
    {
      id: 5002,
      mrId: 101,
      discussionId: 'disc-002',
      parentId: null,
      authorUsername: 'carol',
      body: 'Could we add a system preference detection here?',
      filePath: 'src/components/ThemeToggle.tsx',
      oldLine: null,
      newLine: 15,
      resolved: false,
      system: false,
      createdAt: now - 3600,
      updatedAt: now - 3600,
      isLocal: false,
      syncStatus: null,
    },
  ],
};

// ============================================================================
// Reviewers
// ============================================================================

export const reviewers: Record<number, MrReviewer[]> = {
  101: [
    { mrId: 101, username: 'bob', status: 'approved', cachedAt: now },
    { mrId: 101, username: 'carol', status: 'pending', cachedAt: now },
  ],
};

// ============================================================================
// Sync Status
// ============================================================================

export const syncStatus: SyncStatusResponse = {
  isSyncing: false,
  lastSyncTime: now,
  nextSyncTime: now + 300,
  pendingActions: 0,
  failedActions: 0,
  recentLogs: [],
  cacheSizeBytes: 1024 * 1024 * 10,
  cacheSizeWarning: false,
};

// ============================================================================
// Settings
// ============================================================================

export const settings: Settings = {
  syncIntervalMinutes: 5,
  theme: 'kanagawa-wave',
  uiFont: 'system-ui',
  displayFont: 'monospace',
  keyboardShortcuts: {},
  diffViewMode: 'split',
  collapsePatterns: ['*.lock', 'package-lock.json'],
};

// ============================================================================
// Pipeline Data
// ============================================================================

export const pipelineProjects: PipelineProject[] = [
  {
    projectId: 10,
    instanceId: 1,
    pinned: true,
    lastVisitedAt: new Date().toISOString(),
    sortOrder: 0,
    name: 'web-app',
    nameWithNamespace: 'frontend / web-app',
    pathWithNamespace: 'frontend/web-app',
    webUrl: 'https://gitlab.example.com/frontend/web-app',
  },
];

export const pipelineStatuses: PipelineStatus[] = [
  {
    id: 3001,
    projectId: 10,
    status: 'success',
    refName: 'main',
    sha: 'abc123',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/pipelines/3001',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date().toISOString(),
    duration: 245,
  },
];

export const pipelineJobs: PipelineJob[] = [
  {
    id: 7001,
    name: 'lint',
    stage: 'test',
    status: 'success',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/jobs/7001',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: new Date(Date.now() - 3500000).toISOString(),
    finishedAt: new Date(Date.now() - 3400000).toISOString(),
    duration: 100,
    queuedDuration: 5,
    allowFailure: false,
    runnerDescription: 'shared-runner-01',
  },
  {
    id: 7002,
    name: 'test',
    stage: 'test',
    status: 'success',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/jobs/7002',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: new Date(Date.now() - 3500000).toISOString(),
    finishedAt: new Date(Date.now() - 3200000).toISOString(),
    duration: 300,
    queuedDuration: 5,
    allowFailure: false,
    runnerDescription: 'shared-runner-02',
  },
];

// ============================================================================
// Notification & Companion
// ============================================================================

export const notificationSettings: NotificationSettings = {
  mrReadyToMerge: true,
  pipelineStatusPinned: true,
  nativeNotificationsEnabled: false,
};

export const companionStatus: CompanionStatus = {
  enabled: false,
  connectedDevices: 0,
};

export const companionSettings: CompanionServerSettings = {
  enabled: false,
  port: 8080,
  pin: '1234',
  authorizedDevices: [],
};
