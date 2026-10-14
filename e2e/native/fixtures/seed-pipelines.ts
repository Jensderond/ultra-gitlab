/**
 * Pipeline seed data for the pipelines dashboard + job log screens.
 *
 * Kept apart from `seed-data.ts` so it can grow without touching the shared
 * fixtures. `tauri-mock.ts` merges it in: per-project histories, jobs per
 * pipeline and realistic GitLab job traces (section markers, ANSI colours,
 * carriage-return progress output).
 *
 * The headline case is pipeline #3010 on `feature/dark-mode` (MR 101's branch):
 * its `test` job fails in Jest with a stack trace through
 * `src/components/ThemeToggle.tsx`, a file changed in MR 101.
 */

import type { PipelineJob, PipelineProject, PipelineStatus } from '../../src/api/types';

const nowMs = Date.now();
const iso = (secondsAgo: number) => new Date(nowMs - secondsAgo * 1000).toISOString();
const unix = (secondsAgo: number) => Math.floor(nowMs / 1000) - secondsAgo;

/* ------------------------------------------------------------------------ */
/* Projects                                                                 */
/* ------------------------------------------------------------------------ */

export const extraPipelineProjects: PipelineProject[] = [
  {
    projectId: 12,
    instanceId: 1,
    pinned: true,
    lastVisitedAt: iso(3600),
    sortOrder: 1,
    name: 'api-gateway',
    nameWithNamespace: 'backend / api-gateway',
    pathWithNamespace: 'backend/api-gateway',
    webUrl: 'https://gitlab.example.com/backend/api-gateway',
    starred: false,
    customName: null,
  },
  {
    projectId: 13,
    instanceId: 1,
    pinned: false,
    lastVisitedAt: iso(7200),
    sortOrder: null,
    name: 'ios-app',
    nameWithNamespace: 'mobile / ios-app',
    pathWithNamespace: 'mobile/ios-app',
    webUrl: 'https://gitlab.example.com/mobile/ios-app',
    starred: false,
    customName: null,
  },
  {
    projectId: 11,
    instanceId: 1,
    pinned: false,
    lastVisitedAt: iso(86400),
    sortOrder: null,
    name: 'docs',
    nameWithNamespace: 'pipelines / docs',
    pathWithNamespace: 'pipelines/docs',
    webUrl: 'https://gitlab.example.com/pipelines/docs',
    starred: false,
    customName: null,
  },
  {
    projectId: 14,
    instanceId: 1,
    pinned: false,
    lastVisitedAt: iso(86400 * 2),
    sortOrder: null,
    name: 'terraform',
    nameWithNamespace: 'infra / terraform',
    pathWithNamespace: 'infra/terraform',
    webUrl: 'https://gitlab.example.com/infra/terraform',
    starred: false,
    customName: 'Infrastructure',
  },
  {
    projectId: 15,
    instanceId: 1,
    pinned: false,
    lastVisitedAt: iso(86400 * 4),
    sortOrder: null,
    name: 'handbook',
    nameWithNamespace: 'internal / handbook',
    pathWithNamespace: 'internal/handbook',
    webUrl: 'https://gitlab.example.com/internal/handbook',
    starred: false,
    customName: null,
  },
];

/* ------------------------------------------------------------------------ */
/* Pipelines                                                                */
/* ------------------------------------------------------------------------ */

const pipeline = (
  id: number,
  projectId: number,
  path: string,
  status: PipelineStatus['status'],
  refName: string,
  sha: string,
  agoS: number,
  duration: number | null,
): PipelineStatus => ({
  id,
  projectId,
  status,
  refName,
  // The backend truncates pipeline SHAs to 8 characters.
  sha: sha.slice(0, 8),
  webUrl: `https://gitlab.example.com/${path}/-/pipelines/${id}`,
  createdAt: iso(agoS),
  updatedAt: iso(Math.max(0, agoS - (duration ?? 0))),
  duration,
});

