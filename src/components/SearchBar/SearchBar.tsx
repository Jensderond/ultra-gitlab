import { useEffect, useRef } from 'react';
import './SearchBar.css';

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  filteredCount: number;
  totalCount: number;
}

export default function SearchBar({
  query,
  onQueryChange,
  onClose,
  filteredCount,
  totalCount,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount and re-focus when Cmd/Ctrl+F is pressed while open
  useEffect(() => {
    inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="search-bar">
      <span className="search-bar-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
        </svg>
      </span>
      <input
        ref={inputRef}
        className="search-bar-input"
        type="text"
        placeholder="Filter merge requests…"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {query && (
        <span className="search-bar-count">
          {filteredCount} of {totalCount}
        </span>
      )}
      <button
        className="search-bar-close"
        onClick={onClose}
        title="Close search (Esc)"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
        </svg>
      </button>
    </div>
  );
}
