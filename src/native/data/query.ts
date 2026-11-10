/**
 * A small stale-while-revalidate cache for backend reads.
 *
 * Keys are arrays (`['mr', 42]`). Invalidating a prefix (`['mr']`) marks every
 * matching entry stale and refetches the ones somebody is looking at, while
 * the old data stays on screen — so the UI never flashes empty on a refresh.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

export type QueryKey = readonly unknown[];

interface Entry<T = unknown> {
  key: QueryKey;
  data: T | undefined;
  error: Error | undefined;
  updatedAt: number;
  inflight: Promise<void> | null;
  fetcher: (() => Promise<T>) | null;
  listeners: Set<() => void>;
  stale: boolean;
  /** Invalidated while a fetch was in flight: that fetch may predate the change. */
  again: boolean;
  /** Longest staleTime any subscriber asked for (focus refetches respect it). */
  staleTime: number;
  /** refetchInterval of each mounted poller, so focus can catch up on a missed poll. */
  polls: Map<object, number>;
  snapshot: QueryState<T>;
}

export interface QueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  /** True only while there is no data yet. */
  loading: boolean;
  /** True while any fetch is in flight, including background refreshes. */
  fetching: boolean;
}

const cache = new Map<string, Entry>();
const hash = (key: QueryKey) => JSON.stringify(key);

/**
 * Whether this window is in front. Each window is its own webview with its
 * own cache, so this is per window: one left in the background stops polling
 * even while another app window has focus. Starts true unless hidden (not
 * every webview reports hasFocus() reliably at startup); blur flips it.
 */
let focused = typeof document === 'undefined' || !document.hidden;

function entryFor<T>(key: QueryKey): Entry<T> {
  const h = hash(key);
  let e = cache.get(h) as Entry<T> | undefined;
  if (!e) {
    e = {
      key,
      data: undefined,
      error: undefined,
      updatedAt: 0,
      inflight: null,
      fetcher: null,
      listeners: new Set(),
      stale: true,
      again: false,
      staleTime: 0,
      polls: new Map(),
      snapshot: { data: undefined, error: undefined, loading: true, fetching: false },
    };
    cache.set(h, e as Entry);
  }
  return e;
}

function publish(e: Entry) {
  e.snapshot = {
    data: e.data,
    error: e.error,
    loading: e.data === undefined && !e.error,
    fetching: e.inflight !== null,
  };
  e.listeners.forEach((l) => l());
}

function run<T>(e: Entry<T>): Promise<void> {
  if (e.inflight || !e.fetcher) return e.inflight ?? Promise.resolve();
  const fetcher = e.fetcher;
  e.inflight = fetcher()
    .then(
      (data) => {
        e.data = data;
        e.error = undefined;
        e.stale = false;
        e.updatedAt = Date.now();
      },
      (err: unknown) => {
        e.error = err instanceof Error ? err : new Error(String(err));
      },
    )
    .finally(() => {
      e.inflight = null;
      if (e.again) {
        // Started before an invalidation (e.g. a poll racing a mutation):
        // its answer may be outdated, so fetch once more.
        e.again = false;
        e.stale = true;
        void run(e);
        return;
      }
      publish(e as Entry);
    });
  publish(e as Entry);
  return e.inflight;
}

export function matches(key: QueryKey, prefix: QueryKey) {
  return prefix.every((part, i) => hash([part]) === hash([key[i]]));
}

/** Mark matching entries stale and refetch those currently on screen. */
export function invalidate(prefix: QueryKey = []): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const e of cache.values()) {
    if (!matches(e.key, prefix)) continue;
    e.stale = true;
    if (e.inflight) {
      e.again = true;
      jobs.push(e.inflight.then(() => e.inflight ?? undefined));
    } else if (e.listeners.size > 0) jobs.push(run(e));
  }
  return Promise.all(jobs).then(() => undefined);
}

/**
 * Refetch matching on-screen entries that are past their own staleTime (or
 * invalidated, or failed); fresh ones are left alone. For refreshes that
 * shouldn't re-hit GitLab for data that was just read.
 */
export function refetchStale(filter: (key: QueryKey) => boolean): void {
  const now = Date.now();
  for (const e of cache.values()) {
    if (e.listeners.size === 0 || !filter(e.key)) continue;
    if (e.stale || e.error || now - e.updatedAt > e.staleTime) void run(e);
  }
}

/** Read cached data without subscribing. */
export function getData<T>(key: QueryKey): T | undefined {
  return cache.get(hash(key))?.data as T | undefined;
}

/** Optimistically replace cached data. */
export function setData<T>(key: QueryKey, update: T | ((prev: T | undefined) => T)): void {
  const e = entryFor<T>(key);
  e.data =
    typeof update === 'function' ? (update as (prev: T | undefined) => T)(e.data) : update;
  publish(e as Entry);
}

