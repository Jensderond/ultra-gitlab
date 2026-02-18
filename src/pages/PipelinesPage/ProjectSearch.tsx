import { useState, useEffect, useRef, useCallback } from 'react';
import { searchProjects } from '../../services/tauri';
import type { ProjectSearchResult } from '../../types';
import { SearchIcon } from './icons';

interface ProjectSearchProps {
  selectedInstanceId: number | null;
  onSelectResult: (result: ProjectSearchResult) => void;
}

export default function ProjectSearch({ selectedInstanceId, onSelectResult }: ProjectSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProjectSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || !selectedInstanceId) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchProjects(selectedInstanceId, searchQuery.trim());
        setSearchResults(results);
      } catch (error) {
        console.error('Search failed:', error);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, selectedInstanceId]);

  // `/` keyboard shortcut to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside to close search dropdown
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelectResult = useCallback(
    (result: ProjectSearchResult) => {
      setSearchQuery('');
      setSearchResults([]);
      setSearchOpen(false);
      onSelectResult(result);
    },
    [onSelectResult]
  );

  return (
    <div className="pipelines-search-container" ref={searchContainerRef}>
      <div className="pipelines-search-input-wrapper">
        <SearchIcon />
        <input
          ref={searchInputRef}
          type="text"
          className="pipelines-search-input"
          placeholder="Search projects to add..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => {
            if (searchQuery.trim()) setSearchOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('');
              setSearchResults([]);
              setSearchOpen(false);
              searchInputRef.current?.blur();
            }
          }}
        />
        {searchLoading && <span className="pipelines-search-spinner" />}
        {!searchQuery && (
          <kbd className="pipelines-search-hint">/</kbd>
        )}
      </div>
      {searchOpen && searchQuery.trim() && (
        <div className="pipelines-search-dropdown">
          {searchResults.length > 0 ? (
            searchResults.map((result) => (
              <button
                key={result.id}
                className="pipelines-search-result"
                onClick={() => handleSelectResult(result)}
              >
                <span className="pipelines-search-result-name">
                  {result.nameWithNamespace}
                </span>
                <span className="pipelines-search-result-path">
                  {result.pathWithNamespace}
                </span>
              </button>
            ))
          ) : searchLoading ? (
            <div className="pipelines-search-empty">Searching...</div>
          ) : (
            <div className="pipelines-search-empty">No projects found</div>
          )}
        </div>
      )}
    </div>
  );
}
