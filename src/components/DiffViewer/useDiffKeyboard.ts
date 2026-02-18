import { useEffect, useCallback, useMemo, useRef } from 'react';
import type { DiffHunk } from '../../types';

interface UseDiffKeyboardOptions {
  effectiveHunks: (DiffHunk | null)[];
  selectedHunk: number | null;
  selectedLine: number | null;
  addingCommentAt: { hunk: number; line: number } | null;
  viewMode: 'unified' | 'split';
  onLineSelect: (hunk: number, line: number) => void;
  onStartComment: (hunk: number, line: number) => void;
  onCancelComment: () => void;
  onViewModeChange?: (mode: 'unified' | 'split') => void;
}

export function useDiffKeyboard(options: UseDiffKeyboardOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Find all change positions (added/removed lines)
  const changePositions = useMemo(() => {
    const positions: { hunk: number; line: number }[] = [];
    options.effectiveHunks.forEach((hunk, hunkIdx) => {
      if (hunk === null) return;
      hunk.lines.forEach((line, lineIdx) => {
        if (line.type === 'add' || line.type === 'remove') {
          positions.push({ hunk: hunkIdx, line: lineIdx });
        }
      });
    });
    return positions;
  }, [options.effectiveHunks]);

  // Navigate to next/prev change
  const navigateToChange = useCallback((direction: 1 | -1) => {
    if (changePositions.length === 0) return;

    const { selectedHunk, selectedLine } = optionsRef.current;

    let currentIndex = -1;
    if (selectedHunk !== null && selectedLine !== null) {
      currentIndex = changePositions.findIndex(
        (pos) => pos.hunk === selectedHunk && pos.line === selectedLine
      );
    }

    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = direction === 1 ? 0 : changePositions.length - 1;
    } else {
      nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = changePositions.length - 1;
      if (nextIndex >= changePositions.length) nextIndex = 0;
    }

    const nextPos = changePositions[nextIndex];
    optionsRef.current.onLineSelect(nextPos.hunk, nextPos.line);
  }, [changePositions]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const opts = optionsRef.current;

      // 'c' key to add comment at selected line
      if (e.key === 'c' && opts.selectedHunk !== null && opts.selectedLine !== null && !opts.addingCommentAt) {
        e.preventDefault();
        opts.onStartComment(opts.selectedHunk, opts.selectedLine);
        return;
      }

      // Escape to cancel comment
      if (e.key === 'Escape' && opts.addingCommentAt) {
        opts.onCancelComment();
        return;
      }

      // ']' for next change
      if (e.key === ']' && !opts.addingCommentAt) {
        e.preventDefault();
        navigateToChange(1);
        return;
      }

      // '[' for previous change
      if (e.key === '[' && !opts.addingCommentAt) {
        e.preventDefault();
        navigateToChange(-1);
        return;
      }

      // 'x' to toggle view mode
      if (e.key === 'x' && !opts.addingCommentAt && opts.onViewModeChange) {
        e.preventDefault();
        opts.onViewModeChange(opts.viewMode === 'unified' ? 'split' : 'unified');
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateToChange]);
}
