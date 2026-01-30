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
  commentsByLine,
  addingCommentAtLine,
  onSubmitComment,
  onCancelComment,
  isSubmitting,
}: DiffHunkProps) {
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