/** Newest first, like GitLab's `/projects/:id/pipelines`. */
export const projectPipelines: Record<number, PipelineStatus[]> = {
  10: [
    pipeline(3010, 10, 'frontend/web-app', 'failed', 'feature/dark-mode', '9f2c4e1a7b3d5f60a1c2e3d4f5a6b7c8d9e0f1a2', 25 * 60, 232),
    pipeline(3001, 10, 'frontend/web-app', 'success', 'main', 'abc123', 3600, 245),
    pipeline(2998, 10, 'frontend/web-app', 'success', 'fix/login-redirect', 'd41e88c0aa21', 2 * 3600, 238),
    pipeline(2990, 10, 'frontend/web-app', 'success', 'main', '77b0c9e2f310', 5 * 3600, 251),
    pipeline(2984, 10, 'frontend/web-app', 'canceled', 'feature/dark-mode', '5c1d0b9a8e77', 26 * 3600, 61),
    pipeline(2977, 10, 'frontend/web-app', 'failed', 'main', 'e0a4b3c2d1f0', 2 * 86400, 198),
  ],
  11: [pipeline(3002, 11, 'pipelines/docs', 'success', 'main', 'aa01bb02cc03', 3 * 3600, 300)],
  12: [
    pipeline(4120, 12, 'backend/api-gateway', 'running', 'main', '1b2c3d4e5f60', 4 * 60, null),
    pipeline(4118, 12, 'backend/api-gateway', 'success', 'main', '0f9e8d7c6b5a', 3 * 3600, 412),
  ],
  13: [
    pipeline(5203, 13, 'mobile/ios-app', 'failed', 'release/2.4', '6a7b8c9d0e1f', 86400, 74),
    pipeline(5199, 13, 'mobile/ios-app', 'success', 'main', '2468ace13579', 2 * 86400, 640),
  ],
  14: [pipeline(6007, 14, 'infra/terraform', 'canceled', 'main', '13579bdf2468', 3 * 86400, 35)],
  15: [],
};

/** Latest pipeline per project (what `get_pipeline_statuses` returns). */
export const latestPipelineStatuses: PipelineStatus[] = Object.values(projectPipelines)
  .map((list) => list[0])
  .filter(Boolean);

/* ------------------------------------------------------------------------ */
/* Jobs                                                                     */
/* ------------------------------------------------------------------------ */

const job = (
  id: number,
  project: string,
  name: string,
  stage: string,
  status: PipelineJob['status'],
  opts: {
    startedAgo?: number;
    duration?: number;
    queued?: number;
    allowFailure?: boolean;
    runner?: string | null;
    manual?: boolean;
  } = {},
): PipelineJob => {
  const started = opts.startedAgo;
  const finished =
    started !== undefined && opts.duration !== undefined && status !== 'running'
      ? started - opts.duration
      : undefined;
  return {
    id,
    name,
    stage,
    status,
    webUrl: `https://gitlab.example.com/${project}/-/jobs/${id}`,
    createdAt: iso((started ?? 600) + (opts.queued ?? 3)),
    startedAt: started !== undefined ? iso(started) : null,
    finishedAt: finished !== undefined ? iso(finished) : null,
    duration: status === 'running' && started !== undefined ? started : (opts.duration ?? null),
    queuedDuration: opts.queued ?? null,
    allowFailure: opts.allowFailure ?? false,
    runnerDescription: opts.runner === undefined ? (started !== undefined ? 'docker-shared-02' : null) : opts.runner,
    isBridge: false,
    downstreamPipeline: null,
    manual: opts.manual ?? false,
  };
};

const WEB = 'frontend/web-app';
const API = 'backend/api-gateway';
const IOS = 'mobile/ios-app';
const P3010 = 25 * 60; // pipeline start, seconds ago

