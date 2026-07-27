import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { SearchIcon, CloseIcon } from '../icons';
import { useSmallScreen } from '../../hooks/useSmallScreen';
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
  /** Says what the query actually matches. Defaults to the title/author/project
      fields every list screen filters on. */
  placeholder?: string;
}

/**
 * Filter bar for list screens.
 *
 * Takes one of two forms, picked by input modality rather than by the caller.
 * On pointer screens ⌘F is the only way in, so it's typeset as a keyboard
 * prompt — a `/` sigil, no field chrome, `esc` to leave. On touch screens it's
 * a tappable search field with a clear button and Cancel.
 */
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
  placeholder = 'Filter by title, author, or project',
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(externalInputRef, () => inputRef.current!, []);
  const isTouch = useSmallScreen();

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

  const noMatches = query.trim().length > 0 && filteredCount === 0;

  const count = query ? (
    <span
      className={`search-bar-count${noMatches ? ' search-bar-count--empty' : ''}`}
      role="status"
      aria-live="polite"
    >
      {noMatches ? (
        'No matches'
      ) : (
        <>
          <b>{filteredCount}</b> of {totalCount}
        </>
      )}
    </span>
  ) : null;

  const input = (
    <input
      ref={inputRef}
      className="search-bar-input"
      type="text"
      placeholder={placeholder}
      aria-label={placeholder}
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
  );

  if (isTouch) {
    return (
      <div className="search-bar search-bar--field">
        <div className="search-bar-field">
          <span className="search-bar-icon" aria-hidden="true">
            <SearchIcon size={14} />
          </span>
          {input}
          {count}
          {query && (
            <button
              type="button"
              className="search-bar-clear"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
              aria-label="Clear filter"
            >
              <CloseIcon size={10} />
            </button>
          )}
        </div>
        <button type="button" className="search-bar-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="search-bar search-bar--prompt">
      {/* The `/` of vim and less: this bar only ever opens from the keyboard,
          so it announces itself as a prompt rather than a form field. */}
      <span className="search-bar-sigil" aria-hidden="true">
        /
      </span>
      {input}
      {count}
      <button
        type="button"
        className="search-bar-esc"
        onClick={onClose}
        title="Close filter (Esc)"
        aria-label="Close filter"
      >
        esc
      </button>
    </div>
  );
}
