/**
 * Main diff viewer container component.
 *
 * Displays syntax-highlighted diffs with virtual scrolling
 * for performance with large files. Supports inline comments.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { List, type RowComponentProps } from 'react-window';
import type { DiffFileContent, DiffHunk as DiffHunkType, Comment } from '../../types';
import { getFileDiff } from '../../services/gitlab';
import { invoke } from '../../services/tauri';
import DiffHunk from './DiffHunk';
import './DiffViewer.css';

interface DiffViewerProps {
  /** Merge request ID */
  mrId: number;
  /** Project ID for API calls */
  projectId: number;
  /** MR IID for API calls */
  mrIid: number;
  /** File path to display */
  filePath: string;
  /** Current user's username */
  currentUser?: string;
  /** View mode: unified or split */
  viewMode?: 'unified' | 'split';
  /** Callback when view mode changes */
  onViewModeChange?: (mode: 'unified' | 'split') => void;
  /** Base SHA for inline comments */
  baseSha?: string;
  /** Head SHA for inline comments */
  headSha?: string;
  /** Start SHA for inline comments */
  startSha?: string;
}

const LINE_HEIGHT = 20;
const HUNK_HEADER_HEIGHT = 36;

/**
 * Calculate the height of a hunk including its lines.
 */
function getHunkHeight(hunk: DiffHunkType): number {
  return HUNK_HEADER_HEIGHT + hunk.lines.length * LINE_HEIGHT;
}

/**
 * Props passed to the row component.
 */
interface HunkRowProps {
  hunks: DiffHunkType[];
  selectedHunk: number | null;
  selectedLine: number | null;
  onLineClick: (hunkIndex: number, lineIndex: number) => void;
}

/**
 * Row component for virtual list rendering.
 */
function HunkRow({ index, style, hunks, selectedHunk, selectedLine, onLineClick }: RowComponentProps<HunkRowProps>) {
  const hunk = hunks[index];
  return (
    <div style={style}>
      <DiffHunk
        hunk={hunk}
        hunkIndex={index}
        selectedLineIndex={selectedHunk === index ? selectedLine ?? undefined : undefined}
        onLineClick={onLineClick}
      />
    </div>
  );
}

/**
 * Main diff viewer component.
 */
