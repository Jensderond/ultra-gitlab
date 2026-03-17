import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getFileComments } from '../../services/tauri';
import type { LineComment } from '../../components/PierreDiffViewer/PierreDiffViewer';

function toLineComments(
  comments: Awaited<ReturnType<typeof getFileComments>>,
): LineComment[] {
  // Group all inline (non-system, has line number) comments by discussionId.
  // GitLab threads share a discussionId — the first comment is the root,
  // subsequent ones are replies (they don't use parentId).
  const discussionMap = new Map<string, typeof comments>();
  const standaloneComments: typeof comments = [];

  for (const c of comments) {
    if (c.system) continue;
    if (c.newLine === null && c.oldLine === null) continue;

    if (c.discussionId) {
      const arr = discussionMap.get(c.discussionId) ?? [];
      arr.push(c);
      discussionMap.set(c.discussionId, arr);
    } else {
      standaloneComments.push(c);
    }
  }

  const result: LineComment[] = [];

  // Threaded discussions — first comment is root, rest are replies
  for (const [, thread] of discussionMap) {
    const root = thread[0];
    const replies = thread.slice(1);
    result.push({
      id: root.id,
      line: root.newLine ?? root.oldLine ?? 0,
      isOldLine: root.newLine === null && root.oldLine !== null,
      authorUsername: root.authorUsername,
      body: root.body,
      createdAt: root.createdAt,
      resolved: root.resolved,
      discussionId: root.discussionId,
      replies: replies.map((r) => ({
        id: r.id,
        line: root.newLine ?? root.oldLine ?? 0,
        authorUsername: r.authorUsername,
        body: r.body,
        createdAt: r.createdAt,
        resolved: r.resolved,
        discussionId: r.discussionId,
      })),
    });
  }

  // Standalone comments (no discussionId) — each is its own thread
  for (const c of standaloneComments) {
    result.push({
      id: c.id,
      line: c.newLine ?? c.oldLine ?? 0,
      isOldLine: c.newLine === null && c.oldLine !== null,
      authorUsername: c.authorUsername,
      body: c.body,
      createdAt: c.createdAt,
      resolved: c.resolved,
      discussionId: c.discussionId,
    });
  }

  return result;
}

export function useFileCommentsQuery(mrId: number, filePath: string | null) {
  return useQuery({
    queryKey: queryKeys.mrFileComments(mrId, filePath ?? ''),
    queryFn: () => getFileComments(mrId, filePath!).then(toLineComments),
    enabled: mrId > 0 && !!filePath,
    staleTime: 30_000,
  });
}
