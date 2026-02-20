import { MultiFileDiff } from '@pierre/diffs/react';
import type { FileContents } from '@pierre/diffs/react';
import { useMemo } from 'react';

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
}: PierreDiffViewerProps) {
  const cacheKey = `${mrIid}:${filePath}:${sha}`;

  const oldFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: oldContent ?? '',
      cacheKey,
    }),
    [filePath, oldContent, cacheKey]
  );

  const newFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: newContent ?? '',
      cacheKey,
    }),
    [filePath, newContent, cacheKey]
  );

  const options = useMemo(
    () => ({
      diffStyle: viewMode,
      lineDiffType: 'word' as const,
      expandUnchanged: true,
      themeType: 'system' as const,
    }),
    [viewMode]
  );

  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={options}
    />
  );
}

export default PierreDiffViewer;
