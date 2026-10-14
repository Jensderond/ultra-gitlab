/** Diff model helpers on top of @pierre/diffs' parsed metadata. */

import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs';
import type { LineKind } from './state';

export interface DiffModel {
  fileDiff: FileDiffMetadata;
  /** New-side line numbers that were added. */
  added: Set<number>;
  /** Old-side line numbers that were removed. */
  deleted: Set<number>;
  /** Line ranges shown by the hunks (inclusive), per side. */
  newRanges: [number, number][];
  oldRanges: [number, number][];
  /** Rendered rows in unified mode — used to decide what counts as "large". */
  rows: number;
}

export function buildDiff(
  name: string,
  oldText: string | null,
  newText: string | null,
  cacheKey: string,
  prevName?: string,
): DiffModel {
  const fileDiff = parseDiffFromFile(
    oldText === null ? null : { name: prevName ?? name, contents: oldText, cacheKey: `${cacheKey}:old` },
    newText === null ? null : { name, contents: newText, cacheKey: `${cacheKey}:new` },
  );
  const added = new Set<number>();
  const deleted = new Set<number>();
  const newRanges: [number, number][] = [];
  const oldRanges: [number, number][] = [];
  for (const hunk of fileDiff.hunks) {
    if (hunk.additionCount > 0) newRanges.push([hunk.additionStart, hunk.additionStart + hunk.additionCount - 1]);
    if (hunk.deletionCount > 0) oldRanges.push([hunk.deletionStart, hunk.deletionStart + hunk.deletionCount - 1]);
    for (const part of hunk.hunkContent) {
      if (part.type !== 'change') continue;
      for (let i = 0; i < part.additions; i++) added.add(part.additionLineIndex + i + 1);
      for (let i = 0; i < part.deletions; i++) deleted.add(part.deletionLineIndex + i + 1);
    }
  }
  return { fileDiff, added, deleted, newRanges, oldRanges, rows: fileDiff.unifiedLineCount };
}

export function isVisible(model: DiffModel, side: 'new' | 'old', line: number): boolean {
  const ranges = side === 'new' ? model.newRanges : model.oldRanges;
  return ranges.some(([a, b]) => line >= a && line <= b);
}

/** What a line is in the merge request's diff (base → head). */
export function lineKind(model: DiffModel | undefined, side: 'new' | 'old', line: number): LineKind {
  if (!model) return 'context';
  if (side === 'new') return model.added.has(line) ? 'add' : 'context';
  return model.deleted.has(line) ? 'del' : 'context';
}

export interface LinePoint {
  side: 'new' | 'old';
  line: number;
}

/**
 * Where an old-side line sits among the new-side lines: the new line of the
 * same row for unchanged lines, the start of the replacement for removed
 * ones. Orders points across sides the way the unified diff shows them.
 */
export function newLineAt(model: DiffModel, point: LinePoint): number {
  if (point.side === 'new') return point.line;
  const index = point.line - 1;
  let offset = 0;
  for (const hunk of model.fileDiff.hunks) {
    for (const part of hunk.hunkContent) {
      if (part.type === 'context') {
        if (index >= part.deletionLineIndex && index < part.deletionLineIndex + part.lines) {
          return part.additionLineIndex + (index - part.deletionLineIndex) + 1;
        }
      } else if (index >= part.deletionLineIndex && index < part.deletionLineIndex + part.deletions) {
        return part.additionLineIndex + 1;
      }
    }
    if (index < hunk.deletionStart - 1) break;
    offset = hunk.additionStart + hunk.additionCount - (hunk.deletionStart + hunk.deletionCount);
  }
  return point.line + offset;
}

/** The two ends of a selection, top first. Removed lines come before the lines that replace them. */
export function orderPoints(model: DiffModel, a: LinePoint, b: LinePoint): [LinePoint, LinePoint] {
  const key = (p: LinePoint) => newLineAt(model, p) * 2 + (p.side === 'old' ? 0 : 1);
  const ka = key(a);
  const kb = key(b);
  if (ka !== kb) return ka < kb ? [a, b] : [b, a];
  // Same row on the old side (a run of removed lines): order by line.
  return a.line <= b.line ? [a, b] : [b, a];
}

export interface SuggestionSource {
  /** Current text of the new-side lines being replaced. */
  text: string;
  /** Lines above the anchor (the last line) that the suggestion replaces. */
  above: number;
}

/**
 * The new-version lines a suggestion on `from`..`to` replaces. Null when the
 * range ends on a removed line: suggestions apply to the new version.
 */
export function suggestionSource(model: DiffModel | undefined, from: LinePoint | undefined, to: LinePoint): SuggestionSource | null {
  if (!model || model.fileDiff.isPartial || to.side !== 'new') return null;
  const first = Math.min(to.line, from ? newLineAt(model, from) : to.line);
  const lines = model.fileDiff.additionLines.slice(first - 1, to.line);
  if (lines.length !== to.line - first + 1) return null;
  return { text: lines.map((l) => l.replace(/\r?\n$/, '')).join('\n'), above: to.line - first };
}
