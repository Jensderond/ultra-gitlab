/**
 * Hook for loading MR data, reviewers, and comments.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getComments, deleteComment as tauriDeleteComment } from '../../services/tauri';
import { useMRDetailQuery } from '../../hooks/queries/useMRDetailQuery';
import { useMRReviewersQuery } from '../../hooks/queries/useMRReviewersQuery';
import { useCurrentUserQuery } from '../../hooks/queries/useCurrentUserQuery';
import { queryKeys } from '../../lib/queryKeys';
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
  const queryClient = useQueryClient();
  const mrQuery = useMRDetailQuery(mrId);
  const reviewersQuery = useMRReviewersQuery(mrId);

  const mr = mrQuery.data ?? null;
  const currentUserQuery = useCurrentUserQuery(mr?.instanceId ?? 0);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);

  useEffect(() => {
    if (!mrId) return;
    let cancelled = false;
    async function load() {
      try {
        setCommentsLoading(true);
        const data = await getComments(mrId);
        if (!cancelled) setComments(data);
      } catch (err) {
        console.error('Failed to load comments:', err);
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [mrId]);

  const setMr = useCallback((updater: React.SetStateAction<MergeRequest | null>) => {
    queryClient.setQueryData(queryKeys.mr(mrId), (prev: MergeRequest | undefined) => {
      if (!prev) return prev;
      const newValue = typeof updater === 'function' ? updater(prev) : updater;
      return newValue ?? undefined;
    });
  }, [queryClient, mrId]);

  const handleDeleteComment = useCallback(async (commentId: number) => {
    const request: DeleteCommentRequest = { mrId, commentId };
    await tauriDeleteComment(request);
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

  const reviewers: MrReviewer[] = reviewersQuery.data ?? [];
  const unresolvedCount = threads.filter(
    t => t.some(c => c.discussionId) && !t.some(c => c.resolved)
  ).length;
  const approvedCount = reviewers.filter(r => r.status === 'approved').length;

  const loading = mrQuery.isLoading || commentsLoading;
  const error = mrQuery.error
    ? (mrQuery.error instanceof Error ? mrQuery.error.message : 'Failed to load MR')
    : null;

  return {
    mr,
    setMr,
    reviewers,
    comments,
    currentUser: currentUserQuery.data,
    loading,
    error,
    threads,
    unresolvedCount,
    approvedCount,
    handleDeleteComment,
  };
}
