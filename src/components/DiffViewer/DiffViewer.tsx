/**
 * Main diff viewer container component.
 *
 * Displays syntax-highlighted diffs with virtual scrolling
 * for performance with large files. Supports inline comments.
 *
 * For large diffs (>10k lines), uses progressive loading to
 * fetch hunks on-demand as the user scrolls.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { List, type RowComponentProps } from 'react-window';
import type { DiffFileContent, DiffHunk as DiffHunkType, DiffFileMetadata, Comment } from '../../types';
import { getFileDiff, getFileDiffMetadata, getFileDiffHunks } from '../../services/gitlab';
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

/** Number of hunks to load at a time for progressive loading */
const HUNK_BATCH_SIZE = 20;

/** Buffer of hunks to load ahead of visible area */
const HUNK_PREFETCH_BUFFER = 10;

/**
 * Calculate the height of a hunk including its lines.
 */
function getHunkHeight(hunk: DiffHunkType): number {
  return HUNK_HEADER_HEIGHT + hunk.lines.length * LINE_HEIGHT;
}

/** Placeholder height for not-yet-loaded hunks (estimated) */
const ESTIMATED_HUNK_HEIGHT = 200;

/**
 * Props passed to the row component.
 */
interface HunkRowProps {
  hunks: (DiffHunkType | null)[];
  selectedHunk: number | null;
  selectedLine: number | null;
  onLineClick: (hunkIndex: number, lineIndex: number) => void;
  loadingHunks: Set<number>;
}

/**
 * Row component for virtual list rendering.
 */
