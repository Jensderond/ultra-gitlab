/**
 * The line cursor: ↑/↓ walk the diff line by line, ⇧↑/⇧↓ extend a range,
 * and C / S act on it. The cursor *is* Pierre's line selection (the same
 * highlight a mouse selection gets), so there is one notion of "these lines".
 *
 * Rows are read from the rendered diff (inside Pierre's shadow root) rather
 * than from the model, so expanded context and split view just work: every
 * line cell carries its unified index, which is the order ↑/↓ follow.
 */

import type { LinePoint } from './diff';
import type { LineRef, Side } from './DiffView';

export interface Row extends LinePoint {
  /** Position in the unified order (shared by both columns of split view). */
  index: number;
  context: boolean;
  el: HTMLElement;
}

/** The two ends of the cursor: `anchor` stays put while ⇧ moves `head`. */
export interface Cursor {
  anchor: LinePoint;
  head: LinePoint;
}

const same = (a: LinePoint, b: LinePoint) => a.side === b.side && a.line === b.line;

/** The diff's shadow root (or the host itself before it attaches). */
export function diffRoot(scroller: HTMLElement | null): ParentNode | null {
  const host = scroller?.querySelector('.rv-diff');
  return host ? (host.shadowRoot ?? host) : null;
}

/** Every line the diff shows, top to bottom. */
export function readRows(scroller: HTMLElement | null): Row[] {
  const root = diffRoot(scroller);
  if (!root) return [];
  const rows = new Map<number, Row>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-content] > [data-line][data-line-index]')) {
    const index = parseInt(el.getAttribute('data-line-index') ?? '', 10);
    const line = parseInt(el.getAttribute('data-line') ?? '', 10);
    if (Number.isNaN(index) || Number.isNaN(line)) continue;
    const type = el.getAttribute('data-line-type') ?? '';
    const context = type.startsWith('context');
    // Split view shows unchanged lines in both columns: take the new side.
    const old = type === 'change-deletion' || (context && !!el.closest('[data-deletions]'));
    if (old && context && rows.has(index)) continue;
    const row: Row = { index, side: old ? 'old' : 'new', line, context, el };
    const seen = rows.get(index);
    if (!seen || (seen.side === 'old' && seen.context)) rows.set(index, row);
  }
  return [...rows.values()].sort((a, b) => a.index - b.index);
}

export function rowAt(rows: Row[], point: LinePoint | null | undefined): number {
  if (!point) return -1;
  const exact = rows.findIndex((r) => same(r, point));
  if (exact >= 0) return exact;
  // An unchanged line named by its old number (a split-view selection on the left).
  return point.side === 'old'
    ? rows.findIndex((r) => r.context && r.el.getAttribute('data-alt-line') === String(point.line))
    : -1;
}

/** The first row that is fully below `top` (viewport y): where the cursor starts. */
export function firstVisibleRow(rows: Row[], top: number, bottom: number): number {
  const i = rows.findIndex((r) => {
    const box = r.el.getBoundingClientRect();
    return box.top >= top - 1 && box.bottom <= bottom + 1;
  });
  return i;
}

/** The cursor as the selection it stands for: top to bottom, `from` only for a range. */
export function cursorRef(rows: Row[], cursor: Cursor): LineRef | null {
  const a = rows[rowAt(rows, cursor.anchor)];
  const b = rows[rowAt(rows, cursor.head)];
  if (!a || !b) return null;
  const [first, last] = a.index <= b.index ? [a, b] : [b, a];
  const point = (r: Row): { side: Side; line: number } => ({ side: r.side, line: r.line });
  return {
    ...point(last),
    context: last.context,
    ...(first === last ? {} : { from: point(first) }),
  };
}

/** A selection (mouse or keyboard) as a cursor whose moving end is its last line. */
export function cursorOf(ref: LineRef): Cursor {
  const head = { side: ref.side, line: ref.line };
  return { anchor: ref.from ?? head, head };
}

/**
 * Scroll just enough to keep `el` in view between `top` and the bottom of
 * the scroller. Instant: the cursor moves on key repeat.
 */
export function keepInView(scroller: HTMLElement, el: HTMLElement, top: number, margin = 42) {
  const box = scroller.getBoundingClientRect();
  const row = el.getBoundingClientRect();
  const above = box.top + top + margin - row.top;
  const below = row.bottom - (box.bottom - margin);
  if (above > 0) scroller.scrollTop -= above;
  else if (below > 0) scroller.scrollTop += below;
}

/** Restart a one-shot CSS animation keyed on `[data-ug-flash]`. */
export function flash(el: Element | null | undefined) {
  if (!el) return;
  el.removeAttribute('data-ug-flash');
  void (el as HTMLElement).offsetWidth;
  el.setAttribute('data-ug-flash', '');
}
