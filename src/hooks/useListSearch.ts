/**
 * Reusable search/filter hook for list screens.
 *
 * Provides Cmd/Ctrl+F to open search, Esc to close,
 * and case-insensitive substring filtering.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

interface UseListSearchOptions<T> {
  /** The full list of items to filter */
  items: T[];
  /** Extract searchable text fields from an item */
  getSearchableText: (item: T) => string[];
}

interface UseListSearchResult<T> {
  /** Current search query */
  query: string;
  /** Whether search bar is open */
  isSearchOpen: boolean;
  /** Update the query string */
  setQuery: (query: string) => void;
  /** Open the search bar */
  openSearch: () => void;
  /** Close the search bar and clear query */
  closeSearch: () => void;
  /** Items filtered by current query */
  filteredItems: T[];
  /** Total number of items before filtering */
  totalCount: number;
  /** Number of items after filtering */
  filteredCount: number;
}

/**
 * Hook for filtering lists with Cmd/Ctrl+F keyboard shortcut.
 *
 * @example
 * ```tsx
 * const search = useListSearch({
 *   items: mergeRequests,
 *   getSearchableText: (mr) => [mr.title, mr.authorUsername, mr.projectName],
 * });
 * ```
 */
export function useListSearch<T>({
  items,
  getSearchableText,
}: UseListSearchOptions<T>): UseListSearchResult<T> {
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const getSearchableTextRef = useRef(getSearchableText);
  getSearchableTextRef.current = getSearchableText;

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setQuery('');
  }, []);

  // Listen for Cmd/Ctrl+F to open search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }

      // Esc closes search — stop propagation to prevent go-back shortcut
      if (e.key === 'Escape' && isSearchOpen) {
        e.stopPropagation();
        closeSearch();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isSearchOpen, openSearch, closeSearch]);

  const filteredItems = useMemo(() => {
    if (!query) return items;

    const lowerQuery = query.toLowerCase();
    return items.filter((item) => {
      const fields = getSearchableTextRef.current(item);
      return fields.some(
        (field) => field && field.toLowerCase().includes(lowerQuery)
      );
    });
  }, [items, query]);

  return {
    query,
    isSearchOpen,
    setQuery,
    openSearch,
    closeSearch,
    filteredItems,
    totalCount: items.length,
    filteredCount: filteredItems.length,
  };
}

export default useListSearch;
