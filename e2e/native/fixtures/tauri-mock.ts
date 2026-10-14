/**
 * Tauri IPC mock for Playwright E2E tests.
 *
 * Injects a fake `window.__TAURI_INTERNALS__` so the app runs in "desktop" mode
 * with full navigation (Settings, Pipelines, etc.). The mock invoke function
 * dispatches commands to handlers that return seeded data.
 *
 * Usage in tests:
 *   await page.addInitScript({ path: 'e2e/fixtures/tauri-mock-init.js' });
 *
 * This TypeScript file is the source of truth. The companion JS file
 * (tauri-mock-init.js) is the browser-injectable version that embeds the data.
 */

import type { Page } from '@playwright/test';
import * as seed from './seed-data';
import * as seedPipelines from './seed-pipelines';
import * as seedInbox from './seed-inbox';

/**
 * Set up full Tauri IPC mock on a page.
 *
 * Call this before navigating to the app. It injects the mock into the
 * page context so `window.__TAURI_INTERNALS__` is present before React mounts.
 */
export async function mockTauriIPC(
  page: Page,
  overrides?: {
    settings?: Partial<typeof seed.settings>;
    mergeRequests?: typeof seed.mergeRequests;
    issues?: typeof seed.issues;
    /** e.g. `[]` to start on the first-run setup screen. */
    instances?: typeof seed.instances;
  },
) {
  // Serialize seed data to inject into the browser context
  const seedJSON = JSON.stringify({
    instances: overrides?.instances ?? seed.instances,
    // Inbox feature: more MRs across projects (seed-inbox.ts), appended.
    mergeRequests: overrides?.mergeRequests ?? [...seed.mergeRequests, ...seedInbox.extraReviewMRs],
    myMergeRequests: [...seed.myMergeRequests, ...seedInbox.extraMyMRs],
    diffFiles: { ...seedInbox.extraDiffFiles, ...seed.diffFiles },
    diffRefsMap: seed.diffRefsMap,
    diffHunksMap: seed.diffHunksMap,
    comments: { ...seedInbox.extraComments, ...seed.comments },
    reviewers: { ...seedInbox.extraReviewers, ...seed.reviewers },
    mrPipelines: seedInbox.mrPipelines,
    syncStatus: seed.syncStatus,
    settings: { ...seed.settings, ...overrides?.settings },
    pipelineProjects: seed.pipelineProjects,
    projectSearchResults: seed.projectSearchResults,
    pipelineStatuses: seed.pipelineStatuses,
    pipelineJobs: seed.pipelineJobs,
    downstreamPipelineJobs: seed.downstreamPipelineJobs,
    // Pipelines feature: richer histories, jobs per pipeline and real-looking traces.
    extraPipelineProjects: seedPipelines.extraPipelineProjects,
    projectPipelines: seedPipelines.projectPipelines,
    latestPipelineStatuses: seedPipelines.latestPipelineStatuses,
    pipelineJobsById: seedPipelines.pipelineJobsById,
    jobTraces: seedPipelines.jobTraces,
    notificationSettings: seed.notificationSettings,
    issues: overrides?.issues ?? seed.issues,
  });

  await page.addInitScript((dataJSON: string) => {
    const data = JSON.parse(dataJSON);
    const w = window as Record<string, unknown>;
    // Boot the native UI (the backend injects this in the real app; see src/uiVariant.ts).
    w.__ULTRA_UI__ = 'native';

    // Event listeners registered via Tauri's listen()
    const eventListeners = new Map<string, Set<(event: unknown) => void>>();
    const eventHandlerIds = new Map<number, string>();
    // Tests: `page.evaluate(() => window.__TAURI_MOCK_EMIT__('auth-expired', {...}))`.
    (window as Record<string, unknown>).__TAURI_MOCK_EMIT__ = (event: string, payload: unknown) => {
      for (const [id, name] of eventHandlerIds) {
        const cb = (window as Record<string, unknown>)[`_${id}`];
        if (name === event && typeof cb === 'function') cb({ event, id, payload });
      }
    };
    let listenerId = 0;

    // -- Auto-run state (per-page, resets on each test navigation) --
    interface MockAutoRunClaim {
      instanceId: number;
      projectId: number;
      pipelineId: number;
      jobId: number;
      jobName: string;
      refName: string | null;
      claimedAt: number;
      lastStatus: string | null;
      lastError: string | null;
      lastAttemptAt: number | null;
      attempts: number;
    }
    const autoRunClaims: MockAutoRunClaim[] = [];

    // -- Auto-merge claim state (per-page, resets on each test navigation) --
    interface MockAutoMergeClaim {
      mrId: number;
      claimedAt: number;
      lastStatus: string | null;
      lastError: string | null;
      lastAttemptAt: number | null;
      attempts: number;
    }
    const autoMergeClaims = new Map<number, MockAutoMergeClaim>();

    // -- Custom MR filter state (per-page, resets on each test navigation) --
    const customFilters = new Map<number, unknown>();

    // Command handlers — return data matching the Rust backend shape
    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      // -- Instances --
      get_gitlab_instances: () => data.instances,
      setup_gitlab_instance: () => ({
        instance: data.instances[0],
        username: 'testuser',
      }),
      delete_gitlab_instance: () => undefined,
      get_token_info: () => ({
        expiresAt: null,
        name: 'test-token',
        scopes: ['api', 'read_user'],
        active: true,
      }),
      update_instance_token: () => 'testuser',

      // -- Merge Requests --
      get_merge_requests: () => data.mergeRequests,
      list_my_merge_requests: () => data.myMergeRequests,
      snooze_mr: (args) => {
        const mr = [...data.mergeRequests, ...data.myMergeRequests].find(
          (m: { id: number }) => m.id === args.mrId,
        );
        if (mr) mr.snoozedUntil = args.until as number;
        return {
          mrId: args.mrId,
          snoozedAt: Math.floor(Date.now() / 1000),
          snoozeUntil: args.until,
        };
      },
      unsnooze_mr: (args) => {
        const mr = [...data.mergeRequests, ...data.myMergeRequests].find(
          (m: { id: number }) => m.id === args.mrId,
        );
        if (mr) mr.snoozedUntil = null;
        return null;
      },
      get_merge_request_detail: (args) => {
        const mrId = args.mrId as number;
        const all = [...data.mergeRequests, ...data.myMergeRequests];
        const mr = all.find((m: { id: number }) => m.id === mrId) || all[0];
        return {
          mr,
          diffSummary: {
            fileCount: (data.diffFiles[mrId] || []).length,
            additions: 87,
            deletions: 8,
            files: (data.diffFiles[mrId] || []).map((f: { newPath: string; oldPath: string | null; changeType: string; additions: number; deletions: number }) => ({
              newPath: f.newPath,
              oldPath: f.oldPath,
              changeType: f.changeType,
              additions: f.additions,
              deletions: f.deletions,
            })),
          },
          pendingActions: 0,
        };
      },
      merge_mr: () => undefined,
      check_merge_status: () => 'mergeable',
      rebase_mr: () => undefined,
      undraft_mr: (args) => {
        const mr = [...data.mergeRequests, ...data.myMergeRequests].find(
          (m: { id: number }) => m.id === args.mrId,
        );
        if (mr) mr.title = String(mr.title).replace(/^(draft:|\[draft\]|\(draft\))\s*/i, '');
        return mr?.title ?? '';
      },

      // -- Auto-merge claims (stateful, per page load) --
      claim_auto_merge: (args) => {
        const mrId = args.mrId as number;
        const claim = {
          mrId,
          claimedAt: 1700000000,
          lastStatus: 'not_approved',
          lastError: null,
          lastAttemptAt: null,
          attempts: 0,
        };
        autoMergeClaims.set(mrId, claim);
        return claim;
      },
      unclaim_auto_merge: (args) => {
        autoMergeClaims.delete(args.mrId as number);
        return undefined;
      },
      get_auto_merge_claim: (args) => autoMergeClaims.get(args.mrId as number) ?? null,

      // -- Diff --
      get_diff_files: (args) => data.diffFiles[args.mrId as number] || [],
      get_diff_file: () => ({
        filePath: 'src/App.tsx',
        oldContent: 'old content',
        newContent: 'new content',
        diffHunks: [],
      }),
      get_diff_file_metadata: () => ({
        filePath: 'src/App.tsx',
        hunkCount: 1,
        totalLines: 50,
        additions: 12,
        deletions: 3,
        isLarge: false,
      }),
      get_diff_hunks: (args) => {
        const key = `${args.mrId}:${args.filePath}`;
        return data.diffHunksMap[key] || {
          filePath: args.filePath,
          hunks: [],
          startIndex: 0,
          totalHunks: 0,
          hasMore: false,
        };
      },
      get_diff_refs: (args) => data.diffRefsMap[args.mrId as number] || {
        baseSha: 'abc',
        headSha: 'def',
        startSha: 'abc',
      },
      get_file_content: () => '// file content mock',
      get_file_content_base64: () => '',
      get_cached_file_pair: (args) => {
        const filePath = args.filePath as string;
        // Return realistic content based on file type
        if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
          return {
            baseContent: 'import React from "react";\n\nfunction Component() {\n  return <div>Original</div>;\n}\n\nexport default Component;\n',
            headContent: 'import React from "react";\nimport { useState } from "react";\n\nfunction Component() {\n  const [active, setActive] = useState(false);\n  return <div className="updated">Modified</div>;\n}\n\nexport default Component;\n',
          };
        }
        if (filePath.endsWith('.css')) {
          return {
            baseContent: ':root {\n  --color-primary: #333;\n  --color-bg: #fff;\n}\n',
            headContent: ':root {\n  --color-primary: #1a1a2e;\n  --color-bg: #fafafa;\n  --color-accent: #e94560;\n}\n',
          };
        }
        return {
          baseContent: '// base content\nline 2\nline 3\n',
          headContent: '// head content\nline 2 modified\nline 3\nline 4 added\n',
        };
      },

      // -- Issues --
      get_cached_issue_detail: (args) =>
        data.issues.find(
          (i: { instanceId: number; projectId: number; iid: number }) =>
            i.instanceId === args.instanceId &&
            i.projectId === args.projectId &&
            i.iid === args.issueIid,
        ) ?? null,
      refresh_issue_detail: (args) =>
        data.issues.find(
          (i: { instanceId: number; projectId: number; iid: number }) =>
            i.instanceId === args.instanceId &&
            i.projectId === args.projectId &&
            i.iid === args.issueIid,
        ) ?? null,
      list_cached_issue_notes: () => [],
      list_cached_issues: () => data.issues,
      toggle_issue_star: (args) => {
        const issue = data.issues.find((i: { id: number }) => i.id === args.issueId);
        if (issue) issue.starred = !issue.starred;
        return issue?.starred ?? false;
      },
      // @mention candidates. `bob` has no cached name (avatar-only); `derond`
      // carries a real name so typing a first name resolves a different username.
      list_known_users: () => [
        { username: 'alice', name: 'Alice Liddell' },
        { username: 'bob', name: null },
      ],
      list_issue_assignee_candidates: () => [
        { id: 1, username: 'alice', name: 'Alice Liddell', avatarUrl: null },
        { id: 2, username: 'derond', name: 'Jens de Rond', avatarUrl: null },
      ],
      set_issue_description: (args) => {
        const issue = data.issues.find(
          (i: { instanceId: number; projectId: number; iid: number }) =>
            i.instanceId === args.instanceId &&
            i.projectId === args.projectId &&
            i.iid === args.issueIid,
        );
        if (issue) {
          issue.description = args.description as string;
          issue.updatedAt = Math.floor(Date.now() / 1000);
        }
        return issue ?? null;
      },

      // -- Comments --
      get_comments: (args) => data.comments[args.mrId as number] || [],
      get_file_comments: (args) => {
        const allComments = data.comments[args.mrId as number] || [];
        return allComments.filter((c: { filePath: string | null }) => c.filePath === args.filePath);
      },
      // Like the backend: insert a local, pending comment (no discussion id
      // until it syncs) and return it. Context-line comments get both sides.
      add_comment: (args) => {
        const input = args.input as {
          mrId: number;
          body: string;
          filePath?: string;
          oldLine?: number;
          newLine?: number;
          isContextLine?: boolean;
        };
        const ts = Math.floor(Date.now() / 1000);
        const line = input.newLine ?? input.oldLine ?? null;
        const comment = {
          id: -Date.now(),
          mrId: input.mrId,
          discussionId: null,
          parentId: null,
          authorUsername: 'testuser',
          body: input.body,
          filePath: input.filePath ?? null,
          oldLine: input.isContextLine ? line : (input.oldLine ?? null),
          newLine: input.isContextLine ? line : (input.newLine ?? null),
          lineType: null,
          resolved: false,
          resolvable: true,
          system: false,
          createdAt: ts,
          updatedAt: ts,
          isLocal: true,
          syncStatus: 'pending',
        };
        (data.comments[input.mrId] ??= []).push(comment);
        return comment;
      },
      reply_to_comment: (args) => {
        const input = args.input as { mrId: number; discussionId: string; parentId: number; body: string };
        const ts = Math.floor(Date.now() / 1000);
        const comment = {
          id: -Date.now(),
          mrId: input.mrId,
          discussionId: input.discussionId,
          parentId: input.parentId,
          authorUsername: 'testuser',
          body: input.body,
          filePath: null,
          oldLine: null,
          newLine: null,
          lineType: null,
          resolved: false,
          resolvable: false,
          system: false,
          createdAt: ts,
          updatedAt: ts,
          isLocal: true,
          syncStatus: 'pending',
        };
        (data.comments[input.mrId] ??= []).push(comment);
        return comment;
      },
      resolve_discussion: () => undefined,
      delete_comment: (args) => {
        // Remove the comment from the in-memory data
        const input = args.input as { mrId: number; commentId: number };
        const mrComments = data.comments[input.mrId];
        if (mrComments) {
          data.comments[input.mrId] = mrComments.filter(
            (c: { id: number }) => c.id !== input.commentId
          );
        }
        return undefined;
      },

      // -- Approvals --
      // Like the backend, approvals are recorded locally right away.
      approve_mr: (args) => {
        const mr = data.mergeRequests.find((m: { id: number }) => m.id === args.mrId);
        if (mr) mr.userHasApproved = true;
        return undefined;
      },
      unapprove_mr: (args) => {
        const mr = data.mergeRequests.find((m: { id: number }) => m.id === args.mrId);
        if (mr) mr.userHasApproved = false;
        return undefined;
      },
      get_approval_status: () => ({ status: 'pending', approvalsCount: 1, approvalsRequired: 2 }),
      get_mr_reviewers: (args) => data.reviewers[args.mrId as number] || [],

      // -- Sync --
      trigger_sync: () => undefined,
      // snake_case on the wire (no serde rename on these structs).
      get_sync_status: () => data.syncStatus,
      retry_failed_actions: () => ({ retried_count: 0, success_count: 0, failed_count: 0 }),
      discard_failed_action: () => undefined,
      get_sync_config: () => data.settings.sync,
      update_sync_config: (args) => {
        data.settings.sync = args.config;
        return undefined;
      },
      get_sync_settings: () => data.settings.sync,
      update_sync_settings: (args) => {
        data.settings.sync = args.syncConfig;
        return undefined;
      },

      // -- Settings --
      get_settings: () => data.settings,
      update_settings: (args) => {
        data.settings = { ...data.settings, ...(args.settings as object) };
        return undefined;
      },
      update_has_seen_product_tour: () => undefined,
      get_collapse_patterns: () => data.settings.collapsePatterns,
      update_collapse_patterns: (args) => {
        data.settings.collapsePatterns = args.patterns;
        return undefined;
      },

      // -- Gitattributes --
      get_gitattributes: () => [],
      refresh_gitattributes: () => [],

      // -- Diagnostics --
      get_memory_stats: () => ({
        processMemoryBytes: 100_000_000,
        processMemoryMb: 100,
        systemTotalBytes: 16_000_000_000,
        systemUsedBytes: 8_000_000_000,
        underTarget: true,
        targetBytes: 200_000_000,
      }),
      get_cache_stats: () => ({
        mrCount: 4,
        diffFileCount: 3,
        commentCount: 2,
        dbSizeBytes: 10_485_760,
        dbSizeMb: 10,
      }),
      get_diagnostics_report: () => ({
        memory: { processMemoryBytes: 100_000_000, processMemoryMb: 100 },
        cache: { mrCount: 4, dbSizeMb: 10 },
        timestamp: Date.now(),
      }),
      generate_test_data: () => ({ mrsGenerated: 10, diffFilesGenerated: 30, commentsGenerated: 50, durationMs: 100 }),
      clear_test_data: () => 0,

      // -- Pipelines --
      list_pipeline_projects: () => [...data.pipelineProjects, ...data.extraPipelineProjects],
      visit_pipeline_project: () => undefined,
      toggle_pin_pipeline_project: () => undefined,
      remove_pipeline_project: () => undefined,
      search_projects: (args) => {
        const query = String(args?.query ?? '').toLowerCase().trim();
        if (!query) return [];
        return data.projectSearchResults.filter(
          (p: { nameWithNamespace: string; pathWithNamespace: string }) =>
            p.nameWithNamespace.toLowerCase().includes(query) ||
            p.pathWithNamespace.toLowerCase().includes(query),
        );
      },
      get_pipeline_statuses: (args) =>
        data.latestPipelineStatuses.filter((s: { projectId: number }) =>
          ((args.projectIds as number[]) ?? []).includes(s.projectId),
        ),
      get_cached_pipeline_statuses: (args) =>
        data.latestPipelineStatuses.filter((s: { projectId: number }) =>
          ((args.projectIds as number[]) ?? []).includes(s.projectId),
        ),
      get_project_pipelines: (args) =>
        data.projectPipelines[args.projectId as number] ?? data.pipelineStatuses,
      get_mr_pipelines: (args) => data.mrPipelines[args.mrId as number] ?? data.pipelineStatuses,
      // Pipeline 3002 is the downstream pipeline triggered by the Docs bridge job.
      get_pipeline_jobs: (args) =>
        data.pipelineJobsById[args.pipelineId as number] ??
        (args.pipelineId === 3002 ? data.downstreamPipelineJobs : data.pipelineJobs),
      get_job_trace: (args) => data.jobTraces[args.jobId as number] ?? 'Job log output mock\nLine 2\nLine 3',
      play_pipeline_job: () => data.pipelineJobs[0],
      retry_pipeline_job: () => data.pipelineJobs[0],
      cancel_pipeline_job: () => data.pipelineJobs[0],
      cancel_pipeline: () => ({ ...data.pipelineStatuses[0], status: 'canceled' }),

      // -- Auto-run --
      list_auto_run_claims: () => autoRunClaims,
      claim_auto_run: (args) => {
        autoRunClaims.push({
          instanceId: args.instanceId as number,
          projectId: args.projectId as number,
          pipelineId: args.pipelineId as number,
          jobId: args.jobId as number,
          jobName: args.jobName as string,
          refName: (args.refName as string | null) ?? null,
          claimedAt: Math.floor(Date.now() / 1000),
          lastStatus: null,
          lastError: null,
          lastAttemptAt: null,
          attempts: 0,
        });
        return undefined;
      },
      unclaim_auto_run: (args) => {
        const idx = autoRunClaims.findIndex((c) => c.jobId === args.jobId);
        if (idx >= 0) autoRunClaims.splice(idx, 1);
        return undefined;
      },

      // -- Notifications --
      get_notification_settings: () => data.notificationSettings,
      update_notification_settings: (args) => {
        data.notificationSettings = args.settings;
        return undefined;
      },
      get_notification_permission_status: () => 'granted',
      request_notification_permission: () => true,
      rename_instance: (args) => {
        const inst = data.instances.find((i: { id: number }) => i.id === args.instanceId);
        if (inst) inst.name = args.name;
        return undefined;
      },
      set_default_instance: (args) => {
        for (const i of data.instances) i.isDefault = i.id === args.instanceId;
        return undefined;
      },
      resolve_project_by_path: (args) => {
        const all = [...data.pipelineProjects, ...data.extraPipelineProjects];
        const p = all.find((x: { pathWithNamespace: string }) => x.pathWithNamespace === args.projectPath);
        if (!p) throw { type: 'NotFound', details: { resource: 'Project', id: String(args.projectPath) } };
        return { id: p.projectId, nameWithNamespace: p.nameWithNamespace };
      },
      fetch_mr_by_web_url: (args) => {
        throw {
          type: 'InvalidInput',
          details: { message: `No configured instance matches ${String(args.webUrl)}`, field: 'web_url' },
        };
      },
      resolve_mr_by_web_url: (args) => {
        const all = [...data.mergeRequests, ...data.myMergeRequests];
        const url = String(args.webUrl).replace(/\/+$/, '');
        const mr = all.find((m: { webUrl: string }) => m.webUrl === url);
        return mr ? { localId: mr.id, state: mr.state } : null;
      },
      send_native_notification: () => undefined,

      // -- Custom MR filter --
      get_custom_mr_filter: (args) => customFilters.get(args.instanceId as number) ?? null,
      set_custom_mr_filter: (args) => {
        const filter = args.filter as { instanceId: number };
        customFilters.set(filter.instanceId, filter);
        return undefined;
      },
      test_custom_mr_filter: () => 42,

      // -- Avatars --
      get_avatar: () => null,
      get_avatars: () => ({}),
      update_session_cookie: () => undefined,
      refresh_avatars: () => 0,

      // -- Theme --
      update_theme: () => undefined,
      update_ui_font: () => undefined,
      update_display_font: () => undefined,
      update_custom_theme_colors: () => undefined,

      // -- Tauri event system --
      'plugin:event|listen': (args) => {
        const event = args.event as string;
        const handler = args.handler as number;
        if (!eventListeners.has(event)) {
          eventListeners.set(event, new Set());
        }
        // Remember the callback id so tests can emit events (see __TAURI_MOCK_EMIT__).
        eventHandlerIds.set(handler, event);
        // Return a listener ID
        return handler;
      },
      'plugin:event|unlisten': () => undefined,

      // -- Tauri store plugin --
      'plugin:store|get': () => null,
      'plugin:store|set': () => undefined,
      'plugin:store|save': () => undefined,
      'plugin:store|load': () => undefined,

      // -- Tauri deep-link plugin --
      'plugin:deep-link|get_current': () => null,

      // -- Tauri updater plugin --
      // Tests opt in with `window.__MOCK_UPDATE__ = { version }` (see updates.spec.ts).
      // The download reports 40%, then waits for `window.__MOCK_UPDATE_FINISH__()`.
      'plugin:updater|check': () => {
        const u = w.__MOCK_UPDATE__ as { version: string } | undefined;
        return u
          ? { rid: 1, currentVersion: '0.25.3', version: u.version, date: null, body: 'Faster sync.', rawJson: {} }
          : null;
      },
      'plugin:updater|download': async (args) => {
        const channel = args.onEvent as { onmessage: (e: unknown) => void };
        channel.onmessage({ event: 'Started', data: { contentLength: 1000 } });
        channel.onmessage({ event: 'Progress', data: { chunkLength: 400 } });
        await new Promise((resolve) => (w.__MOCK_UPDATE_FINISH__ = resolve));
        channel.onmessage({ event: 'Progress', data: { chunkLength: 600 } });
        channel.onmessage({ event: 'Finished' });
        return 2;
      },
      'plugin:updater|install': () => {
        w.__MOCK_UPDATE_INSTALLED__ = true;
      },
      'plugin:resources|close': () => undefined,
      'plugin:app|version': () => '0.25.3',

      // -- UI variant (src/uiVariant.ts) --
      set_ui_variant: (args) => {
        w.__MOCK_UI_VARIANT__ = args.variant;
      },

      // -- Tauri process plugin --
      'plugin:process|restart': () => {
        w.__MOCK_RESTARTED__ = true;
      },
      'plugin:process|exit': () => undefined,

      // -- Misc --
      greet: (args) => `Hello, ${args.name}!`,
    };

    // Install the mock
    (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const handler = handlers[cmd];
        if (handler) {
          // Real Tauri IPC serializes every response, so the app always
          // receives fresh objects. Handlers here mutate seed data in place
          // and return live references — without a clone, react-query's
          // structural sharing sees "unchanged" data after a refetch and
          // never notifies subscribers.
          const result = await handler(args);
          return result === undefined ? undefined : structuredClone(result);
        }
        console.warn(`[Tauri Mock] Unhandled command: ${cmd}`, args);
        return undefined;
      },
      // Register a JS callback and return its numeric id, mirroring Tauri's
      // real internals. The event plugin's `listen()` calls this; without it
      // the import throws "transformCallback is not a function", producing an
      // unhandled rejection on every page load (a flake source). Events never
      // fire in tests, so the stored callback is never invoked.
      transformCallback: (callback: unknown, _once?: boolean) => {
        const w = window as Record<string, unknown>;
        const id = ((w.__TAURI_CB_ID__ as number) || 0) + 1;
        w.__TAURI_CB_ID__ = id;
        w[`_${id}`] = callback;
        return id;
      },
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
      convertFileSrc: (path: string) => path,
    };

    // The event plugin's unlisten path calls
    // `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`. Without this,
    // tearing down a listener throws an unhandled rejection on unmount.
    (window as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, eventId: number) => {
        eventHandlerIds.delete(eventId);
      },
    };
  }, seedJSON);
}
