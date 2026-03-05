import { useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  addGeneralComment,
  replyToDiscussion,
  setDiscussionResolved,
  deleteComment as gitlabDeleteComment,
} from '../services/gitlab';
import { tauriListen } from '../services/transport';
import { useCommentsQuery } from './queries/useCommentsQuery';
import { useCurrentUserQuery } from './queries/useCurrentUserQuery';
import { useMRDetailQuery } from './queries/useMRDetailQuery';
import { queryKeys } from '../lib/queryKeys';
import type { Comment } from '../types';

interface ActionSyncedPayload {
  action_id: number;
  action_type: string;
  success: boolean;
  error: string | null;
  mr_id: number;
  local_reference_id: number | null;
}

// Module-level monotonically decrementing counter for optimistic comment IDs.
// Guarantees uniqueness even when multiple comments are created in the same millisecond.
let _nextOptimisticId = -1;
const nextOptimisticId = () => _nextOptimisticId--;

export interface ActivityData {
  threads: Comment[][];
  systemEvents: Comment[];
  unresolvedCount: number;
  currentUser: string | null;
  loading: boolean;
  error: string | null;
  addComment: (body: string) => Promise<void>;
  replyToComment: (discussionId: string, parentId: number, body: string) => Promise<void>;
  resolveDiscussion: (discussionId: string, resolved: boolean) => Promise<void>;
  deleteComment: (commentId: number) => Promise<void>;
}

export function useActivityData(mrId: number): ActivityData {
  const queryClient = useQueryClient();
  const commentsQuery = useCommentsQuery(mrId);
  const mrQuery = useMRDetailQuery(mrId);
  const currentUserQuery = useCurrentUserQuery(mrQuery.data?.instanceId ?? 0);

  const comments = commentsQuery.data ?? [];

  // Listen for action-synced failures to mark comments as failed
  useEffect(() => {
    if (!mrId) return;
    let unlisten: (() => void) | undefined;
    tauriListen<ActionSyncedPayload>('action-synced', (event) => {
      const { mr_id, action_type, success, local_reference_id } = event.payload;
      if (mr_id !== mrId) return;
      if (action_type !== 'comment' && action_type !== 'reply') return;

      if (!success && local_reference_id !== null) {
        queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) => {
          if (!prev) return prev;
          return prev.map(c =>
            c.id === local_reference_id ? { ...c, syncStatus: 'failed' as const } : c,
          );
        });
      }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [mrId, queryClient]);

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

  const systemEvents = useMemo(
    () => comments.filter(c => c.system).sort((a, b) => a.createdAt - b.createdAt),
    [comments],
  );

  const unresolvedCount = threads.filter(
    t => t.some(c => c.discussionId) && !t.some(c => c.resolved),
  ).length;

  const currentUser = currentUserQuery.data ?? null;

  const addComment = useCallback(
    async (body: string) => {
      const optimistic: Comment = {
        id: nextOptimisticId(),
        mrId,
        discussionId: null,
        parentId: null,
        authorUsername: currentUser ?? 'you',
        body,
        filePath: null,
        oldLine: null,
        newLine: null,
        resolved: false,
        system: false,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        isLocal: true,
        syncStatus: 'pending',
      };
      queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) => [
        ...(prev ?? []),
        optimistic,
      ]);

      try {
        const created = await addGeneralComment(mrId, body);
        queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) =>
          (prev ?? []).map(c => (c.id === optimistic.id ? created : c)),
        );
      } catch {
        queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) =>
          (prev ?? []).filter(c => c.id !== optimistic.id),
        );
      }
    },
    [mrId, currentUser, queryClient],
  );

  const replyToComment = useCallback(
    async (discussionId: string, parentId: number, body: string) => {
      const optimistic: Comment = {
        id: nextOptimisticId(),
        mrId,
        discussionId,
        parentId,
        authorUsername: currentUser ?? 'you',
        body,
        filePath: null,
        oldLine: null,
        newLine: null,
        resolved: false,
        system: false,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        isLocal: true,
        syncStatus: 'pending',
      };
      queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) => [
        ...(prev ?? []),
        optimistic,
      ]);

      try {
        const created = await replyToDiscussion(mrId, discussionId, parentId, body);
        queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) =>
          (prev ?? []).map(c => (c.id === optimistic.id ? created : c)),
        );
      } catch {
        queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) =>
          (prev ?? []).filter(c => c.id !== optimistic.id),
        );
      }
    },
    [mrId, currentUser, queryClient],
  );

  const resolveDiscussion = useCallback(
    async (discussionId: string, resolved: boolean) => {
      queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) =>
        (prev ?? []).map(c => (c.discussionId === discussionId ? { ...c, resolved } : c)),
      );

      try {
        await setDiscussionResolved(mrId, discussionId, resolved);
      } catch {
        queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) =>
          (prev ?? []).map(c =>
            c.discussionId === discussionId ? { ...c, resolved: !resolved } : c,
          ),
        );
      }
    },
    [mrId, queryClient],
  );

  const deleteComment = useCallback(
    async (commentId: number) => {
      let removedComment: Comment | undefined;
      queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) => {
        if (!prev) return prev;
        removedComment = prev.find(c => c.id === commentId);
        return prev.filter(c => c.id !== commentId);
      });

      try {
        await gitlabDeleteComment(mrId, commentId);
      } catch {
        if (removedComment !== undefined) {
          const toRestore = removedComment;
          queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) => [
            ...(prev ?? []),
            toRestore,
          ]);
        }
      }
    },
    [mrId, queryClient],
  );

  return {
    threads,
    systemEvents,
    unresolvedCount,
    currentUser,
    loading: commentsQuery.isLoading,
    error: commentsQuery.error
      ? (commentsQuery.error instanceof Error ? commentsQuery.error.message : 'Failed to load comments')
      : null,
    addComment,
    replyToComment,
    resolveDiscussion,
    deleteComment,
  };
}
