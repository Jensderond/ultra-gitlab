import { useState, useEffect } from 'react';
import { tauriListen } from '../../services/transport';
import { getMergeRequestById, getMergeRequestFiles, getDiffRefs, getGitattributesPatterns } from '../../services/gitlab';
import { getCollapsePatterns } from '../../services/tauri';
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
  const [mr, setMr] = useState<MergeRequest | null>(null);
  const [files, setFiles] = useState<DiffFileSummary[]>([]);
  const [diffRefs, setDiffRefs] = useState<DiffRefs | null>(null);
  const [generatedPaths, setGeneratedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialReviewableFile, setInitialReviewableFile] = useState<{ path: string; index: number } | null>(null);

  // Load MR data
  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!mrId) return;

      try {
        setLoading(true);
        setError(null);

        const [mrData, filesData, diffRefsData] = await Promise.all([
          getMergeRequestById(mrId),
          getMergeRequestFiles(mrId),
          getDiffRefs(mrId).catch(() => null),
        ]);

        if (cancelled) return;

        setMr(mrData);
        setDiffRefs(diffRefsData);

        const summaries: DiffFileSummary[] = filesData.map((f) => ({
          newPath: f.newPath,
          oldPath: f.oldPath,
          changeType: f.changeType,
          additions: f.additions,
          deletions: f.deletions,
        }));

        setFiles(summaries);

        const [gitattributes, userPatterns] = await Promise.all([
          getGitattributesPatterns(mrData.instanceId, mrData.projectId).catch(() => []),
          getCollapsePatterns().catch(() => []),
        ]);

        if (cancelled) return;

        const { reviewable, generated } = classifyFiles(summaries, gitattributes, userPatterns);
        setGeneratedPaths(generated);

        if (reviewable.length > 0) {
          const first = reviewable[0];
          const fullIndex = summaries.findIndex((f) => f.newPath === first.newPath);
          setInitialReviewableFile({ path: first.newPath, index: fullIndex >= 0 ? fullIndex : 0 });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load merge request');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadData();

    return () => { cancelled = true; };
  }, [mrId]);

  // Re-fetch MR data when mr-updated event matches
  useEffect(() => {
    if (!mrId) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    tauriListen<{ mr_id: number; update_type: string; instance_id: number; iid: number }>(
      'mr-updated',
      async (event) => {
        if (event.payload.mr_id !== mrId) return;

        try {
          const [mrData, filesData, diffRefsData] = await Promise.all([
            getMergeRequestById(mrId),
            getMergeRequestFiles(mrId),
            getDiffRefs(mrId).catch(() => null),
          ]);

          if (cancelled) return;
          setMr(mrData);
          setDiffRefs(diffRefsData);

          const summaries: DiffFileSummary[] = filesData.map((f) => ({
            newPath: f.newPath,
            oldPath: f.oldPath,
            changeType: f.changeType,
            additions: f.additions,
            deletions: f.deletions,
          }));
          if (cancelled) return;
          setFiles(summaries);
          clearFileCache();
        } catch (err) {
          console.warn('Failed to refresh MR data on event:', err);
        }
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [mrId, clearFileCache]);

  return {
    mr,
    files,
    diffRefs,
    generatedPaths,
    loading,
    error,
    initialReviewableFile,
    clearFileCache,
  };
}
