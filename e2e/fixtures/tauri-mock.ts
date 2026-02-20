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

/**
 * Set up full Tauri IPC mock on a page.
 *
 * Call this before navigating to the app. It injects the mock into the
 * page context so `window.__TAURI_INTERNALS__` is present before React mounts.
 */
export async function mockTauriIPC(page: Page) {
  // Serialize seed data to inject into the browser context
  const seedJSON = JSON.stringify({
    instances: seed.instances,
    mergeRequests: seed.mergeRequests,
    myMergeRequests: seed.myMergeRequests,
    diffFiles: seed.diffFiles,
    diffRefsMap: seed.diffRefsMap,
    diffHunksMap: seed.diffHunksMap,
    comments: seed.comments,
    reviewers: seed.reviewers,
    syncStatus: seed.syncStatus,
    settings: seed.settings,
    pipelineProjects: seed.pipelineProjects,
    pipelineStatuses: seed.pipelineStatuses,
    pipelineJobs: seed.pipelineJobs,
    notificationSettings: seed.notificationSettings,
    companionStatus: seed.companionStatus,
    companionSettings: seed.companionSettings,
  });

  await page.addInitScript((dataJSON: string) => {
    const data = JSON.parse(dataJSON);

    // Event listeners registered via Tauri's listen()
    const eventListeners = new Map<string, Set<(event: unknown) => void>>();
    let listenerId = 0;

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

      // -- Comments --
      get_comments: (args) => data.comments[args.mrId as number] || [],
      get_file_comments: (args) => {
        const allComments = data.comments[args.mrId as number] || [];
        return allComments.filter((c: { filePath: string | null }) => c.filePath === args.filePath);
      },
      add_comment: (_args) => ({
        id: Date.now(),
        mrId: 101,
        discussionId: `disc-${Date.now()}`,
        parentId: null,
        authorUsername: 'testuser',
        body: 'mock comment',
        filePath: null,
        oldLine: null,
        newLine: null,
        resolved: false,
        system: false,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        isLocal: true,
        syncStatus: 'pending',
      }),
      reply_to_comment: () => ({
        id: Date.now(),
        mrId: 101,
        discussionId: 'disc-001',
        parentId: 5001,
        authorUsername: 'testuser',
        body: 'mock reply',
        filePath: null,
        oldLine: null,
        newLine: null,
        resolved: false,
        system: false,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        isLocal: true,
        syncStatus: 'pending',
      }),
      resolve_discussion: () => undefined,

      // -- Approvals --
      approve_mr: () => undefined,
      unapprove_mr: () => undefined,
      get_approval_status: () => ({ status: 'pending', count: 1, required: 2 }),
      get_mr_reviewers: (args) => data.reviewers[args.mrId as number] || [],

      // -- Sync --
      trigger_sync: () => undefined,
      get_sync_status: () => data.syncStatus,
      retry_failed_actions: () => undefined,
      discard_failed_action: () => undefined,
      get_sync_config: () => ({ intervalMinutes: 5 }),
      update_sync_config: () => undefined,
      get_sync_settings: () => ({ syncAuthored: true, syncReviewing: true }),
      update_sync_settings: () => undefined,

      // -- Settings --
      get_settings: () => data.settings,
      update_settings: () => data.settings,
      get_collapse_patterns: () => data.settings.collapsePatterns,
      update_collapse_patterns: () => undefined,

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
      list_pipeline_projects: () => data.pipelineProjects,
      visit_pipeline_project: () => undefined,
      toggle_pin_pipeline_project: () => undefined,
      remove_pipeline_project: () => undefined,
      search_projects: () => [],
      get_pipeline_statuses: () => data.pipelineStatuses,
      get_project_pipelines: () => data.pipelineStatuses,
      get_pipeline_jobs: () => data.pipelineJobs,
      get_job_trace: () => 'Job log output mock\nLine 2\nLine 3',
      play_pipeline_job: () => data.pipelineJobs[0],
      retry_pipeline_job: () => data.pipelineJobs[0],
      cancel_pipeline_job: () => data.pipelineJobs[0],

      // -- Notifications --
      get_notification_settings: () => data.notificationSettings,
      update_notification_settings: () => undefined,
      send_native_notification: () => undefined,

      // -- Companion --
      get_companion_settings: () => data.companionSettings,
      update_companion_settings: () => undefined,
      get_companion_qr_svg: () => '<svg></svg>',
      get_companion_status: () => data.companionStatus,
      regenerate_companion_pin: () => '5678',
      revoke_companion_device: () => undefined,
      start_companion_server_cmd: () => undefined,
      stop_companion_server_cmd: () => undefined,

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
        // Return a listener ID
        return handler;
      },
      'plugin:event|unlisten': () => undefined,

      // -- Tauri store plugin --
      'plugin:store|get': () => null,
      'plugin:store|set': () => undefined,
      'plugin:store|save': () => undefined,
      'plugin:store|load': () => undefined,

      // -- Tauri updater plugin --
      'plugin:updater|check': () => null,
      'plugin:updater|download-and-install': () => undefined,

      // -- Tauri process plugin --
      'plugin:process|restart': () => undefined,
      'plugin:process|exit': () => undefined,

      // -- Misc --
      greet: (args) => `Hello, ${args.name}!`,
    };

    // Install the mock
    (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const handler = handlers[cmd];
        if (handler) {
          return handler(args);
        }
        console.warn(`[Tauri Mock] Unhandled command: ${cmd}`, args);
        return undefined;
      },
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
      convertFileSrc: (path: string) => path,
    };
  }, seedJSON);
}
