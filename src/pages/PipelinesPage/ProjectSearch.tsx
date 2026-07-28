import { useState, useEffect, useRef, useCallback } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { searchProjects } from '../../services/tauri';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import type { ProjectSearchResult } from '../../types';
import { SearchIcon } from './icons';
import '../../components/SearchBar/SearchBar.css';

interface ProjectSearchProps {
  selectedInstanceId: number | null;
  onSelectResult: (result: ProjectSearchResult) => void;
}

export default function ProjectSearch({ selectedInstanceId, onSelectResult }: ProjectSearchProps) {
  const isSmallScreen = useSmallScreen();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProjectSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
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

  // `/` or ⌘F/Ctrl+F to focus search (desktop; inline input only)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
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

  // Click outside to close search dropdown (desktop)
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

  // Auto-focus the overlay input when it opens (mobile)
  useEffect(() => {
    if (overlayOpen) overlayInputRef.current?.focus();
  }, [overlayOpen]);

  const handleSelectResult = useCallback(
    (result: ProjectSearchResult) => {
      setSearchQuery('');
      setSearchResults([]);
      setSearchOpen(false);
      setOverlayOpen(false);
      onSelectResult(result);
    },
    [onSelectResult]
  );

  const closeOverlay = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setOverlayOpen(false);
  }, []);

  if (isSmallScreen) {
    return (
      <>
        <button
          type="button"
          className="pipelines-search-fab"
          aria-label="Search projects"
          onClick={() => setOverlayOpen(true)}
        >
          <MagnifyingGlass size={24} weight="bold" />
        </button>
        {overlayOpen && (
          <div className="pipelines-search-overlay">
            <div className="pipelines-search-overlay-header">
              <div className="pipelines-search-input-wrapper">
                <SearchIcon />
                <input
                  ref={overlayInputRef}
                  type="text"
                  className="pipelines-search-input"
                  placeholder="Search projects to add..."
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') closeOverlay();
                  }}
                />
                {searchLoading && <span className="pipelines-search-spinner" />}
              </div>
              <button
                type="button"
                className="pipelines-search-overlay-close"
                aria-label="Close search"
                onClick={closeOverlay}
              >
                <X size={20} weight="bold" />
              </button>
            </div>
            <div className="pipelines-search-overlay-results">
              {searchQuery.trim() &&
                (searchResults.length > 0 ? (
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
                ))}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="pipelines-search-container" ref={searchContainerRef}>
      <div className="search-bar search-bar--prompt pipelines-search-bar">
        <span className="search-bar-sigil" aria-hidden="true">
          /
        </span>
        <input
          ref={searchInputRef}
          type="text"
          className="search-bar-input"
          placeholder="Search projects to add..."
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
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
