import type { DiffFileMetadata } from '../../types';

interface DiffHeaderProps {
  filePath: string;
  isLargeDiff: boolean;
  metadata: DiffFileMetadata | null;
  viewMode: 'unified' | 'split';
  onViewModeChange?: (mode: 'unified' | 'split') => void;
}

export default function DiffHeader({
  filePath,
  isLargeDiff,
  metadata,
  viewMode,
  onViewModeChange,
}: DiffHeaderProps) {
  return (
    <div className="diff-viewer-header">
      <span className="diff-file-path">{filePath}</span>
      <div className="diff-header-right">
        {isLargeDiff && metadata && (
          <span className="diff-large-indicator">
            Large diff ({metadata.totalLines.toLocaleString()} lines)
          </span>
        )}
        <div className="diff-view-toggle">
          <button
            className={viewMode === 'unified' ? 'active' : ''}
            onClick={() => onViewModeChange?.('unified')}
          >
            Unified
          </button>
          <button
            className={viewMode === 'split' ? 'active' : ''}
            onClick={() => onViewModeChange?.('split')}
          >
            Split
          </button>
        </div>
      </div>
    </div>
  );
}
