/**
 * File navigation component for switching between diff files.
 *
 * Displays a list of changed files with change indicators.
 */

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
}: FileNavigationProps) {
  return (
    <div className="file-navigation">
      <div className="file-nav-header">
        <span className="file-count">{files.length} files changed</span>
      </div>
      <div className="file-nav-list">
        {files.map((file, index) => {
          const indicator = getChangeIndicator(file.changeType);
          const isSelected = file.newPath === selectedPath;
          const isFocused = index === focusIndex;
          const isViewed = viewedPaths?.has(file.newPath) ?? false;
          const isGenerated = generatedPaths?.has(file.newPath) ?? false;

          return (
            <div
              key={file.newPath}
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
