/** Composer text that outlives the composer: unsent drafts and seeded suggestions. */

import { composerKey, type ComposerTarget } from './context';
import type { LinePoint } from './diff';

/** "line 12", "lines 12–18", "old line 4 – line 6". */
export function linesLabel(to: LinePoint, from?: LinePoint): string {
  const one = (p: LinePoint) => `${p.side === 'old' ? 'old ' : ''}line ${p.line}`;
  if (!from || (from.side === to.side && from.line === to.line)) return one(to);
  if (from.side === to.side) return `${to.side === 'old' ? 'old ' : ''}lines ${from.line}–${to.line}`;
  return `${one(from)} – ${one(to)}`;
}

/** Unsent composer text survives closing the composer or switching files. */
export const unsent = new Map<string, string>();

/** Open composers, told when text is seeded into them. */
const seedListeners = new Set<(key: string) => void>();

export function onSeed(listener: (key: string) => void): () => void {
  seedListeners.add(listener);
  return () => seedListeners.delete(listener);
}

/** Put text in a composer (open or not), after anything already typed there. */
export function seedComposer(mrId: number, target: ComposerTarget, text: string) {
  const key = `${mrId}:${composerKey(target)}`;
  const prev = unsent.get(key)?.trimEnd();
  unsent.set(key, prev ? `${prev}\n\n${text}\n` : `${text}\n`);
}

/** The suggested lines to select when a seeded composer opens, while its text is as seeded. */
const seededCaret = new Map<string, { text: string; range: [number, number] }>();

/** The body offsets of a suggestion block's lines, for selecting them. */
export function blockLines(block: string, at: number): [number, number] {
  const start = at + block.indexOf('\n') + 1;
  const end = at + block.lastIndexOf('\n');
  return start <= end ? [start, end] : [start, start];
}

/** Where to put the selection when the composer for `key` opens with `text`. */
export function caretFor(key: string, text: string): [number, number] | undefined {
  const seeded = seededCaret.get(key);
  return seeded?.text === text ? seeded.range : undefined;
}

/** Seed a composer with a suggestion and select the suggested lines when it opens. */
export function seedSuggestion(mrId: number, target: ComposerTarget, block: string) {
  seedComposer(mrId, target, block);
  const key = `${mrId}:${composerKey(target)}`;
  const body = unsent.get(key)!;
  seededCaret.set(key, { text: body, range: blockLines(block, body.lastIndexOf(block)) });
  for (const listener of seedListeners) listener(key);
}
