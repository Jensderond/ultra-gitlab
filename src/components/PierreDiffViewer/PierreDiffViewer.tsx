import { MultiFileDiff } from '@pierre/diffs/react';
import type { FileContents } from '@pierre/diffs/react';
import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { useMemo, useCallback, useState, type ReactNode } from 'react';

/** Comment data attached to a diff line annotation. */
export interface LineComment {
  id: number;
  line: number;
  isOldLine?: boolean;
  authorUsername: string;
  body: string;
  createdAt: number;
  resolved?: boolean;
}

/** Pierre line type for diff lines. */
export type DiffLineType = 'change-deletion' | 'change-addition' | 'context' | 'context-expanded';

/** Info passed when a line number is clicked in the diff. */
export interface DiffLineClickInfo {
  lineNumber: number;
  side: 'old' | 'new';
  lineType: DiffLineType;
  filePath: string;
}

export interface PierreDiffViewerProps {
  /** Original file content (null for new files) */
  oldContent: string | null;
  /** Modified file content (null for deleted files) */
  newContent: string | null;
  /** File path — used for language auto-detection */
  filePath: string;
  /** Split or unified diff view */
  viewMode: 'split' | 'unified';
  /** MR IID for cache key */
  mrIid: number;
  /** Commit SHA for cache key */
  sha: string;
  /** Inline comments to display as line annotations */
  comments?: LineComment[];
  /** Called when a line number is clicked in the diff */
  onLineClick?: (info: DiffLineClickInfo) => void;
  /** Called when the user selects a line range in the diff */
  onLineSelected?: (range: SelectedLineRange | null) => void;
}

/** Map LineComment[] to Pierre DiffLineAnnotation<LineComment>[]. */
function toAnnotations(comments: LineComment[]): DiffLineAnnotation<LineComment>[] {
  return comments.map((c) => ({
    side: c.isOldLine ? 'deletions' as const : 'additions' as const,
    lineNumber: c.line,
    metadata: c,
  }));
}

/** Format a Unix timestamp (seconds) as a relative or short date string. */
function formatDate(ts: number): string {
  const date = new Date(ts * 1000);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Render a single annotation (comment thread) inline in the diff. */
function renderAnnotation(annotation: DiffLineAnnotation<LineComment>): ReactNode {
  const c = annotation.metadata;
  return (
    <div className="pierre-annotation-comment" style={{
      padding: '8px 12px',
      borderTop: '1px solid var(--border-secondary, #333)',
      background: 'var(--bg-secondary, #1e1e2e)',
      fontSize: '13px',
      lineHeight: '1.4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <strong style={{ color: 'var(--text-primary, #e0e0e0)' }}>{c.authorUsername}</strong>
        <span style={{ color: 'var(--text-tertiary, #888)', fontSize: '12px' }}>{formatDate(c.createdAt)}</span>
        {c.resolved && (
          <span style={{ color: 'var(--color-success, #4caf50)', fontSize: '11px', fontWeight: 600 }}>Resolved</span>
        )}
      </div>
      <div style={{ color: 'var(--text-secondary, #ccc)', whiteSpace: 'pre-wrap' }}>{c.body}</div>
    </div>
  );
}

/**
 * Pierre-based diff viewer component.
 * Renders file diffs with syntax highlighting via web workers.
 */
export function PierreDiffViewer({
  oldContent,
  newContent,
  filePath,
  viewMode,
  mrIid,
  sha,
  comments,
  onLineClick,
  onLineSelected,
}: PierreDiffViewerProps) {
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);

  const handleLineSelected = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedLines(range);
      onLineSelected?.(range);
    },
    [onLineSelected]
  );

  const oldFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: oldContent ?? '',
      cacheKey: `${mrIid}:${filePath}:${sha}:old`,
    }),
    [filePath, oldContent, mrIid, sha]
  );

  const newFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: newContent ?? '',
      cacheKey: `${mrIid}:${filePath}:${sha}:new`,
    }),
    [filePath, newContent, mrIid, sha]
  );

  const handleLineNumberClick = useCallback(
    (props: { lineNumber: number; annotationSide: 'deletions' | 'additions'; lineType: DiffLineType }) => {
      onLineClick?.({
        lineNumber: props.lineNumber,
        side: props.annotationSide === 'deletions' ? 'old' : 'new',
        lineType: props.lineType,
        filePath,
      });
    },
    [onLineClick, filePath]
  );

  const options = useMemo(
    () => ({
      diffStyle: viewMode,
      lineDiffType: 'word' as const,
      expandUnchanged: false,
      themeType: 'system' as const,
      onLineNumberClick: onLineClick ? handleLineNumberClick : undefined,
      enableLineSelection: true,
      onLineSelected: handleLineSelected,
    }),
    [viewMode, onLineClick, handleLineNumberClick, handleLineSelected]
  );

  const lineAnnotations = useMemo(
    () => comments && comments.length > 0 ? toAnnotations(comments) : undefined,
    [comments]
  );

  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={options}
      lineAnnotations={lineAnnotations}
      renderAnnotation={lineAnnotations ? renderAnnotation : undefined}
      selectedLines={selectedLines}
    />
  );
}

export default PierreDiffViewer;
