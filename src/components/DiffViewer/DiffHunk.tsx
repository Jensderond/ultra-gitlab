/**
 * Diff hunk component for grouping related lines.
 *
 * Displays a hunk header and the contained diff lines.
 */

import type { DiffHunk as DiffHunkType } from '../../types';
import DiffLine from './DiffLine';
import './DiffHunk.css';

interface DiffHunkProps {
  /** The hunk data */
  hunk: DiffHunkType;
  /** Index of this hunk in the list */
  hunkIndex: number;
  /** Currently selected line (for commenting) */
  selectedLineIndex?: number;
  /** Callback when a line is clicked */
  onLineClick?: (hunkIndex: number, lineIndex: number) => void;
}

/**
 * Format the hunk header showing line ranges.
 */
function formatHunkHeader(hunk: DiffHunkType): string {
  const oldRange =
    hunk.oldCount === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldCount}`;
  const newRange =
    hunk.newCount === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newCount}`;
  return `@@ -${oldRange} +${newRange} @@`;
}

/**
 * Diff hunk component.
 */
export default function DiffHunk({
  hunk,
  hunkIndex,
  selectedLineIndex,
  onLineClick,
}: DiffHunkProps) {
  return (
    <div className="diff-hunk">
      <div className="diff-hunk-header">
        <span className="hunk-range">{formatHunkHeader(hunk)}</span>
      </div>
      <div className="diff-hunk-lines">
        {hunk.lines.map((line, lineIndex) => (
          <DiffLine
            key={`${hunkIndex}-${lineIndex}`}
            line={line}
            selected={selectedLineIndex === lineIndex}
            onClick={() => onLineClick?.(hunkIndex, lineIndex)}
          />
        ))}
      </div>
    </div>
  );
}
