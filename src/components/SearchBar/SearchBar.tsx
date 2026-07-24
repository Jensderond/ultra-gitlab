import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { SearchIcon, CloseIcon } from '../icons';
import './SearchBar.css';

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  filteredCount: number;
  totalCount: number;
  onArrowDown?: () => void;
  onArrowUp?: () => void;
  onSubmit?: () => void;
  /** Focus the input on mount (desktop overlay). The collapsed mobile bar
      passes false so merely revealing it never opens the keyboard. */
  autoFocus?: boolean;
  /** Handle on the input element, e.g. so the header search button can focus it. */
  inputRef?: Ref<HTMLInputElement>;
}

export default function SearchBar({
  query,
  onQueryChange,
  onClose,
  filteredCount,
  totalCount,
  onArrowDown,
  onArrowUp,
  onSubmit,
  autoFocus = true,
  inputRef: externalInputRef,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(externalInputRef, () => inputRef.current!, []);

  // Auto-focus on mount and re-focus when Cmd/Ctrl+F is pressed while open
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [autoFocus]);

  return (
    <div className="search-bar">
      <span className="search-bar-icon">
        <SearchIcon size={14} />
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
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            onArrowDown?.();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            onArrowUp?.();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit?.();
          }
        }}
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
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
