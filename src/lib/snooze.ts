/**
 * Snooze helpers: active-snooze check, preset expiry computation, and
 * badge formatting shared by the MR list components.
 */

import type { MergeRequest } from '../types';

/** True when the MR has a snooze whose expiry is still in the future. */
export function isSnoozed(mr: MergeRequest, nowMs: number = Date.now()): boolean {
  return mr.snoozedUntil != null && mr.snoozedUntil * 1000 > nowMs;
}

export interface SnoozePreset {
  id: string;
  label: string;
  /** Compute the expiry as a Unix timestamp in seconds. */
  until: (now: Date) => number;
}

function atNineAm(date: Date): number {
  const d = new Date(date);
  d.setHours(9, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export const snoozePresets: SnoozePreset[] = [
  {
    id: '1h',
    label: '1 hour',
    until: (now) => Math.floor(now.getTime() / 1000) + 3600,
  },
  {
    id: '4h',
    label: '4 hours',
    until: (now) => Math.floor(now.getTime() / 1000) + 4 * 3600,
  },
  {
    id: 'tomorrow',
    label: 'Tomorrow 9:00',
    until: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return atNineAm(d);
    },
  },
  {
    id: 'next-week',
    label: 'Next week (Mon 9:00)',
    until: (now) => {
      const d = new Date(now);
      const day = d.getDay();
      // Days until next Monday (1); today Monday → next Monday.
      const add = ((8 - day) % 7) || 7;
      d.setDate(d.getDate() + add);
      return atNineAm(d);
    },
  },
];

/** Format a snooze expiry for the "Snoozed until …" badge. */
export function formatSnoozeUntil(untilSeconds: number): string {
  const d = new Date(untilSeconds * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}
