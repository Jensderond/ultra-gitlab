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

function matches(key: QueryKey, prefix: QueryKey) {
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
  useEffect(() => {
    if (!key) return;
    const e = entryFor<T>(key);
    e.fetcher = () => fetcherRef.current();
    e.staleTime = Math.max(e.staleTime, staleTime);
    if (e.stale || Date.now() - e.updatedAt > staleTime || e.error) void run(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h]);

  useEffect(() => {
    if (!key || !options.refetchInterval) return;
    const id = setInterval(() => void run(entryFor<T>(key)), options.refetchInterval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, options.refetchInterval]);

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

// Native apps refresh what you're looking at when you come back to them.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    const now = Date.now();
    for (const e of cache.values()) {
      if (e.listeners.size > 0 && now - e.updatedAt > Math.max(30_000, e.staleTime)) void run(e);
    }
  });
}