/** Jobs per pipeline id; GitLab returns them newest id first. */
export const pipelineJobsById: Record<number, PipelineJob[]> = {
  3010: [
    job(7307, WEB, 'Deploy review', 'deploy', 'skipped', { runner: null }),
    job(7306, WEB, 'e2e', 'test', 'failed', { startedAgo: P3010 - 110, duration: 96, queued: 2, allowFailure: true }),
    job(7305, WEB, 'typecheck', 'test', 'success', { startedAgo: P3010 - 108, duration: 22, queued: 1 }),
    job(7304, WEB, 'test', 'test', 'failed', { startedAgo: P3010 - 106, duration: 151, queued: 4 }),
    job(7303, WEB, 'lint', 'test', 'success', { startedAgo: P3010 - 105, duration: 49, queued: 1 }),
    job(7302, WEB, 'build', 'build', 'success', { startedAgo: P3010 - 40, duration: 64, queued: 2, runner: 'docker-shared-01' }),
    job(7301, WEB, 'install', 'build', 'success', { startedAgo: P3010, duration: 38, queued: 2, runner: 'docker-shared-01' }),
  ],
  4120: [
    job(7405, API, 'deploy:production', 'deploy', 'manual', { runner: null, manual: true }),
    job(7404, API, 'deploy:staging', 'deploy', 'created', { runner: null, manual: true }),
    job(7403, API, 'integration', 'test', 'pending', { runner: null }),
    job(7402, API, 'unit', 'test', 'running', { startedAgo: 150, queued: 6 }),
    job(7401, API, 'compile', 'build', 'success', { startedAgo: 240, duration: 72, queued: 9 }),
  ],
  5203: [
    job(7503, IOS, 'testflight', 'deploy', 'skipped', { runner: null }),
    job(7502, IOS, 'build', 'build', 'skipped', { runner: null }),
    job(7501, IOS, 'lint', 'lint', 'failed', { startedAgo: 86400 - 5, duration: 41, queued: 5 }),
  ],
};

/* ------------------------------------------------------------------------ */
/* Traces                                                                   */
/* ------------------------------------------------------------------------ */

const E = '\x1b';
const R = `${E}[0;m`;
const start = (ts: number, key: string, title: string, collapsed = false) =>
  `${E}[0Ksection_start:${ts}:${key}${collapsed ? '[collapsed=true]' : ''}\r${E}[0K${E}[0K${E}[36;1m${title}${R}`;
const end = (ts: number, key: string) => `${E}[0Ksection_end:${ts}:${key}\r${E}[0K`;
const green = (s: string) => `${E}[32;1m${s}${R}`;

function runnerPreamble(t0: number, image: string, runner: string, project: string, sha: string, ref: string) {
  return [
    `${E}[0KRunning with gitlab-runner 17.4.0 (b92ee590)${R}`,
    `${E}[0K  on ${runner} xS6Vzpvo, system ID: s_0e3f2d1a9c7b${R}`,
    start(t0, 'prepare_executor', 'Preparing the "docker" executor'),
    `${E}[0KUsing Docker executor with image ${image} ...${R}`,
    `${E}[0KPulling docker image ${image} ...${R}`,
    `${E}[0KUsing docker image sha256:4f1e3b2a9c8d for ${image} with digest ${image.split(':')[0]}@sha256:9b2f0c4e7a1d6f3b ...${R}`,
    end(t0 + 3, 'prepare_executor'),
    start(t0 + 3, 'prepare_script', 'Preparing environment'),
    `Running on runner-xs6vzpvo-project-10-concurrent-0 via ${runner}...`,
    end(t0 + 4, 'prepare_script'),
    start(t0 + 4, 'get_sources', 'Getting source from Git repository'),
    green('Fetching changes with git depth set to 20...'),
    `Reinitialized existing Git repository in /builds/${project}/.git/`,
    green(`Checking out ${sha.slice(0, 8)} as detached HEAD (ref is ${ref})...`),
    'Removing .eslintcache',
    'Removing coverage/',
    '',
    green('Skipping Git submodules setup'),
    end(t0 + 6, 'get_sources'),
    start(t0 + 6, 'restore_cache', 'Restoring cache'),
    green('Checking cache for node-modules-a1b2c3-protected...'),
    `Downloading cache from https://storage.googleapis.com/gitlab-runner-cache/project/10/node-modules-a1b2c3-protected${R}  ETag${R}="9a8b7c6d"`,
    green('Successfully extracted cache'),
    end(t0 + 11, 'restore_cache'),
  ];
}

