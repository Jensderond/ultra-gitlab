/**
 * Diff hunk component for grouping related lines.
 *
 * Displays a hunk header and the contained diff lines.
 * Supports inline comments at specific line positions.
 */

import type { DiffHunk as DiffHunkType, Comment } from '../../types';
import { InlineComment } from '../CommentPanel';
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
  /** Comments grouped by line number */
  commentsByLine?: Map<number, Comment[]>;
  /** Line index where comment input is shown */
  addingCommentAtLine?: number;
  /** Called when submitting a new comment */
  onSubmitComment?: (body: string) => void;
  /** Called when canceling comment input */
  onCancelComment?: () => void;
  /** Whether submitting a comment */
  isSubmitting?: boolean;
  /** View mode: unified or split */
  viewMode?: 'unified' | 'split';
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
 * Build split view rows by pairing old and new lines.
 * Returns an array of { left, right, lineIndex } for rendering.
 */
function buildSplitRows(hunk: DiffHunkType): Array<{
  left: typeof hunk.lines[0] | null;
  right: typeof hunk.lines[0] | null;
  leftLineIndex: number | null;
  rightLineIndex: number | null;
}> {
  const rows: Array<{
    left: typeof hunk.lines[0] | null;
    right: typeof hunk.lines[0] | null;
    leftLineIndex: number | null;
    rightLineIndex: number | null;
  }> = [];

  let i = 0;
  while (i < hunk.lines.length) {
    const line = hunk.lines[i];

    if (line.type === 'context') {
      // Context lines appear on both sides
      rows.push({
        left: line,
        right: line,
        leftLineIndex: i,
        rightLineIndex: i,
      });
      i++;
    } else if (line.type === 'remove') {
      // Collect consecutive removes
      const removes: Array<{ line: typeof line; index: number }> = [];
      while (i < hunk.lines.length && hunk.lines[i].type === 'remove') {
        removes.push({ line: hunk.lines[i], index: i });
        i++;
      }
      // Collect consecutive adds that follow
      const adds: Array<{ line: typeof line; index: number }> = [];
      while (i < hunk.lines.length && hunk.lines[i].type === 'add') {
        adds.push({ line: hunk.lines[i], index: i });
        i++;
      }
      // Pair them up
      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: removes[j]?.line ?? null,
          right: adds[j]?.line ?? null,
          leftLineIndex: removes[j]?.index ?? null,
          rightLineIndex: adds[j]?.index ?? null,
        });
      }
    } else if (line.type === 'add') {
      // Standalone add (no preceding remove)
      rows.push({
        left: null,
        right: line,
        leftLineIndex: null,
        rightLineIndex: i,
      });
      i++;
    } else {
      i++;
    }
  }

  return rows;
}

/**
 * Diff hunk component.
 */
export default function DiffHunk({
  hunk,
  hunkIndex,
  selectedLineIndex,
  onLineClick,
  commentsByLine,
  addingCommentAtLine,
  onSubmitComment,
  onCancelComment,
  isSubmitting,
  viewMode = 'unified',
}: DiffHunkProps) {
  // Unified view rendering
  if (viewMode === 'unified') {
    return (
      <div className="diff-hunk">
        <div className="diff-hunk-header">
          <span className="hunk-range">{formatHunkHeader(hunk)}</span>
        </div>
        <div className="diff-hunk-lines">
          {hunk.lines.map((line, lineIndex) => {
            // Get line number for comment lookup
            const lineNum = line.newLineNumber ?? line.oldLineNumber;
            const lineComments = lineNum !== null ? commentsByLine?.get(lineNum) ?? [] : [];
            const isAddingComment = addingCommentAtLine === lineIndex;

            return (
              <div key={`${hunkIndex}-${lineIndex}`}>
                <DiffLine
                  line={line}
                  selected={selectedLineIndex === lineIndex}
                  onClick={() => onLineClick?.(hunkIndex, lineIndex)}
                />
                {(lineComments.length > 0 || isAddingComment) && (
                  <InlineComment
                    comments={lineComments}
                    isAddingComment={isAddingComment}
                    onSubmitComment={onSubmitComment}
                    onCancelComment={onCancelComment}
                    isSubmitting={isSubmitting}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Split view rendering
  const splitRows = buildSplitRows(hunk);

  return (
    <div className="diff-hunk diff-hunk-split">
      <div className="diff-hunk-header">
        <span className="hunk-range">{formatHunkHeader(hunk)}</span>
      </div>
      <div className="diff-hunk-lines diff-hunk-lines-split">
        {splitRows.map((row, rowIndex) => {
          const leftSelected = row.leftLineIndex !== null && selectedLineIndex === row.leftLineIndex;
          const rightSelected = row.rightLineIndex !== null && selectedLineIndex === row.rightLineIndex;
          const effectiveLineIndex = row.rightLineIndex ?? row.leftLineIndex;

          // Get comments for the right side (new line)
          const lineNum = row.right?.newLineNumber ?? row.left?.oldLineNumber ?? null;
          const lineComments = lineNum !== null ? commentsByLine?.get(lineNum) ?? [] : [];
          const isAddingComment = effectiveLineIndex !== null && addingCommentAtLine === effectiveLineIndex;

          return (
            <div key={`split-${hunkIndex}-${rowIndex}`}>
              <div className="diff-split-row">
                {/* Left side (old) */}
                <div className="diff-split-side diff-split-left">
                  {row.left ? (
                    <DiffLine
                      line={row.left}
                      selected={leftSelected}
                      onClick={() => row.leftLineIndex !== null && onLineClick?.(hunkIndex, row.leftLineIndex)}
                      splitSide="left"
                    />
                  ) : (
                    <div className="diff-line diff-line-empty" />
                  )}
                </div>
                {/* Right side (new) */}
                <div className="diff-split-side diff-split-right">
                  {row.right ? (
                    <DiffLine
                      line={row.right}
                      selected={rightSelected}
                      onClick={() => row.rightLineIndex !== null && onLineClick?.(hunkIndex, row.rightLineIndex)}
                      splitSide="right"
                    />
                  ) : (
                    <div className="diff-line diff-line-empty" />
                  )}
                </div>
              </div>
              {(lineComments.length > 0 || isAddingComment) && (
                <InlineComment
                  comments={lineComments}
                  isAddingComment={isAddingComment}
                  onSubmitComment={onSubmitComment}
                  onCancelComment={onCancelComment}
                  isSubmitting={isSubmitting}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
