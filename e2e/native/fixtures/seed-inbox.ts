/**
 * Inbox seed data: extra merge requests across more projects so the review
 * inbox has realistic groups, tags and views (returned, ready, snoozed,
 * approved by me, merged recently). Kept apart from `seed-data.ts`;
 * `tauri-mock.ts` appends these to the shared lists.
 *
 * Head pipelines per MR reuse the pipelines feature's histories, so MR 101's
 * head pipeline is #3010 — the Jest failure through ThemeToggle.tsx.
 */

import type { Comment, DiffFile, MergeRequest, MrReviewer, PipelineStatus } from '../../src/api/types';
import { projectPipelines } from './seed-pipelines';

const now = Math.floor(Date.now() / 1000);
const H = 3600;
const D = 86400;

function mr(
  partial: Partial<MergeRequest> & Pick<MergeRequest, 'id' | 'iid' | 'projectId' | 'projectName' | 'title' | 'authorUsername' | 'sourceBranch'>,
): MergeRequest {
  const path = partial.projectName.replace(/\s*\/\s*/g, '/');
  return {
    instanceId: 1,
    description: null,
    targetBranch: 'main',
    state: 'opened',
    webUrl: `https://gitlab.example.com/${path}/-/merge_requests/${partial.iid}`,
    createdAt: now - H,
    updatedAt: now - H,
    mergedAt: null,
    approvalStatus: 'pending',
    approvalsRequired: 1,
    approvalsCount: 0,
    labels: [],
    reviewers: [],
    cachedAt: now,
    userHasApproved: false,
    headPipelineStatus: 'success',
    snoozedUntil: null,
    ...partial,
  };
}

const tomorrowNine = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
})();

/** Appended to `get_merge_requests` (MRs I review). */
export const extraReviewMRs: MergeRequest[] = [
  mr({
    id: 105,
    iid: 88,
    projectId: 12,
    projectName: 'backend/api-gateway',
    title: 'Cache tags for the news feed endpoint',
    description:
      'Tags every cached feed response with the source ids so an edit only purges the pages that show it.\n\n- Adds `CacheTags` middleware\n- Purges by tag from the webhook handler',
    authorUsername: 'bob',
    sourceBranch: 'feature/feed-cache-tags',
    createdAt: now - 35 * 60,
    updatedAt: now - 10 * 60,
    reviewers: ['testuser', 'carol'],
    headPipelineStatus: 'running',
  }),
  mr({
    id: 106,
    iid: 85,
    projectId: 12,
    projectName: 'backend/api-gateway',
    title: 'Upgrade to Node 22 LTS',
    description: 'Moves the gateway to Node 22 and refreshes the lockfile.',
    authorUsername: 'carol',
    sourceBranch: 'chore/node-22',
    createdAt: now - 6 * D,
    updatedAt: now - 2 * D,
    approvalsRequired: 2,
    approvalsCount: 1,
    reviewers: ['testuser', 'alice', 'dave'],
  }),
  mr({
    id: 107,
    iid: 41,
    projectId: 13,
    projectName: 'mobile/ios-app',
    title: 'Fix rounding in VAT summary',
    description: 'Rounds per line before summing, matching the invoice PDF.',
    authorUsername: 'dave',
    sourceBranch: 'fix/vat-rounding',
    createdAt: now - 4 * H,
    updatedAt: now - 3 * H,
    reviewers: ['testuser'],
  }),
  mr({
    id: 108,
    iid: 12,
    projectId: 15,
    projectName: 'internal/handbook',
    title: 'Document the release checklist',
    authorUsername: 'erin',
    sourceBranch: 'docs/release-checklist',
    createdAt: now - 2 * D,
    updatedAt: now - D,
    reviewers: ['testuser'],
    approvalsRequired: 0,
    headPipelineStatus: null,
    snoozedUntil: tomorrowNine,
  }),
  mr({
    id: 109,
    iid: 86,
    projectId: 12,
    projectName: 'backend/api-gateway',
    title: 'Retry webhooks with exponential backoff',
    authorUsername: 'alice',
    sourceBranch: 'feature/webhook-backoff',
    createdAt: now - 3 * D,
    updatedAt: now - 5 * H,
    reviewers: ['testuser', 'dave'],
    approvalsRequired: 2,
    approvalsCount: 1,
    userHasApproved: true,
  }),
];

/** Appended to `list_my_merge_requests`. */
export const extraMyMRs: MergeRequest[] = [
  mr({
    id: 203,
    iid: 90,
    projectId: 12,
    projectName: 'backend/api-gateway',
    title: 'Rate limit per API token instead of per IP',
    description: 'Keys the limiter on the token so shared office IPs stop tripping it.',
    authorUsername: 'testuser',
    sourceBranch: 'feature/token-rate-limit',
    createdAt: now - 2 * D,
    updatedAt: now - 2 * H,
    approvalStatus: 'changes_requested',
    approvalsRequired: 2,
    approvalsCount: 1,
    reviewers: ['carol', 'dave'],
  }),
  mr({
    id: 204,
    iid: 49,
    projectId: 10,
    projectName: 'frontend/web-app',
    title: 'Bump eslint to v9 and flat config',
    authorUsername: 'testuser',
    sourceBranch: 'chore/eslint-9',
    state: 'merged',
    createdAt: now - 3 * D,
    updatedAt: now - 3 * H,
    mergedAt: now - 3 * H,
    approvalStatus: 'approved',
    approvalsCount: 1,
    reviewers: ['alice'],
  }),
];

/* Diff files ------------------------------------------------------------- */