function npmCi(): string[] {
  const progress = ['⸨░░░░░░░░░░░░░░░░░░⸩ ⠙ idealTree', '⸨████████░░░░░░░░░░⸩ ⠹ reify:react', '⸨██████████████████⸩ ⠸ reify:typescript'];
  return [
    green('$ npm ci --prefer-offline --no-audit'),
    progress.join('\r') + '\r',
    '',
    'added 1214 packages in 21s',
    '',
    '187 packages are looking for funding',
    '  run `npm fund` for details',
  ];
}

const PASS = `${E}[1m${E}[30m${E}[42m PASS ${E}[49m${E}[39m${E}[22m`;
const FAIL = `${E}[1m${E}[31m${E}[7m FAIL ${E}[27m${E}[39m${E}[22m`;
const dim = (s: string) => `${E}[2m${s}${E}[22m`;

function jestFailureTrace(): string {
  const t0 = unix(P3010 - 106);
  const suites = [
    'src/utils/format.test.ts',
    'src/utils/date.test.ts',
    'src/hooks/useMediaQuery.test.ts',
    'src/hooks/useLocalStorage.test.ts',
    'src/components/Button.test.tsx',
    'src/components/Avatar.test.tsx',
    'src/components/Modal.test.tsx',
    'src/components/SettingsPanel.test.tsx',
    'src/pages/LoginPage.test.tsx',
    'src/pages/Dashboard.test.tsx',
    'src/api/client.test.ts',
  ];
  const lines = [
    ...runnerPreamble(t0, 'node:20-alpine', 'docker-shared-02', 'frontend/web-app', '9f2c4e1a7b3d', 'feature/dark-mode'),
    start(t0 + 11, 'step_script', 'Executing "step_script" stage of the job script'),
    `${E}[0KUsing docker image sha256:4f1e3b2a9c8d for node:20-alpine with digest node@sha256:9b2f0c4e7a1d6f3b ...${R}`,
    ...npmCi(),
    start(t0 + 33, 'jest', 'Run unit tests'),
    green('$ npx jest --ci --colors --reporters=default --reporters=jest-junit'),
    ...suites.slice(0, 6).map((s, i) => `${PASS} ${dim(s.replace(/[^/]+$/, ''))}${E}[1m${s.split('/').pop()}${E}[22m (${(0.41 + ((s.length * 7 + i * 13) % 260) / 100).toFixed(2)} s)`),
    `${FAIL} ${dim('src/components/')}${E}[1mThemeToggle.test.tsx${E}[22m (2.913 s)`,
    `  ThemeToggle`,
    `    ${E}[32m✓${E}[39m ${dim('renders a switch with an accessible label (48 ms)')}`,
    `    ${E}[32m✓${E}[39m ${dim('persists the chosen theme to localStorage (21 ms)')}`,
    `    ${E}[31m✕${E}[39m follows the system preference when no theme is stored ${dim('(9 ms)')}`,
    '',
    `${E}[1m${E}[31m  ${E}[1m● ${E}[22m${E}[1mThemeToggle › follows the system preference when no theme is stored${E}[39m${E}[22m`,
    '',
    `    TypeError: Cannot read properties of undefined (reading 'matches')`,
    '',
    `    ${E}[0m ${E}[90m 16 |${E}[39m ${E}[36mfunction${E}[39m systemPrefersDark()${E}[33m:${E}[39m boolean {`,
    `     ${E}[90m 17 |${E}[39m   ${E}[36mconst${E}[39m query ${E}[33m=${E}[39m window${E}[33m.${E}[39mmatchMedia${E}[33m?.${E}[39m(${E}[32m'(prefers-color-scheme: dark)'${E}[39m)${E}[33m;${E}[39m`,
    `    ${E}[31m${E}[1m>${E}[22m${E}[39m${E}[90m 18 |${E}[39m   ${E}[36mreturn${E}[39m query${E}[33m.${E}[39mmatches${E}[33m;${E}[39m`,
    `     ${E}[90m    |${E}[39m                ${E}[31m${E}[1m^${E}[22m${E}[39m`,
    `     ${E}[90m 19 |${E}[39m }`,
    `     ${E}[90m 20 |${E}[39m`,
    '',
    `      ${E}[2mat systemPrefersDark (${E}[22m${E}[36msrc/components/ThemeToggle.tsx${E}[39m${E}[2m:18:16)${E}[22m`,
    `      ${E}[2mat ThemeToggle (${E}[22m${E}[36msrc/components/ThemeToggle.tsx${E}[39m${E}[2m:27:36)${E}[22m`,
    `      ${E}[2mat renderWithHooks (${E}[22mnode_modules/react-dom/cjs/react-dom.development.js${E}[2m:15486:18)${E}[22m`,
    `      ${E}[2mat Object.<anonymous> (${E}[22m${E}[36m/builds/frontend/web-app/src/components/ThemeToggle.test.tsx${E}[39m${E}[2m:31:5)${E}[22m`,
    '',
    ...suites.slice(6).map((s, i) => `${PASS} ${dim(s.replace(/[^/]+$/, ''))}${E}[1m${s.split('/').pop()}${E}[22m (${(0.41 + ((s.length * 7 + i * 13) % 260) / 100).toFixed(2)} s)`),
    '',
    `${E}[1mTest Suites: ${E}[22m${E}[1m${E}[31m1 failed${E}[39m${E}[22m, ${E}[1m${E}[32m11 passed${E}[39m${E}[22m, 12 total`,
    `${E}[1mTests:       ${E}[22m${E}[1m${E}[31m1 failed${E}[39m${E}[22m, ${E}[1m${E}[32m47 passed${E}[39m${E}[22m, 48 total`,
    `${E}[1mSnapshots:   ${E}[22m0 total`,
    `${E}[1mTime:${E}[22m        14.823 s`,
    `${E}[2mRan all test suites${E}[22m${E}[2m.${E}[22m`,
    end(t0 + 140, 'jest'),
    end(t0 + 140, 'step_script'),
    start(t0 + 140, 'upload_artifacts_on_failure', 'Uploading artifacts for failed job'),
    green('Uploading artifacts...'),
    'junit.xml: found 1 matching artifact files and directories',
    `Uploading artifacts as "junit" to coordinator... 201 Created${R}  id${R}=7304 responseStatus${R}=201 Created token${R}=glcbt-64`,
    end(t0 + 142, 'upload_artifacts_on_failure'),
    start(t0 + 142, 'cleanup_file_variables', 'Cleaning up project directory and file based variables'),
    end(t0 + 143, 'cleanup_file_variables'),
    '',
    `${E}[31;1mERROR: Job failed: exit code 1${R}`,
    '',
  ];
  return lines.join('\n');
}