export default function DiffViewer({
  mrId,
  projectId,
  mrIid,
  filePath,
  currentUser,
  viewMode = 'unified',
  onViewModeChange,
  baseSha,
  headSha,
  startSha,
}: DiffViewerProps) {
  const [diffContent, setDiffContent] = useState<DiffFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHunk, setSelectedHunk] = useState<number | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [addingCommentAt, setAddingCommentAt] = useState<{ hunk: number; line: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load diff content
  useEffect(() => {
    async function loadDiff() {
      try {
        setLoading(true);
        setError(null);
        const content = await getFileDiff(mrId, filePath);
        setDiffContent(content);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load diff');
      } finally {
        setLoading(false);
      }
    }
    loadDiff();
  }, [mrId, filePath]);

  // Load comments for this file
  useEffect(() => {
    async function loadComments() {
      try {
        const result = await invoke<Comment[]>('get_file_comments', { mrId, filePath });
        setComments(result);
      } catch (err) {
        console.error('Failed to load comments:', err);
      }
    }
    loadComments();
  }, [mrId, filePath]);

  // Handle line selection
  const handleLineClick = useCallback((hunkIndex: number, lineIndex: number) => {
    setSelectedHunk(hunkIndex);
    setSelectedLine(lineIndex);
  }, []);

  // Find all change positions (added/removed lines)
  const changePositions = useMemo(() => {
    if (!diffContent) return [];
    const positions: { hunk: number; line: number }[] = [];
    diffContent.diffHunks.forEach((hunk, hunkIdx) => {
      hunk.lines.forEach((line, lineIdx) => {
        if (line.type === 'add' || line.type === 'remove') {
          positions.push({ hunk: hunkIdx, line: lineIdx });
        }
      });
    });
    return positions;
  }, [diffContent]);

  // Navigate to next/prev change
  const navigateToChange = useCallback((direction: 1 | -1) => {
    if (changePositions.length === 0) return;

    // Find current position in change list
    let currentIndex = -1;
    if (selectedHunk !== null && selectedLine !== null) {
      currentIndex = changePositions.findIndex(
        (pos) => pos.hunk === selectedHunk && pos.line === selectedLine
      );
    }

    // Calculate next position
    let nextIndex: number;
    if (currentIndex === -1) {
      // No selection - start from beginning or end
      nextIndex = direction === 1 ? 0 : changePositions.length - 1;
    } else {
      nextIndex = currentIndex + direction;
      // Wrap around
      if (nextIndex < 0) nextIndex = changePositions.length - 1;
      if (nextIndex >= changePositions.length) nextIndex = 0;
    }

    const nextPos = changePositions[nextIndex];
    setSelectedHunk(nextPos.hunk);
    setSelectedLine(nextPos.line);
  }, [changePositions, selectedHunk, selectedLine]);

  // Handle keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // 'c' key to add comment at selected line
      if (e.key === 'c' && selectedHunk !== null && selectedLine !== null && !addingCommentAt) {
        e.preventDefault();
        setAddingCommentAt({ hunk: selectedHunk, line: selectedLine });
        return;
      }

      // Escape to cancel comment
      if (e.key === 'Escape' && addingCommentAt) {
        setAddingCommentAt(null);
        return;
      }

      // ']' for next change
      if (e.key === ']' && !addingCommentAt) {
        e.preventDefault();
        navigateToChange(1);
        return;
      }

      // '[' for previous change
      if (e.key === '[' && !addingCommentAt) {
        e.preventDefault();
        navigateToChange(-1);
        return;
      }

      // 'd' to toggle view mode
      if (e.key === 'd' && !addingCommentAt && onViewModeChange) {
        e.preventDefault();
        onViewModeChange(viewMode === 'unified' ? 'split' : 'unified');
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedHunk, selectedLine, addingCommentAt, navigateToChange, viewMode, onViewModeChange]);

  // Add comment handler
  const handleAddComment = useCallback(async (body: string) => {
    if (!addingCommentAt || !diffContent || !currentUser) return;

    const hunk = diffContent.diffHunks[addingCommentAt.hunk];
    const line = hunk.lines[addingCommentAt.line];

    try {
      setIsSubmitting(true);
      await invoke('add_comment', {
        input: {
          mrId,
          projectId,
          mrIid,
          body,
          authorUsername: currentUser,
          filePath,
          oldLine: line.oldLineNumber,
          newLine: line.newLineNumber,
          lineType: line.type,
          baseSha,
          headSha,
          startSha,
        },
      });

      // Refresh comments
      const result = await invoke<Comment[]>('get_file_comments', { mrId, filePath });
      setComments(result);
      setAddingCommentAt(null);
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [addingCommentAt, diffContent, mrId, projectId, mrIid, filePath, currentUser, baseSha, headSha, startSha]);

  // Group comments by line number
  const commentsByLine = useMemo(() => {
    const map = new Map<number, Comment[]>();
    for (const comment of comments) {
      const lineNum = comment.newLine ?? comment.oldLine;
      if (lineNum !== null) {
        const existing = map.get(lineNum) ?? [];
        existing.push(comment);
        map.set(lineNum, existing);
      }
    }
    return map;
  }, [comments]);

  // Get item size for virtual scrolling
  const getRowHeight = useCallback(
    (index: number) => {
      if (!diffContent) return 0;
      return getHunkHeight(diffContent.diffHunks[index]);
    },
    [diffContent]
  );

  // Loading state
  if (loading) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-loading">Loading diff...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-error">{error}</div>
      </div>
    );
  }

  // No content
  if (!diffContent || diffContent.diffHunks.length === 0) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-empty">No changes in this file</div>
      </div>
    );
  }

  // Calculate total height for small diffs (no virtual scrolling needed)
  const totalHeight = diffContent.diffHunks.reduce(
    (sum, hunk) => sum + getHunkHeight(hunk),
    0
  );
  const useVirtualScrolling = totalHeight > 2000;

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <span className="diff-file-path">{filePath}</span>
        <div className="diff-view-toggle">
          <button
            className={viewMode === 'unified' ? 'active' : ''}
            onClick={() => onViewModeChange?.('unified')}
          >
            Unified
          </button>
          <button
            className={viewMode === 'split' ? 'active' : ''}
            onClick={() => onViewModeChange?.('split')}
          >
            Split
          </button>
        </div>
      </div>

      <div className="diff-viewer-content">
        {useVirtualScrolling ? (
          <List
            defaultHeight={600}
            rowComponent={HunkRow}
            rowCount={diffContent.diffHunks.length}
            rowHeight={getRowHeight}
            rowProps={{
              hunks: diffContent.diffHunks,
              selectedHunk,
              selectedLine,
              onLineClick: handleLineClick,
            }}
            overscanCount={2}
          />
        ) : (
          diffContent.diffHunks.map((hunk, index) => (
            <DiffHunk
              key={index}
              hunk={hunk}
              hunkIndex={index}
              selectedLineIndex={selectedHunk === index ? selectedLine ?? undefined : undefined}
              onLineClick={handleLineClick}
              commentsByLine={commentsByLine}
              addingCommentAtLine={addingCommentAt?.hunk === index ? addingCommentAt.line : undefined}
              onSubmitComment={handleAddComment}
              onCancelComment={() => setAddingCommentAt(null)}
              isSubmitting={isSubmitting}
            />
          ))
        )}
      </div>
    </div>
  );
}
