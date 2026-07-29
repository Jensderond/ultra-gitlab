/**
 * Remembered reading position of the MR list, per instance and status tab.
 *
 * Kept outside React because every visit to an MR detail page unmounts the
 * list, and the return trip can be a history POP — which is what iOS's native
 * edge-swipe-back gesture fires. A POP restores its own history entry, so
 * nothing handed forward through `navigate(..., { state })` survives it; this
 * store is what lets the list come back looking like the user left it.
 *
 * Session-scoped on purpose: it restores where you were a moment ago, not
 * where you were last week, so it is never persisted.
 */

export interface ListPosition {
  /** Scroll offset of the list's scroll container. */
  scrollTop: number;
  /** Index of the focused/highlighted row. */
  focusIndex: number;
}

const positions = new Map<string, ListPosition>();

/** Positions are per instance *and* per tab — each tab scrolls independently. */
export function positionKey(instanceId: number, tab: string): string {
  return `${instanceId}:${tab}`;
}

export function readPosition(key: string): ListPosition | undefined {
  return positions.get(key);
}

export function writePosition(key: string, patch: Partial<ListPosition>): void {
  positions.set(key, {
    scrollTop: 0,
    focusIndex: 0,
    ...positions.get(key),
    ...patch,
  });
}
