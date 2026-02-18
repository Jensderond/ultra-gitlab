import { useEffect, useCallback, useMemo, useReducer, useRef } from 'react';
import type { DiffHunk } from '../../types';
import { getFileDiff, getFileDiffMetadata, getFileDiffHunks } from '../../services/gitlab';
import { diffViewerReducer, initialState } from './diffViewerReducer';

/** Number of hunks to load at a time for progressive loading */
const HUNK_BATCH_SIZE = 20;

/** Buffer of hunks to load ahead of visible area */
const HUNK_PREFETCH_BUFFER = 10;

/** Placeholder height for not-yet-loaded hunks (estimated) */
const ESTIMATED_HUNK_HEIGHT = 200;

/** Performance target: <100ms for diff open */
const PERF_TARGET_MS = 100;

interface UseDiffDataOptions {
  mrId: number;
  filePath: string;
}

export function useDiffData({ mrId, filePath }: UseDiffDataOptions) {
  const [state, dispatch] = useReducer(diffViewerReducer, initialState);

  // Use refs for progressive loading to avoid stale closures
  const loadedRangesRef = useRef(state.loadedRanges);
  const loadingHunksRef = useRef(state.loadingHunks);
  loadedRangesRef.current = state.loadedRanges;
  loadingHunksRef.current = state.loadingHunks;

  // Load a range of hunks for progressive loading
  const loadHunkRange = useCallback(async (start: number, count: number) => {
    const rangesToLoad: number[] = [];
    for (let i = start; i < start + count; i++) {
      if (!loadedRangesRef.current.has(i) && !loadingHunksRef.current.has(i)) {
        rangesToLoad.push(i);
      }
    }

    if (rangesToLoad.length === 0) return;

    dispatch({ type: 'HUNKS_LOADING', indices: rangesToLoad });

    try {
      const actualStart = Math.min(...rangesToLoad);
      const actualEnd = Math.max(...rangesToLoad) + 1;
      const actualCount = actualEnd - actualStart;

      const response = await getFileDiffHunks(mrId, filePath, actualStart, actualCount);

      dispatch({
        type: 'HUNKS_LOADED',
        startIndex: response.startIndex,
        loadedHunks: response.hunks,
      });
    } catch (err) {
      console.error('Failed to load hunks:', err);
    } finally {
      dispatch({ type: 'HUNKS_LOAD_DONE', indices: rangesToLoad });
    }
  }, [mrId, filePath]);

  // Load diff content - either all at once or progressively
  useEffect(() => {
    async function loadDiff() {
      const startTime = performance.now();

      try {
        dispatch({ type: 'LOAD_START' });

        // First, get metadata to check if this is a large diff
        const meta = await getFileDiffMetadata(mrId, filePath);
        dispatch({ type: 'LOAD_METADATA', metadata: meta });

        if (meta.isLarge) {
          dispatch({ type: 'LOAD_LARGE_INIT', hunkCount: meta.hunkCount });
          await loadHunkRange(0, HUNK_BATCH_SIZE);

          const duration = performance.now() - startTime;
          const isWithinTarget = duration < PERF_TARGET_MS;
          console.log(
            `[Performance] Diff open (progressive): ${duration.toFixed(1)}ms (${meta.totalLines} lines, ${meta.hunkCount} hunks) ${
              isWithinTarget ? '✓' : `⚠ exceeds ${PERF_TARGET_MS}ms target`
            }`
          );
        } else {
          const content = await getFileDiff(mrId, filePath);
          dispatch({ type: 'LOAD_CONTENT', content });

          const duration = performance.now() - startTime;
          const lineCount = content.diffHunks.reduce((acc, h) => acc + h.lines.length, 0);
          const isWithinTarget = duration < PERF_TARGET_MS;
          console.log(
            `[Performance] Diff open: ${duration.toFixed(1)}ms (${lineCount} lines) ${
              isWithinTarget ? '✓' : `⚠ exceeds ${PERF_TARGET_MS}ms target`
            }`
          );
        }
      } catch (err) {
        dispatch({
          type: 'LOAD_ERROR',
          error: err instanceof Error ? err.message : 'Failed to load diff',
        });

        const duration = performance.now() - startTime;
        console.log(`[Performance] Diff open failed: ${duration.toFixed(1)}ms`);
      } finally {
        dispatch({ type: 'LOAD_DONE' });
      }
    }
    loadDiff();
  }, [mrId, filePath, loadHunkRange]);

  // Handle scroll for progressive loading
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (!state.isLargeDiff || !state.metadata) return;

    const scrollOffset = e.currentTarget.scrollTop;
    const estimatedVisibleStart = Math.floor(scrollOffset / ESTIMATED_HUNK_HEIGHT);
    const estimatedVisibleEnd = estimatedVisibleStart + 10;

    const loadStart = Math.max(0, estimatedVisibleStart - HUNK_PREFETCH_BUFFER);
    const loadEnd = Math.min(state.metadata.hunkCount, estimatedVisibleEnd + HUNK_PREFETCH_BUFFER);

    loadHunkRange(loadStart, loadEnd - loadStart);
  }, [state.isLargeDiff, state.metadata, loadHunkRange]);

  // Get the effective hunks (from diffContent or progressive loading)
  const effectiveHunks: (DiffHunk | null)[] = useMemo(() => {
    if (state.isLargeDiff) {
      return state.hunks;
    }
    return state.diffContent?.diffHunks ?? [];
  }, [state.isLargeDiff, state.hunks, state.diffContent]);

  // Line selection
  const handleLineClick = useCallback((hunkIndex: number, lineIndex: number) => {
    dispatch({ type: 'SELECT_LINE', hunk: hunkIndex, line: lineIndex });
  }, []);

  return {
    loading: state.loading,
    error: state.error,
    metadata: state.metadata,
    isLargeDiff: state.isLargeDiff,
    loadingHunks: state.loadingHunks,
    selectedHunk: state.selectedHunk,
    selectedLine: state.selectedLine,
    effectiveHunks,
    handleScroll,
    handleLineClick,
  };
}
