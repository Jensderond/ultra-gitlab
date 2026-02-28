/**
 * Hook for loading MR data, reviewers, and comments.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getMergeRequest, getMrReviewers, getComments, getGitLabInstances, deleteComment as tauriDeleteComment } from '../../services/tauri';
import type { MergeRequest, MrReviewer, Comment, DeleteCommentRequest } from '../../types';

export interface MyMRData {
  mr: MergeRequest | null;
  setMr: React.Dispatch<React.SetStateAction<MergeRequest | null>>;
  reviewers: MrReviewer[];
  comments: Comment[];
  currentUser: string | null;
  loading: boolean;
  error: string | null;
  threads: Comment[][];
  unresolvedCount: number;
  approvedCount: number;
  handleDeleteComment: (commentId: number) => Promise<void>;
}

export function useMyMRData(mrId: number): MyMRData {
  const [mr, setMr] = useState<MergeRequest | null>(null);
  const [reviewers, setReviewers] = useState<MrReviewer[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [mrData, reviewerData, commentData, instances] = await Promise.all([
          getMergeRequest(mrId),
          getMrReviewers(mrId),
          getComments(mrId),
          getGitLabInstances(),
        ]);
        setMr(mrData);
        setReviewers(reviewerData);
        setComments(commentData);
        const matchingInstance = instances.find((inst) => inst.id === mrData.instanceId);
        setCurrentUser(matchingInstance?.authenticatedUsername ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load MR');
      } finally {
        setLoading(false);
      }
    }
    if (mrId) load();
  }, [mrId]);

  const handleDeleteComment = useCallback(async (commentId: number) => {
    const request: DeleteCommentRequest = { mrId, commentId };
    await tauriDeleteComment(request);
    // Refresh comments after deletion
    const updated = await getComments(mrId);
    setComments(updated);
  }, [mrId]);

  const threads = useMemo(() => {
    const threadMap = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.system) continue;
      const key = c.discussionId ?? `standalone-${c.id}`;
      if (!threadMap.has(key)) threadMap.set(key, []);
      threadMap.get(key)!.push(c);
    }
    return Array.from(threadMap.values()).sort((a, b) => {
      const aResolved = a.some(c => c.resolved);
      const bResolved = b.some(c => c.resolved);
      if (aResolved !== bResolved) return aResolved ? 1 : -1;
      return (a[0]?.createdAt ?? 0) - (b[0]?.createdAt ?? 0);
    });
  }, [comments]);

  const unresolvedCount = threads.filter(
    t => t.some(c => c.discussionId) && !t.some(c => c.resolved)
  ).length;

  const approvedCount = reviewers.filter(r => r.status === 'approved').length;

  return { mr, reviewers, comments, currentUser, loading, error, threads, unresolvedCount, approvedCount, handleDeleteComment, setMr };
}
