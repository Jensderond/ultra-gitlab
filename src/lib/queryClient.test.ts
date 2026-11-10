import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver, environmentManager, focusManager, type Query } from '@tanstack/react-query';
import {
  FOCUS_REFETCH_COOLDOWN_MS,
  queryClient,
  refetchOnFocusAfterCooldown,
  trackWindowFocus,
} from './queryClient';

function queryWith(state: Partial<Query['state']>): Query {
  return {
    state: { dataUpdatedAt: 0, errorUpdatedAt: 0, isInvalidated: false, ...state },
  } as Query;
}

describe('refetchOnFocusAfterCooldown', () => {
  const now = 1_000_000_000;
  afterEach(() => vi.useRealTimers());

  it('skips queries fetched within the cooldown', () => {
    vi.useFakeTimers({ now });
    expect(refetchOnFocusAfterCooldown(queryWith({ dataUpdatedAt: now - 5_000 }))).toBe(false);
  });

  it('refetches once the cooldown has passed', () => {
    vi.useFakeTimers({ now });
    const q = queryWith({ dataUpdatedAt: now - FOCUS_REFETCH_COOLDOWN_MS });
    expect(refetchOnFocusAfterCooldown(q)).toBe(true);
  });

  it('counts a recent failed fetch as a fetch', () => {
    vi.useFakeTimers({ now });
    const q = queryWith({ dataUpdatedAt: now - 10 * 60_000, errorUpdatedAt: now - 1_000 });
    expect(refetchOnFocusAfterCooldown(q)).toBe(false);
  });

  it('always refetches invalidated queries', () => {
    vi.useFakeTimers({ now });
    const q = queryWith({ dataUpdatedAt: now - 1_000, isInvalidated: true });
    expect(refetchOnFocusAfterCooldown(q)).toBe(true);
  });
});

describe('trackWindowFocus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(hasFocus: boolean) {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible' as DocumentVisibilityState,
      hasFocus: () => hasFocus,
    });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    trackWindowFocus();
    return { win, doc };
  }

  it('is unfocused while the window is visible but blurred', () => {
    const { win } = setup(true);
    expect(focusManager.isFocused()).toBe(true);
    win.dispatchEvent(new Event('blur'));
    expect(focusManager.isFocused()).toBe(false);
    win.dispatchEvent(new Event('focus'));
    expect(focusManager.isFocused()).toBe(true);
  });

  it('starts unfocused when the window opens in the background', () => {
    setup(false);
    expect(focusManager.isFocused()).toBe(false);
  });

  it('is unfocused while hidden, even with window focus', () => {
    const { doc } = setup(true);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(focusManager.isFocused()).toBe(false);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(focusManager.isFocused()).toBe(true);
  });
});

describe('interval polling with window focus', () => {
  afterEach(() => {
    queryClient.unmount();
    queryClient.clear();
    environmentManager.setIsServer(() => typeof window === 'undefined');
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pauses while blurred and does not double-fetch on a quick return', async () => {
    vi.useFakeTimers();
    // query-core treats a runtime without `window` (vitest's node env) as a
    // server and never starts intervals there.
    environmentManager.setIsServer(() => false);
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new EventTarget(), {
      visibilityState: 'visible',
      hasFocus: () => true,
    }));
    trackWindowFocus();
    queryClient.mount();

    const queryFn = vi.fn(async () => 'trace');
    const observer = new QueryObserver(queryClient, {
      queryKey: ['poll-test'],
      queryFn,
      staleTime: 0,
      refetchInterval: 3_000,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(queryFn).toHaveBeenCalledTimes(2);

    win.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(queryFn).toHaveBeenCalledTimes(2);

    // Back within the cooldown: no focus refetch, polling resumes on its tick.
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(queryFn).toHaveBeenCalledTimes(3);

    // Away longer than the cooldown: one immediate refetch on focus.
    win.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(FOCUS_REFETCH_COOLDOWN_MS);
    expect(queryFn).toHaveBeenCalledTimes(3);
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(4);
    // The fetch restarted the interval, so no tick piggybacks right after it.
    await vi.advanceTimersByTimeAsync(2_900);
    expect(queryFn).toHaveBeenCalledTimes(4);

    unsubscribe();
  });
});
