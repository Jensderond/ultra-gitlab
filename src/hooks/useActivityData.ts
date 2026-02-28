import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  listComments,
  listInstances,
  getMergeRequestById,
  addGeneralComment,
  replyToDiscussion,
  setDiscussionResolved,
  deleteComment as gitlabDeleteComment,
} from '../services/gitlab';
import type { Comment } from '../types';

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
  const [comments, setComments] = useState<Comment[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [commentData, mrData, instances] = await Promise.all([
          listComments(mrId),
          getMergeRequestById(mrId),
          listInstances(),
        ]);
        setComments(commentData);
        const matchingInstance = instances.find((inst) => inst.id === mrData.instanceId);
        setCurrentUser(matchingInstance?.authenticatedUsername ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load comments');
      } finally {
        setLoading(false);
      }
    }
    if (mrId) load();
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

  const systemEvents = useMemo(
    () => comments.filter(c => c.system).sort((a, b) => a.createdAt - b.createdAt),
    [comments],
  );

  const unresolvedCount = threads.filter(
    t => t.some(c => c.discussionId) && !t.some(c => c.resolved),
  ).length;

  const addComment = useCallback(
    async (body: string) => {
      const optimistic: Comment = {
        id: -Date.now(),
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
      setComments(prev => [...prev, optimistic]);

      try {
        const created = await addGeneralComment(mrId, body);
        setComments(prev => prev.map(c => (c.id === optimistic.id ? created : c)));
      } catch {
        setComments(prev => prev.filter(c => c.id !== optimistic.id));
      }
    },
    [mrId, currentUser],
  );

  const replyToComment = useCallback(
    async (discussionId: string, parentId: number, body: string) => {
      const optimistic: Comment = {
        id: -Date.now(),
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
      setComments(prev => [...prev, optimistic]);

      try {
        const created = await replyToDiscussion(mrId, discussionId, parentId, body);
        setComments(prev => prev.map(c => (c.id === optimistic.id ? created : c)));
      } catch {
        setComments(prev => prev.filter(c => c.id !== optimistic.id));
      }
    },
    [mrId, currentUser],
  );

  const resolveDiscussion = useCallback(
    async (discussionId: string, resolved: boolean) => {
      setComments(prev =>
        prev.map(c => (c.discussionId === discussionId ? { ...c, resolved } : c)),
      );

      try {
        await setDiscussionResolved(mrId, discussionId, resolved);
      } catch {
        setComments(prev =>
          prev.map(c => (c.discussionId === discussionId ? { ...c, resolved: !resolved } : c)),
        );
      }
    },
    [mrId],
  );

  const deleteComment = useCallback(
    async (commentId: number) => {
      const removed = comments.find(c => c.id === commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));

      try {
        await gitlabDeleteComment(mrId, commentId);
      } catch {
        if (removed) setComments(prev => [...prev, removed]);
      }
    },
    [mrId, comments],
  );

  return {
    threads,
    systemEvents,
    unresolvedCount,
    currentUser,
    loading,
    error,
    addComment,
    replyToComment,
    resolveDiscussion,
    deleteComment,
  };
}
