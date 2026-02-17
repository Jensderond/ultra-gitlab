/**
 * Transport abstraction layer.
 *
 * Detects whether the app is running inside a Tauri webview or a regular browser,
 * and routes invoke() calls to either Tauri IPC or HTTP fetch() accordingly.
 *
 * This allows the same frontend code to work both as a desktop app and as
 * a mobile web companion served by the embedded HTTP server.
 */

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * True when running inside a Tauri webview, false in a regular browser.
 */
export const isTauri: boolean = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ============================================================================
// HTTP Transport — command-to-REST mapping
// ============================================================================

type HttpMethod = 'GET' | 'POST';

interface RouteMapping {
  method: HttpMethod;
  /** Build the URL path from command args. */
  path: (args?: Record<string, unknown>) => string;
  /**
   * Build the query string params (for GET) or JSON body (for POST).
   * Returns undefined when there is nothing to send.
   */
  params?: (args?: Record<string, unknown>) => Record<string, unknown> | undefined;
}

/**
 * Map Tauri command names to companion REST API routes.
 *
 * Only commands that the companion server exposes need to be listed here.
 * Tauri-only commands (diagnostics, settings writes, etc.) are not mapped
 * and will throw in browser mode.
 */
const ROUTE_MAP: Record<string, RouteMapping> = {
  // ── Instances ──────────────────────────────────────────────────────────
  get_gitlab_instances: {
    method: 'GET',
    path: () => '/api/instances',
  },

  // ── Merge Requests ─────────────────────────────────────────────────────
  get_merge_requests: {
    method: 'GET',
    path: () => '/api/merge-requests',
    params: (args) => {
      const p: Record<string, unknown> = {};
      if (args?.instanceId != null) p.instance_id = args.instanceId;
      const filter = args?.filter as Record<string, unknown> | undefined;
      if (filter?.state) p.state = filter.state;
      if (filter?.search) p.search = filter.search;
      return p;
    },
  },

  list_my_merge_requests: {
    method: 'GET',
    path: () => '/api/my-merge-requests',
    params: (args) => {
      const p: Record<string, unknown> = {};
      if (args?.instanceId != null) p.instance_id = args.instanceId;
      return p;
    },
  },

  get_merge_request_detail: {
    method: 'GET',
    path: (args) => `/api/merge-requests/${args?.mrId}`,
  },

  get_diff_files: {
    method: 'GET',
    path: (args) => `/api/merge-requests/${args?.mrId}/files`,
  },

  get_diff_hunks: {
    method: 'GET',
    path: (args) =>
      `/api/merge-requests/${args?.mrId}/files/${encodeURIComponent(String(args?.filePath))}/hunks`,
    params: (args) => {
      const p: Record<string, unknown> = {};
      if (args?.start != null) p.start = args.start;
      if (args?.count != null) p.count = args.count;
      return p;
    },
  },

  get_file_content: {
    method: 'GET',
    path: () => '/api/file-content',
    params: (args) => ({
      instanceId: args?.instanceId,
      projectId: args?.projectId,
      filePath: args?.filePath,
      sha: args?.sha,
    }),
  },

  get_comments: {
    method: 'GET',
    path: (args) => `/api/merge-requests/${args?.mrId}/comments`,
  },

  get_mr_reviewers: {
    method: 'GET',
    path: (args) => `/api/merge-requests/${args?.mrId}/reviewers`,
  },

  get_diff_refs: {
    method: 'GET',
    path: (args) => `/api/merge-requests/${args?.mrId}/diff-refs`,
  },

  get_file_comments: {
    method: 'GET',
    path: (args) => `/api/merge-requests/${args?.mrId}/file-comments`,
    params: (args) => ({ filePath: args?.filePath }),
  },

  // ── Approvals ──────────────────────────────────────────────────────────
  approve_mr: {
    method: 'POST',
    path: (args) => `/api/merge-requests/${args?.mrId}/approve`,
  },

  unapprove_mr: {
    method: 'POST',
    path: (args) => `/api/merge-requests/${args?.mrId}/unapprove`,
  },

  get_approval_status: {
    method: 'GET',
    path: (args) => `/api/merge-requests/${args?.mrId}/approval-status`,
  },

  // ── Sync ───────────────────────────────────────────────────────────────
  get_sync_status: {
    method: 'GET',
    path: () => '/api/sync/status',
  },

  trigger_sync: {
    method: 'POST',
    path: () => '/api/sync/trigger',
  },

  // ── Settings (read-only) ───────────────────────────────────────────────
  get_settings: {
    method: 'GET',
    path: () => '/api/settings',
  },
};

// ============================================================================
// HTTP fetch-based transport
// ============================================================================

/**
 * Perform an HTTP request to the companion server.
 * Cookies (session token) are sent automatically.
 */
async function httpInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const route = ROUTE_MAP[cmd];
  if (!route) {
    throw new Error(`Command "${cmd}" is not available in browser mode`);
  }

  const urlPath = route.path(args);
  const extraParams = route.params?.(args);

  let url: string;
  let init: RequestInit = { credentials: 'include' };

  if (route.method === 'GET') {
    const qs = extraParams ? toQueryString(extraParams) : '';
    url = qs ? `${urlPath}?${qs}` : urlPath;
    init.method = 'GET';
  } else {
    url = urlPath;
    init.method = 'POST';
    if (extraParams && Object.keys(extraParams).length > 0) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(extraParams);
    }
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await response.json().catch(() => ({ code: 'UNKNOWN', message: response.statusText }));
    // Shape the error to match TauriError for consistent handling
    throw Object.assign(new Error(body.message || body.code || 'Request failed'), {
      type: body.code || 'HTTP_ERROR',
      details: body,
    });
  }

  // Handle empty responses (204 or empty body)
  const text = await response.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

function toQueryString(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value != null) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

// ============================================================================
// Tauri event listener helper
// ============================================================================

type UnlistenFn = () => void;

/**
 * Listen for a Tauri event. Returns a no-op unlisten function in browser mode
 * (Tauri events never fire there).
 */
export async function tauriListen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, handler);
}

// ============================================================================
// Open external URL helper
// ============================================================================

/**
 * Open a URL externally. Uses Tauri's plugin-opener in the desktop app,
 * falls back to window.open in a regular browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// ============================================================================
// Unified invoke — the public API
// ============================================================================

/**
 * Invoke a backend command. Routes to Tauri IPC when in a webview,
 * or to HTTP fetch when in a browser.
 */
export async function transportInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(cmd, args);
  }
  return httpInvoke<T>(cmd, args);
}