function viteBuildTrace(): string {
  const t0 = unix(P3010 - 40);
  const chunks = [
    ['dist/index.html', '0.62 kB', '0.38 kB'],
    ['dist/assets/index-4f8a1c2e.css', '38.14 kB', '7.02 kB'],
    ['dist/assets/ThemeToggle-9b1d2c3e.js', '2.31 kB', '1.04 kB'],
    ['dist/assets/vendor-react-1a2b3c4d.js', '142.61 kB', '45.83 kB'],
    ['dist/assets/index-7e6d5c4b.js', '311.27 kB', '96.40 kB'],
  ];
  const lines = [
    ...runnerPreamble(t0, 'node:20-alpine', 'docker-shared-01', 'frontend/web-app', '9f2c4e1a7b3d', 'feature/dark-mode'),
    start(t0 + 11, 'step_script', 'Executing "step_script" stage of the job script'),
    ...npmCi(),
    green('$ npm run build'),
    '',
    '> web-app@2.14.0 build',
    '> tsc -b && vite build',
    '',
    `${E}[36mvite v5.4.8 ${E}[32mbuilding for production...${E}[39m`,
    'transforming...',
    `${E}[32m✓${E}[39m 1342 modules transformed.`,
    'rendering chunks...',
    'computing gzip size...',
    ...chunks.map(([f, s, g]) => `${E}[2m${f.replace(/[^/]+$/, '')}${E}[22m${E}[36m${f.split('/').pop()!.padEnd(36)}${E}[39m ${E}[1m${E}[2m${s.padStart(10)}${E}[22m${E}[1m${E}[22m${E}[2m │ gzip: ${g.padStart(9)}${E}[22m`),
    `${E}[32m✓ built in 8.41s${E}[39m`,
    end(t0 + 58, 'step_script'),
    start(t0 + 58, 'archive_cache', 'Saving cache for successful job'),
    green('Creating cache node-modules-a1b2c3-protected...'),
    'node_modules/: found 48211 matching artifact files and directories',
    'Archive is up to date!',
    green('Created cache'),
    end(t0 + 61, 'archive_cache'),
    start(t0 + 61, 'upload_artifacts_on_success', 'Uploading artifacts for successful job'),
    green('Uploading artifacts...'),
    'dist/: found 7 matching artifact files and directories',
    `Uploading artifacts as "archive" to coordinator... 201 Created${R}  id${R}=7302 responseStatus${R}=201 Created token${R}=glcbt-64`,
    end(t0 + 63, 'upload_artifacts_on_success'),
    start(t0 + 63, 'cleanup_file_variables', 'Cleaning up project directory and file based variables'),
    end(t0 + 64, 'cleanup_file_variables'),
    '',
    green('Job succeeded'),
    '',
  ];
  return lines.join('\n');
}