let fileId = 20_000;
const files = (mrId: number, list: [string, number, number, DiffFile['changeType']?][]): DiffFile[] =>
  list.map(([newPath, additions, deletions, changeType = 'modified'], i) => ({
    id: fileId++,
    mrId,
    oldPath: changeType === 'added' ? null : newPath,
    newPath,
    changeType,
    additions,
    deletions,
    filePosition: i,
  }));

const nodeUpgrade: [string, number, number][] = [
  ['package.json', 14, 12],
  ['package-lock.json', 640, 512],
  ['.nvmrc', 1, 1],
  ['Dockerfile', 3, 3],
  ['.gitlab-ci.yml', 6, 6],
  ...Array.from({ length: 56 }, (_, i): [string, number, number] => [
    `src/${['routes', 'middleware', 'services', 'lib'][i % 4]}/${['auth', 'feed', 'users', 'billing', 'search', 'health', 'tokens'][i % 7]}${i}.ts`,
    5 + ((i * 7) % 13),
    4 + ((i * 5) % 11),
  ]),
  ['dist/server.js', 210, 180],
  ['dist/server.js.map', 1, 1],
];

/** Merged into the shared `diffFiles` map (ids without files there yet). */
export const extraDiffFiles: Record<number, DiffFile[]> = {
  102: files(102, [
    ['src/auth/session.ts', 18, 6],
    ['src/auth/redirect.ts', 9, 4],
    ['src/auth/redirect.test.ts', 31, 0, 'added'],
  ]),
  103: files(103, [
    ['app/Http/Controllers/UserController.php', 12, 96],
    ['app/Services/UserService.php', 118, 0, 'added'],
    ['tests/Unit/UserServiceTest.php', 74, 0, 'added'],
    ['config/services.php', 3, 0],
  ]),
  104: files(104, [
    ['src/pages/Dashboard.tsx', 140, 62],
    ['src/components/Widget.tsx', 88, 0, 'added'],
    ['src/styles/dashboard.css', 52, 10],
  ]),
  105: files(105, [
    ['src/middleware/cacheTags.ts', 24, 0, 'added'],
    ['src/routes/feed.ts', 9, 7],
    ['src/webhooks/purge.ts', 6, 5],
    ['config/cache.yml', 2, 0],
  ]),
  106: files(106, nodeUpgrade),
  107: files(107, [
    ['Sources/Billing/VatSummary.swift', 8, 6],
    ['Tests/BillingTests/VatSummaryTests.swift', 4, 3],
  ]),
  109: files(109, [
    ['src/webhooks/deliver.ts', 44, 12],
    ['src/webhooks/backoff.ts', 27, 0, 'added'],
  ]),
  201: files(201, [
    ['src/settings/Notifications.tsx', 96, 4, 'added'],
    ['src/settings/index.tsx', 6, 1],
    ['src/api/notifications.ts', 22, 0, 'added'],
  ]),
  203: files(203, [
    ['src/middleware/rateLimit.ts', 38, 21],
    ['src/middleware/rateLimit.test.ts', 52, 8],
    ['docs/rate-limits.md', 12, 2],
  ]),
};

/* Reviewers & comments ----------------------------------------------------- */

const rv = (mrId: number, username: string, status: MrReviewer['status']): MrReviewer => ({
  mrId,
  username,
  status,
  cachedAt: now,
});

export const extraReviewers: Record<number, MrReviewer[]> = {
  105: [rv(105, 'testuser', 'pending'), rv(105, 'carol', 'pending')],
  106: [rv(106, 'testuser', 'pending'), rv(106, 'alice', 'approved'), rv(106, 'dave', 'pending')],
  107: [rv(107, 'testuser', 'pending')],
  109: [rv(109, 'testuser', 'approved'), rv(109, 'dave', 'pending')],
  203: [rv(203, 'carol', 'changes_requested'), rv(203, 'dave', 'approved')],
};

let noteId = 40_000;
const note = (mrId: number, discussionId: string, author: string, body: string, opts: Partial<Comment> = {}): Comment => ({
  id: noteId++,
  mrId,
  discussionId,
  parentId: null,
  authorUsername: author,
  body,
  filePath: null,
  oldLine: null,
  newLine: null,
  resolved: false,
  system: false,
  createdAt: now - H,
  updatedAt: now - H,
  isLocal: false,
  lineType: null,
  resolvable: true,
  syncStatus: 'synced',
  ...opts,
});

export const extraComments: Record<number, Comment[]> = {
  105: [note(105, 'd-105-1', 'carol', 'Do we need to purge on unpublish as well?', { filePath: 'src/webhooks/purge.ts', newLine: 14 })],
  203: [
    note(203, 'd-203-1', 'carol', 'This still keys anonymous requests on the IP — intended?', {
      filePath: 'src/middleware/rateLimit.ts',
      newLine: 31,
    }),
    note(203, 'd-203-2', 'dave', 'Nit: document the new header.', { filePath: 'docs/rate-limits.md', newLine: 8, resolved: true }),
  ],
};

/* Pipelines per MR (newest first, like GitLab) ---------------------------- */

const byId = (projectId: number, id: number): PipelineStatus[] =>
  (projectPipelines[projectId] ?? []).filter((p) => p.id === id);

export const mrPipelines: Record<number, PipelineStatus[]> = {
  101: (projectPipelines[10] ?? []).filter((p) => p.refName === 'feature/dark-mode'),
  102: byId(10, 2998),
  105: byId(12, 4120),
  106: byId(12, 4118),
  107: byId(13, 5199),
  109: byId(12, 4118),
  201: byId(10, 3001),
  202: byId(10, 2977),
  203: byId(12, 4118),
};
