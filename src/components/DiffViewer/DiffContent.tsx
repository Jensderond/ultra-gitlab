import { useCallback, useRef } from 'react';
import { List, type RowComponentProps } from 'react-window';
import type { DiffHunk as DiffHunkType, Comment } from '../../types';
import DiffHunk from './DiffHunk';

const LINE_HEIGHT = 20;
const HUNK_HEADER_HEIGHT = 36;
const ESTIMATED_HUNK_HEIGHT = 200;

function getHunkHeight(hunk: DiffHunkType): number {
  return HUNK_HEADER_HEIGHT + hunk.lines.length * LINE_HEIGHT;
}

interface HunkRowProps {
  hunks: (DiffHunkType | null)[];
  selectedHunk: number | null;
  selectedLine: number | null;
  onLineClick: (hunkIndex: number, lineIndex: number) => void;
  loadingHunks: Set<number>;
  viewMode: 'unified' | 'split';
}

function HunkRow({ index, style, hunks, selectedHunk, selectedLine, onLineClick, loadingHunks, viewMode }: RowComponentProps<HunkRowProps>) {
  const hunk = hunks[index];

  if (hunk === null) {
    return (
      <div style={style} className="diff-hunk-loading">
        <div className="diff-hunk-header">
          <span className="hunk-range">
            {loadingHunks.has(index) ? 'Loading...' : 'Scroll to load'}
          </span>
        </div>
        <div className="diff-hunk-placeholder" />
      </div>
    );
  }

  return (
    <div style={style}>
      <DiffHunk
        hunk={hunk}
        hunkIndex={index}
        selectedLineIndex={selectedHunk === index ? selectedLine ?? undefined : undefined}
        onLineClick={onLineClick}
        viewMode={viewMode}
      />
    </div>
  );
}

interface DiffContentProps {
  effectiveHunks: (DiffHunkType | null)[];
  isLargeDiff: boolean;
  loadingHunks: Set<number>;
  selectedHunk: number | null;
  selectedLine: number | null;
  viewMode: 'unified' | 'split';
  commentsByLine: Map<number, Comment[]>;
  addingCommentAt: { hunk: number; line: number } | null;
  isSubmitting: boolean;
  onLineClick: (hunkIndex: number, lineIndex: number) => void;
  onSubmitComment: (body: string) => void;
  onCancelComment: () => void;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

export default function DiffContent({
  effectiveHunks,
  isLargeDiff,
  loadingHunks,
  selectedHunk,
  selectedLine,
  viewMode,
  commentsByLine,
  addingCommentAt,
  isSubmitting,
  onLineClick,
  onSubmitComment,
  onCancelComment,
  onScroll,
}: DiffContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const getRowHeight = useCallback(
    (index: number) => {
      const hunk = effectiveHunks[index];
      if (hunk === null) return ESTIMATED_HUNK_HEIGHT;
      return getHunkHeight(hunk);
    },
    [effectiveHunks]
  );

  const totalHeight = effectiveHunks.reduce(
    (sum, hunk) => sum + (hunk === null ? ESTIMATED_HUNK_HEIGHT : getHunkHeight(hunk)),
    0
  );
  const useVirtualScrolling = totalHeight > 2000 || isLargeDiff;

  return (
    <div
      className="diff-viewer-content"
      ref={containerRef}
      onScroll={isLargeDiff ? onScroll : undefined}
    >
      {useVirtualScrolling ? (
        <List
          defaultHeight={600}
          rowComponent={HunkRow}
          rowCount={effectiveHunks.length}
          rowHeight={getRowHeight}
          rowProps={{
            hunks: effectiveHunks,
            selectedHunk,
            selectedLine,
            onLineClick,
            loadingHunks,
            viewMode,
          }}
          overscanCount={2}
        />
      ) : (
        effectiveHunks.map((hunk, index) => {
          if (hunk === null) {
            return (
              <div key={`loading-${index}`} className="diff-hunk-loading">
                <div className="diff-hunk-header">
                  <span className="hunk-range">Loading...</span>
                </div>
                <div className="diff-hunk-placeholder" />
              </div>
            );
          }
          return (
            <DiffHunk
              key={`${hunk.oldStart}-${hunk.newStart}`}
              hunk={hunk}
              hunkIndex={index}
              selectedLineIndex={selectedHunk === index ? selectedLine ?? undefined : undefined}
              onLineClick={onLineClick}
              commentsByLine={commentsByLine}
              addingCommentAtLine={addingCommentAt?.hunk === index ? addingCommentAt.line : undefined}
              onSubmitComment={onSubmitComment}
              onCancelComment={onCancelComment}
              isSubmitting={isSubmitting}
              viewMode={viewMode}
            />
          );
        })
      )}
    </div>
  );
}