function runningUnitTrace(): string {
  const t0 = unix(150);
  const lines = [
    ...runnerPreamble(t0, 'golang:1.23', 'docker-shared-03', 'backend/api-gateway', '1b2c3d4e5f60', 'main'),
    start(t0 + 11, 'step_script', 'Executing "step_script" stage of the job script'),
    green('$ go test -v ./...'),
    ...Array.from({ length: 40 }, (_, i) => [`=== RUN   TestRoute${i + 1}`, `--- PASS: TestRoute${i + 1} (0.0${i % 9}s)`]).flat(),
    'PASS',
    'ok  \tgithub.com/example/api-gateway/router\t0.412s',
    '=== RUN   TestRateLimiterBurst',
  ];
  return lines.join('\n') + '\n';
}

function eslintTrace(): string {
  const t0 = unix(86400 - 5);
  const lines = [
    ...runnerPreamble(t0, 'node:20', 'docker-shared-02', 'mobile/ios-app', '6a7b8c9d0e1f', 'release/2.4'),
    start(t0 + 11, 'step_script', 'Executing "step_script" stage of the job script'),
    green('$ npx eslint . --max-warnings=0'),
    '',
    `${E}[4m/builds/mobile/ios-app/src/screens/Checkout.tsx${E}[24m`,
    `  ${E}[2m42:7${E}[22m  ${E}[31merror${E}[39m  'total' is assigned a value but never used  ${E}[2m@typescript-eslint/no-unused-vars${E}[22m`,
    `  ${E}[2m88:3${E}[22m  ${E}[33mwarning${E}[39m  Unexpected console statement  ${E}[2mno-console${E}[22m`,
    '',
    `${E}[4m/builds/mobile/ios-app/src/api/payments.ts${E}[24m`,
    `  ${E}[2m15:10${E}[22m  ${E}[31merror${E}[39m  'fetchJson' is not defined  ${E}[2mno-undef${E}[22m`,
    '',
    `${E}[31m${E}[1m✖ 3 problems (2 errors, 1 warning)${E}[22m${E}[39m`,
    '',
    end(t0 + 40, 'step_script'),
    start(t0 + 40, 'cleanup_file_variables', 'Cleaning up project directory and file based variables'),
    end(t0 + 41, 'cleanup_file_variables'),
    '',
    `${E}[31;1mERROR: Job failed: exit code 1${R}`,
    '',
  ];
  return lines.join('\n');
}

export const jobTraces: Record<number, string> = {
  7304: jestFailureTrace(),
  7302: viteBuildTrace(),
  7402: runningUnitTrace(),
  7501: eslintTrace(),
};
