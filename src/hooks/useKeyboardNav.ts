/**
 * Keyboard navigation hook for lists.
 *
 * Provides j/k navigation with Enter to select.
 */

import { useState, useCallback, useEffect } from 'react';

interface UseKeyboardNavOptions {
  /** Total number of items in the list */
  itemCount: number;
  /** Callback when Enter is pressed on focused item */
  onSelect?: (index: number) => void;
  /** Whether navigation is enabled (disabled when typing in inputs) */
  enabled?: boolean;
}

interface UseKeyboardNavResult {
  /** Currently focused item index */
  focusIndex: number;
  /** Set the focused index programmatically */
  setFocusIndex: (index: number) => void;
  /** Move focus to next item */
  moveNext: () => void;
  /** Move focus to previous item */
  movePrev: () => void;
  /** Select the currently focused item */
  selectFocused: () => void;
}

/**
 * Hook for keyboard navigation in lists.
 *
 * @example
 * ```tsx
 * const { focusIndex, setFocusIndex } = useKeyboardNav({
 *   itemCount: items.length,
 *   onSelect: (index) => navigate(`/item/${items[index].id}`)
 * });
 * ```
 */
export function useKeyboardNav({
  itemCount,
  onSelect,
  enabled = true,
}: UseKeyboardNavOptions): UseKeyboardNavResult {
  const [focusIndex, setFocusIndex] = useState(0);

  // Clamp focus index when item count changes
  useEffect(() => {
    if (focusIndex >= itemCount && itemCount > 0) {
      setFocusIndex(itemCount - 1);
    }
  }, [itemCount, focusIndex]);

  const moveNext = useCallback(() => {
    setFocusIndex((prev) => Math.min(prev + 1, itemCount - 1));
  }, [itemCount]);

  const movePrev = useCallback(() => {
    setFocusIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const selectFocused = useCallback(() => {
    if (onSelect && focusIndex >= 0 && focusIndex < itemCount) {
      onSelect(focusIndex);
    }
  }, [onSelect, focusIndex, itemCount]);

  // Global keyboard listener
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          moveNext();
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          movePrev();
          break;
        case 'Enter':
          e.preventDefault();
          selectFocused();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, moveNext, movePrev, selectFocused]);

  return {
    focusIndex,
    setFocusIndex,
    moveNext,
    movePrev,
    selectFocused,
  };
}

export default useKeyboardNav;
