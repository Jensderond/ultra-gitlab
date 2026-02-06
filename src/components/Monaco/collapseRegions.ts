import type { editor } from "monaco-editor";

/** A region of lines that should be hidden/collapsed */
export interface CollapseRegion {
  startLine: number;
  endLine: number;
}

/** Number of context lines to keep visible around each change */
const CONTEXT_LINES = 5;

/**
 * Compute which line ranges should be collapsed in the original and modified
 * sides of a diff, keeping CONTEXT_LINES of context around each change.
 *
 * @param lineChanges - Array of ILineChange from Monaco's diff editor
 * @param originalLineCount - Total lines in the original file
 * @param modifiedLineCount - Total lines in the modified file
 * @returns Collapse regions for both original and modified editors
 */
export function computeCollapseRegions(
  lineChanges: editor.ILineChange[],
  originalLineCount: number,
  modifiedLineCount: number
): { original: CollapseRegion[]; modified: CollapseRegion[] } {
  const originalVisible = computeVisibleRanges(
    lineChanges.map((c) => ({
      start: c.originalStartLineNumber,
      end: c.originalEndLineNumber,
    })),
    originalLineCount
  );
  const modifiedVisible = computeVisibleRanges(
    lineChanges.map((c) => ({
      start: c.modifiedStartLineNumber,
      end: c.modifiedEndLineNumber,
    })),
    modifiedLineCount
  );

  return {
    original: invertToCollapseRegions(originalVisible, originalLineCount),
    modified: invertToCollapseRegions(modifiedVisible, modifiedLineCount),
  };
}

interface LineRange {
  start: number;
  end: number;
}

/**
 * From an array of changed ranges, compute merged visible ranges
 * (each change expanded by CONTEXT_LINES in both directions).
 *
 * For insertions/deletions where end === 0, the change has no lines on that
 * side, but we still keep context around the insertion/deletion point (the
 * start value indicates the line *before* the gap).
 */
function computeVisibleRanges(
  changes: LineRange[],
  totalLines: number
): LineRange[] {
  if (changes.length === 0) {
    // No changes — nothing is visible (entire file collapses)
    return [];
  }

  // Build raw visible ranges with context
  const raw: LineRange[] = [];
  for (const change of changes) {
    if (change.end === 0) {
      // Pure insertion (original side) or pure deletion (modified side):
      // start is the line before the gap. Show context around that point.
      const anchor = change.start;
      raw.push({
        start: Math.max(1, anchor - CONTEXT_LINES + 1),
        end: Math.min(totalLines, anchor + CONTEXT_LINES),
      });
    } else {
      // Normal change range: expand by context
      raw.push({
        start: Math.max(1, change.start - CONTEXT_LINES),
        end: Math.min(totalLines, change.end + CONTEXT_LINES),
      });
    }
  }

  // Sort by start line
  raw.sort((a, b) => a.start - b.start);

  // Merge overlapping/adjacent ranges
  const merged: LineRange[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    const cur = raw[i];
    if (cur.start <= last.end + 1) {
      // Overlapping or adjacent — merge
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push(cur);
    }
  }

  return merged;
}

/**
 * Invert visible ranges to get collapse (hidden) regions.
 * Everything not in a visible range becomes a collapse region.
 */
function invertToCollapseRegions(
  visibleRanges: LineRange[],
  totalLines: number
): CollapseRegion[] {
  if (totalLines === 0) return [];

  // If no visible ranges, collapse everything
  if (visibleRanges.length === 0) {
    return [{ startLine: 1, endLine: totalLines }];
  }

  const regions: CollapseRegion[] = [];

  // Gap before first visible range
  if (visibleRanges[0].start > 1) {
    regions.push({
      startLine: 1,
      endLine: visibleRanges[0].start - 1,
    });
  }

  // Gaps between visible ranges
  for (let i = 0; i < visibleRanges.length - 1; i++) {
    const gapStart = visibleRanges[i].end + 1;
    const gapEnd = visibleRanges[i + 1].start - 1;
    if (gapStart <= gapEnd) {
      regions.push({ startLine: gapStart, endLine: gapEnd });
    }
  }

  // Gap after last visible range
  const last = visibleRanges[visibleRanges.length - 1];
  if (last.end < totalLines) {
    regions.push({
      startLine: last.end + 1,
      endLine: totalLines,
    });
  }

  return regions;
}
