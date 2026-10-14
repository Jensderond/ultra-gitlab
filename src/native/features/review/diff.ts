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

/** Text of a line, for "Suggest change". */
export function lineText(model: DiffModel | undefined, side: 'new' | 'old', line: number): string | null {
  if (!model || model.fileDiff.isPartial) return null;
  const lines = side === 'new' ? model.fileDiff.additionLines : model.fileDiff.deletionLines;
  const text = lines[line - 1];
  return text === undefined ? null : text.replace(/\r?\n$/, '');
}