/** Warm the cache (e.g. on hover) so the next screen opens instantly. */
export function prefetch<T>(key: QueryKey, fetcher: () => Promise<T>): Promise<void> {
  const e = entryFor<T>(key);
  if (!e.stale && e.data !== undefined) return Promise.resolve();
  e.fetcher ??= fetcher;
  return run(e);
}

export interface QueryOptions {
  /** Poll while mounted, in ms. */
  refetchInterval?: number;
  /** Data younger than this is not refetched on mount. Default 15s. */
  staleTime?: number;
  /**
   * When false, cached data is still shown but nothing is fetched (no mount
   * fetch, no polling). Default true. Use it to delay network reads, e.g.
   * until the user settles on an item instead of arrowing past it.
   */
  enabled?: boolean;
}

const EMPTY: QueryState<never> = {
  data: undefined,
  error: undefined,
  loading: false,
  fetching: false,
};

/**
 * Subscribe to a cached backend read. Pass `null` as key to skip.
 * While the key changes, the previous key's data is kept (no flash of empty).
 */
export function useQuery<T>(
  key: QueryKey | null,
  fetcher: () => Promise<T>,
  options: QueryOptions = {},
): QueryState<T> & { refetch: () => Promise<void> } {
  const h = key ? hash(key) : null;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => {};
      const e = entryFor<T>(key);
      e.listeners.add(listener);
      return () => e.listeners.delete(listener);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [h],
  );
  const getSnapshot = useCallback(
    () => (key ? entryFor<T>(key).snapshot : (EMPTY as QueryState<T>)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [h],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const staleTime = options.staleTime ?? 15_000;
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!key || !enabled) return;
    const e = entryFor<T>(key);
    e.fetcher = () => fetcherRef.current();
    e.staleTime = Math.max(e.staleTime, staleTime);
    if (e.stale || Date.now() - e.updatedAt > staleTime || e.error) void run(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, enabled]);

  useEffect(() => {
    const interval = options.refetchInterval;
    if (!key || !enabled || !interval) return;
    const e = entryFor<T>(key);
    const token = {};
    e.polls.set(token, interval);
    const id = setInterval(() => {
      // Paused while the window is in the background (focus catches up), and
      // skipped when something else (focus, an invalidation) just refreshed it.
      if (focused && Date.now() - e.updatedAt >= interval / 2) void run(e);
    }, interval);
    return () => {
      clearInterval(id);
      e.polls.delete(token);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, enabled, options.refetchInterval]);

  // Keep showing the previous key's data while the new key loads.
  const previous = useRef<T | undefined>(undefined);
  if (state.data !== undefined) previous.current = state.data;
  const data = state.data ?? (state.loading ? previous.current : undefined);

  const refetch = useCallback(
    () => (key ? run(entryFor<T>(key)) : Promise.resolve()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [h],
  );

  return { ...state, data, loading: state.loading && data === undefined, refetch };
}

/**
 * Lets the event bridge hold back focus refetches of data a background sync
 * is about to refresh anyway (the backend syncs on focus when its data is old).
 */
export interface SyncGate {
  /** Whether sync events refresh this key. */
  covers: (key: QueryKey) => boolean;
  /** Resolves once a sync that is running, or starts shortly, has finished. */
  settled: () => Promise<void>;
}

let syncGate: SyncGate | null = null;
export function setSyncGate(gate: SyncGate) {
  syncGate = gate;
}

/** Focus refetches skip anything younger than this, so alt-tabbing doesn't re-hit GitLab. */
const FOCUS_MIN_AGE = 60_000;

// Native apps refresh what you're looking at when you come back to them:
// at most one fetch per on-screen entry, for entries that are old enough or
// whose poll came due while we were in the background.
function onFocus() {
  if (focused) return;
  focused = true;
  const now = Date.now();
  const later: Entry[] = [];
  for (const e of cache.values()) {
    if (e.listeners.size === 0) continue;
    const age = now - e.updatedAt;
    const pollDue = e.polls.size > 0 && age >= Math.min(...e.polls.values());
    if (!pollDue && age <= Math.max(FOCUS_MIN_AGE, e.staleTime)) continue;
    if (syncGate?.covers(e.key)) later.push(e);
    else void run(e);
  }
  if (!later.length || !syncGate) return;
  // A catch-up sync's events refresh these; only fetch what it didn't reach.
  void syncGate.settled().then(() => {
    for (const e of later) if (e.listeners.size > 0 && e.updatedAt < now) void run(e);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', () => {
    focused = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) focused = false;
    else if (document.hasFocus()) onFocus();
  });
}
