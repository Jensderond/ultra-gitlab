/**
 * File navigation component for switching between diff files.
 *
 * Displays a list of changed files with change indicators.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { DiffFileSummary, ChangeType } from '../../types';
import './FileNavigation.css';

interface FileNavigationProps {
  /** List of files in the diff */
  files: DiffFileSummary[];
  /** Currently selected file path */
  selectedPath?: string;
  /** Callback when a file is selected */
  onSelect: (filePath: string) => void;
  /** Current file index for keyboard navigation */
  focusIndex?: number;
  /** Set of file paths that have been marked as viewed */
  viewedPaths?: Set<string>;
  /** Set of file paths classified as generated */
  generatedPaths?: Set<string>;
  /** Whether generated files are currently hidden */
  hideGenerated?: boolean;
  /** Callback to toggle hiding generated files */
  onToggleHideGenerated?: () => void;
}

/**
 * Get the icon/indicator for a change type.
 */
function getChangeIndicator(changeType: ChangeType): { text: string; className: string } {
  switch (changeType) {
    case 'added':
      return { text: 'A', className: 'change-added' };
    case 'deleted':
      return { text: 'D', className: 'change-deleted' };
    case 'renamed':
      return { text: 'R', className: 'change-renamed' };
    case 'modified':
    default:
      return { text: 'M', className: 'change-modified' };
  }
}

/**
 * Get just the filename from a path.
 */
function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * Get the directory path from a full path.
 */
function getDirectory(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

/**
 * File navigation sidebar.
 */
export default function FileNavigation({
  files,
  selectedPath,
  onSelect,
  focusIndex,
  viewedPaths,
  generatedPaths,
  hideGenerated,
  onToggleHideGenerated,
}: FileNavigationProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const generatedCount = generatedPaths?.size ?? 0;

  const visibleFiles = useMemo(() => {
    let result = hideGenerated
      ? files.filter((f) => !generatedPaths?.has(f.newPath))
      : files;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((f) => f.newPath.toLowerCase().includes(query));
    }

    return result;
  }, [files, hideGenerated, generatedPaths, searchQuery]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      searchInputRef.current?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visibleFiles.length > 0) {
        const currentIdx = visibleFiles.findIndex((f) => f.newPath === selectedPath);
        onSelect(visibleFiles[currentIdx >= 0 ? currentIdx : 0].newPath);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleFiles.length > 0) {
        const currentIdx = visibleFiles.findIndex((f) => f.newPath === selectedPath);
        const nextIdx = currentIdx < visibleFiles.length - 1 ? currentIdx + 1 : 0;
        onSelect(visibleFiles[nextIdx].newPath);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleFiles.length > 0) {
        const currentIdx = visibleFiles.findIndex((f) => f.newPath === selectedPath);
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : visibleFiles.length - 1;
        onSelect(visibleFiles[prevIdx].newPath);
      }
    }
  }, [visibleFiles, selectedPath, onSelect]);

  // Global `\` shortcut to focus the search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.metaKey || e.ctrlKey || e.altKey
      ) {
        return;
      }
      if (e.key === '\\') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="file-navigation">
      <div className="file-nav-header">
        <span className="file-count">{files.length} files changed</span>
        {generatedCount > 0 && onToggleHideGenerated && (
          <button
            className={`file-nav-toggle-generated ${hideGenerated ? 'active' : ''}`}
            onClick={onToggleHideGenerated}
            title={hideGenerated ? `Show ${generatedCount} generated files` : `Hide ${generatedCount} generated files`}
          >
            {hideGenerated ? `+${generatedCount} hidden` : `${generatedCount} generated`}
          </button>
        )}
      </div>
      <div className="file-nav-search">
        <div className="file-nav-search-field">
          <input
            ref={searchInputRef}
            type="text"
            className="file-nav-search-input"
            placeholder="Filter files…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {!searchQuery && <kbd className="file-nav-search-kbd">\</kbd>}
        </div>
        {searchQuery && (
          <span className="file-nav-search-count">
            {visibleFiles.length} / {files.length}
          </span>
        )}
      </div>
      <div className="file-nav-list">
        {visibleFiles.map((file) => {
          const index = files.indexOf(file);
          const indicator = getChangeIndicator(file.changeType);
          const isSelected = file.newPath === selectedPath;
          const isFocused = index === focusIndex;
          const isViewed = viewedPaths?.has(file.newPath) ?? false;
          const isGenerated = generatedPaths?.has(file.newPath) ?? false;

          return (
            <div
              key={file.newPath}
              ref={isFocused ? focusedRef : undefined}
              className={`file-nav-item ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${isViewed ? 'viewed' : ''} ${isGenerated ? 'generated' : ''}`}
              onClick={() => onSelect(file.newPath)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onSelect(file.newPath);
                }
              }}
            >
              <span className={`file-change-indicator ${indicator.className}`}>
                {indicator.text}
              </span>
              <div className="file-info">
                <span className="file-name">
                  {getFileName(file.newPath)}
                  {isGenerated && <span className="file-generated-label">generated</span>}
                </span>
                <span className="file-dir">{getDirectory(file.newPath)}</span>
              </div>
              <div className="file-stats">
                {file.additions > 0 && (
                  <span className="stat-add">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="stat-del">-{file.deletions}</span>
                )}
              </div>
              {isViewed && <span className="file-viewed-indicator">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
