import { useMemo } from 'react';
import { useMRDetailQuery } from '../../hooks/queries/useMRDetailQuery';
import { useDiffFilesQuery } from '../../hooks/queries/useDiffFilesQuery';
import { useDiffRefsQuery } from '../../hooks/queries/useDiffRefsQuery';
import { useGitattributesQuery } from '../../hooks/queries/useGitattributesQuery';
import { useCollapsePatternsQuery } from '../../hooks/queries/useCollapsePatternsQuery';
import { classifyFiles } from '../../utils/classifyFiles';
import type { MergeRequest, DiffFileSummary, DiffRefs } from '../../types';

interface UseMRDataResult {
  mr: MergeRequest | null;
  files: DiffFileSummary[];
  diffRefs: DiffRefs | null;
  generatedPaths: Set<string>;
  loading: boolean;
  error: string | null;
  /** First reviewable file path from initial load, or null */
  initialReviewableFile: { path: string; index: number } | null;
  clearFileCache: () => void;
}

export function useMRData(
  mrId: number,
  clearFileCache: () => void,
): UseMRDataResult {
  const mrQuery = useMRDetailQuery(mrId);
  const diffFilesQuery = useDiffFilesQuery(mrId);
  const diffRefsQuery = useDiffRefsQuery(mrId);

  const mr = mrQuery.data ?? null;

  const gitattributesQuery = useGitattributesQuery(
    mr?.instanceId ?? 0,
    mr?.projectId ?? 0,
  );
  const collapsePatternsQuery = useCollapsePatternsQuery();

  const files: DiffFileSummary[] = useMemo(() => {
    if (!diffFilesQuery.data) return [];
    return diffFilesQuery.data.map((f) => ({
      newPath: f.newPath,
      oldPath: f.oldPath,
      changeType: f.changeType,
      additions: f.additions,
      deletions: f.deletions,
    }));
  }, [diffFilesQuery.data]);

  const { generatedPaths, initialReviewableFile } = useMemo(() => {
    if (files.length === 0) {
      return { generatedPaths: new Set<string>(), initialReviewableFile: null };
    }
    const gitattributes = gitattributesQuery.data ?? [];
    const userPatterns = collapsePatternsQuery.data ?? [];
    const { reviewable, generated } = classifyFiles(files, gitattributes, userPatterns);

    let initialFile: { path: string; index: number } | null = null;
    if (reviewable.length > 0) {
      const first = reviewable[0];
      const fullIndex = files.findIndex((f) => f.newPath === first.newPath);
      initialFile = { path: first.newPath, index: fullIndex >= 0 ? fullIndex : 0 };
    }
    return { generatedPaths: generated, initialReviewableFile: initialFile };
  }, [files, gitattributesQuery.data, collapsePatternsQuery.data]);

  const loading = mrQuery.isLoading || diffFilesQuery.isLoading;
  // Only report error when there's no data at all (hard 404, never loaded).
  // When we have stale cached data + error, show the MR with a banner instead.
  const error = mrQuery.error && !mrQuery.data
    ? (mrQuery.error instanceof Error ? mrQuery.error.message : 'Failed to load merge request')
    : diffFilesQuery.error
    ? (diffFilesQuery.error instanceof Error ? diffFilesQuery.error.message : 'Failed to load files')
    : null;

  return {
    mr,
    files,
    diffRefs: diffRefsQuery.data ?? null,
    generatedPaths,
    loading,
    error,
    initialReviewableFile,
    clearFileCache,
  };
}
