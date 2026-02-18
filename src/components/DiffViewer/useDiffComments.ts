import { useState, useEffect, useCallback, useMemo } from 'react';
import type { DiffHunk, Comment } from '../../types';
import { invoke } from '../../services/tauri';

interface UseDiffCommentsOptions {
  mrId: number;
  projectId: number;
  mrIid: number;
  filePath: string;
  currentUser?: string;
  baseSha?: string;
  headSha?: string;
  startSha?: string;
  effectiveHunks: (DiffHunk | null)[];
}

export function useDiffComments({
  mrId,
  projectId,
  mrIid,
  filePath,
  currentUser,
  baseSha,
  headSha,
  startSha,
  effectiveHunks,
}: UseDiffCommentsOptions) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [addingCommentAt, setAddingCommentAt] = useState<{ hunk: number; line: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load comments for this file
  useEffect(() => {
    async function loadComments() {
      try {
        const result = await invoke<Comment[]>('get_file_comments', { mrId, filePath });
        setComments(result);
      } catch (err) {
        console.error('Failed to load comments:', err);
      }
    }
    loadComments();
  }, [mrId, filePath]);

  // Add comment handler
  const handleAddComment = useCallback(async (body: string) => {
    if (!addingCommentAt || !currentUser) return;

    const hunk = effectiveHunks[addingCommentAt.hunk];
    if (!hunk) return;
    const line = hunk.lines[addingCommentAt.line];

    try {
      setIsSubmitting(true);
      await invoke('add_comment', {
        input: {
          mrId,
          projectId,
          mrIid,
          body,
          authorUsername: currentUser,
          filePath,
          oldLine: line.oldLineNumber,
          newLine: line.newLineNumber,
          lineType: line.type,
          baseSha,
          headSha,
          startSha,
        },
      });

      // Refresh comments
      const result = await invoke<Comment[]>('get_file_comments', { mrId, filePath });
      setComments(result);
      setAddingCommentAt(null);
    } catch (err) {
      console.error('Failed to add comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [addingCommentAt, effectiveHunks, mrId, projectId, mrIid, filePath, currentUser, baseSha, headSha, startSha]);

  // Group comments by line number
  const commentsByLine = useMemo(() => {
    const map = new Map<number, Comment[]>();
    for (const comment of comments) {
      const lineNum = comment.newLine ?? comment.oldLine;
      if (lineNum !== null) {
        const existing = map.get(lineNum) ?? [];
        existing.push(comment);
        map.set(lineNum, existing);
      }
    }
    return map;
  }, [comments]);

  const startAddingComment = useCallback((hunk: number, line: number) => {
    setAddingCommentAt({ hunk, line });
  }, []);

  const cancelAddingComment = useCallback(() => {
    setAddingCommentAt(null);
  }, []);

  return {
    commentsByLine,
    addingCommentAt,
    isSubmitting,
    handleAddComment,
    startAddingComment,
    cancelAddingComment,
  };
}