function HunkRow({ index, style, hunks, selectedHunk, selectedLine, onLineClick, loadingHunks }: RowComponentProps<HunkRowProps>) {
  const hunk = hunks[index];

  // Show loading state for not-yet-loaded hunks
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
  const [metadata, setMetadata] = useState<DiffFileMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHunk, setSelectedHunk] = useState<number | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [addingCommentAt, setAddingCommentAt] = useState<{ hunk: number; line: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Progressive loading state
  const [isLargeDiff, setIsLargeDiff] = useState(false);
  const [hunks, setHunks] = useState<(DiffHunkType | null)[]>([]);
  const [loadingHunks, setLoadingHunks] = useState<Set<number>>(new Set());
  const [loadedRanges, setLoadedRanges] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Load diff content - either all at once or progressively
  useEffect(() => {
    async function loadDiff() {
      try {
        setLoading(true);
        setError(null);
        setIsLargeDiff(false);
        setHunks([]);
        setLoadedRanges(new Set());

        // First, get metadata to check if this is a large diff
        const meta = await getFileDiffMetadata(mrId, filePath);
        setMetadata(meta);

        if (meta.isLarge) {
          // Large diff - use progressive loading
          setIsLargeDiff(true);
          // Initialize with null placeholders for all hunks
          setHunks(new Array(meta.hunkCount).fill(null));
          // Load the first batch
          await loadHunkRange(0, HUNK_BATCH_SIZE);
        } else {
          // Normal diff - load all at once
          const content = await getFileDiff(mrId, filePath);
          setDiffContent(content);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load diff');
      } finally {
        setLoading(false);
      }
    }
    loadDiff();
  }, [mrId, filePath]);

  // Load a range of hunks for progressive loading
  const loadHunkRange = useCallback(async (start: number, count: number) => {
    // Skip if already loaded or currently loading
    const rangesToLoad: number[] = [];
    for (let i = start; i < start + count; i++) {
      if (!loadedRanges.has(i) && !loadingHunks.has(i)) {
        rangesToLoad.push(i);
      }
    }

    if (rangesToLoad.length === 0) return;

    // Mark as loading
    setLoadingHunks(prev => {
      const next = new Set(prev);
      rangesToLoad.forEach(i => next.add(i));
      return next;
    });

    try {
      // Calculate the actual range to fetch (contiguous)
      const actualStart = Math.min(...rangesToLoad);
      const actualEnd = Math.max(...rangesToLoad) + 1;
      const actualCount = actualEnd - actualStart;

      const response = await getFileDiffHunks(mrId, filePath, actualStart, actualCount);

      // Update hunks array with loaded data
      setHunks(prev => {
        const next = [...prev];
        response.hunks.forEach((hunk, i) => {
          next[response.startIndex + i] = hunk;
        });
        return next;
      });

      // Mark as loaded
      setLoadedRanges(prev => {
        const next = new Set(prev);
        for (let i = response.startIndex; i < response.startIndex + response.hunks.length; i++) {
          next.add(i);
        }
        return next;
      });
    } catch (err) {
      console.error('Failed to load hunks:', err);
    } finally {
      // Clear loading state
      setLoadingHunks(prev => {
        const next = new Set(prev);
        rangesToLoad.forEach(i => next.delete(i));
        return next;
      });
    }
  }, [mrId, filePath, loadedRanges, loadingHunks]);

  // Handle scroll for progressive loading
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!isLargeDiff || !metadata) return;

    const scrollOffset = e.currentTarget.scrollTop;

    // Estimate which hunks are visible based on scroll position
    // This is approximate since hunks have variable heights
    const estimatedVisibleStart = Math.floor(scrollOffset / ESTIMATED_HUNK_HEIGHT);
    const estimatedVisibleEnd = estimatedVisibleStart + 10; // Assume ~10 hunks visible

    // Load a range around the visible area
    const loadStart = Math.max(0, estimatedVisibleStart - HUNK_PREFETCH_BUFFER);
    const loadEnd = Math.min(metadata.hunkCount, estimatedVisibleEnd + HUNK_PREFETCH_BUFFER);

    loadHunkRange(loadStart, loadEnd - loadStart);
  }, [isLargeDiff, metadata, loadHunkRange]);

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

  // Get the effective hunks (from diffContent or progressive loading)
  const effectiveHunks = useMemo(() => {
    if (isLargeDiff) {
      return hunks;
    }
    return diffContent?.diffHunks ?? [];
  }, [isLargeDiff, hunks, diffContent]);

  // Find all change positions (added/removed lines)
  const changePositions = useMemo(() => {
    const positions: { hunk: number; line: number }[] = [];
    effectiveHunks.forEach((hunk, hunkIdx) => {
      if (hunk === null) return; // Skip unloaded hunks
      hunk.lines.forEach((line, lineIdx) => {
        if (line.type === 'add' || line.type === 'remove') {
          positions.push({ hunk: hunkIdx, line: lineIdx });
        }
      });
    });
    return positions;
  }, [effectiveHunks]);

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
    if (!addingCommentAt || !currentUser) return;

    // Get the hunk and line
    const hunk = effectiveHunks[addingCommentAt.hunk];
    if (!hunk) return;
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
  }, [addingCommentAt, effectiveHunks, mrId, projectId, mrIid, filePath, currentUser, baseSha, headSha, startSha]);

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
      const hunk = effectiveHunks[index];
      if (hunk === null) {
        // Unloaded hunk - use estimated height
        return ESTIMATED_HUNK_HEIGHT;
      }
      return getHunkHeight(hunk);
    },
    [effectiveHunks]
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
  if (effectiveHunks.length === 0) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-empty">No changes in this file</div>
      </div>
    );
  }

  // Calculate total height for small diffs (no virtual scrolling needed)
  const totalHeight = effectiveHunks.reduce(
    (sum, hunk) => sum + (hunk === null ? ESTIMATED_HUNK_HEIGHT : getHunkHeight(hunk)),
    0
  );
  const useVirtualScrolling = totalHeight > 2000 || isLargeDiff;

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <span className="diff-file-path">{filePath}</span>
        <div className="diff-header-right">
          {isLargeDiff && metadata && (
            <span className="diff-large-indicator">
              Large diff ({metadata.totalLines.toLocaleString()} lines)
            </span>
          )}
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
      </div>

      <div
        className="diff-viewer-content"
        ref={containerRef}
        onScroll={isLargeDiff ? handleScroll : undefined}
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
              onLineClick: handleLineClick,
              loadingHunks,
            }}
            overscanCount={2}
          />
        ) : (
          effectiveHunks.map((hunk, index) => {
            if (hunk === null) {
              return (
                <div key={index} className="diff-hunk-loading">
                  <div className="diff-hunk-header">
                    <span className="hunk-range">Loading...</span>
                  </div>
                  <div className="diff-hunk-placeholder" />
                </div>
              );
            }
            return (
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
            );
          })
        )}
      </div>
    </div>
  );
}
