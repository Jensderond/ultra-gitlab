/**
 * Minimal history router. Routes are plain paths; screens read params with
 * `useRoute()` and move with `navigate()`. Back/forward work through the
 * webview history (⌘[ / ⌘] and the mouse buttons are wired in App).
 *
 *   /inbox/:view                     view = review | returned | mine | ready | all
 *   /inbox/:view?mr=ID               with a merge request selected in the preview
 *   /review/:mrId?file=path          full review (diff) screen
 *   /pipelines?project=ID            pipelines dashboard
 *   /pipelines/:instanceId/:projectId/:pipelineId?job=ID   pipeline + job log
 *   /setup                           first-run / add instance
 *   /settings                        preferences
 */

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const notify = () => {
  rememberHome();
  listeners.forEach((l) => l());
};

if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

// Last place visited in each home section, so ⌘1 / ⌘2 return you there.
const lastHome: Record<'inbox' | 'pipelines', string | null> = { inbox: null, pipelines: null };
function rememberHome() {
  const path = location.pathname + location.search;
  if (location.pathname.startsWith('/inbox')) lastHome.inbox = path;
  else if (location.pathname === '/pipelines') lastHome.pipelines = path;
}

/** Where ⌘1 / ⌘2 go: the last inbox or pipelines location, else its default. */
export function homePath(section: 'inbox' | 'pipelines'): string {
  return lastHome[section] ?? (section === 'inbox' ? '/inbox/review' : '/pipelines');
}

export function navigate(to: string, { replace = false } = {}) {
  const current = location.pathname + location.search;
  if (to === current) return;
  // Each entry remembers the in-app path it was pushed from (see cameFrom).
  if (replace) history.replaceState(history.state, '', to);
  else history.pushState({ from: current }, '', to);
  notify();
}

/** The in-app path the current history entry was opened from; null on a cold start. */
export function cameFrom(): string | null {
  return (history.state as { from?: string } | null)?.from ?? null;
}

/** Update query params on the current path without adding a history entry. */
export function setSearchParams(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') search.delete(k);
    else search.set(k, String(v));
  }
  const qs = search.toString();
  navigate(location.pathname + (qs ? `?${qs}` : ''), { replace: true });
}

export const back = () => history.back();
export const forward = () => history.forward();

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

let cached: { href: string; route: Route } | null = null;

function snapshot(): Route {
  const href = location.pathname + location.search;
  if (cached?.href !== href) {
    cached = {
      href,
      route: {
        path: location.pathname,
        segments: location.pathname.split('/').filter(Boolean).map(decodeURIComponent),
        query: new URLSearchParams(location.search),
      },
    };
  }
  return cached.route;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot,
  );
}

// Path builders, so screens never hand-assemble URLs.
export const paths = {
  inbox: (view = 'review', mrId?: number) => `/inbox/${view}${mrId ? `?mr=${mrId}` : ''}`,
  review: (mrId: number, file?: string) =>
    `/review/${mrId}${file ? `?file=${encodeURIComponent(file)}` : ''}`,
  pipelines: (projectId?: number) => `/pipelines${projectId ? `?project=${projectId}` : ''}`,
  pipeline: (instanceId: number, projectId: number, pipelineId: number, jobId?: number) =>
    `/pipelines/${instanceId}/${projectId}/${pipelineId}${jobId ? `?job=${jobId}` : ''}`,
  setup: () => '/setup',
  settings: () => '/settings',
};
