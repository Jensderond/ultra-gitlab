import { useState, useEffect, useCallback } from 'react';
import { invoke } from '../../services/tauri';
import type { Comment } from '../../types';
import type { LineComment } from '../../components/Monaco/MonacoDiffViewer';

export function useFileComments(mrId: number, selectedFile: string | null) {
  const [fileComments, setFileComments] = useState<LineComment[]>([]);

  useEffect(() => {
    async function loadComments() {
      if (!mrId || !selectedFile) {
        setFileComments([]);
        return;
      }

      try {
        const comments = await invoke<Comment[]>('get_file_comments', {
          mrId,
          filePath: selectedFile,
        });

        const lineComments: LineComment[] = comments
          .filter((c) => !c.system && (c.newLine !== null || c.oldLine !== null))
          .map((c) => ({
            id: c.id,
            line: c.newLine ?? c.oldLine ?? 0,
            isOldLine: c.newLine === null && c.oldLine !== null,
            authorUsername: c.authorUsername,
            body: c.body,
            createdAt: c.createdAt,
            resolved: c.resolved,
          }));

        setFileComments(lineComments);
      } catch {
        setFileComments([]);
      }
    }
    loadComments();
  }, [mrId, selectedFile]);

  const addComment = useCallback((comment: LineComment) => {
    setFileComments((prev) => [...prev, comment]);
  }, []);

  return { fileComments, addComment };
}
