import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getFileComments } from '../../services/tauri';
import type { LineComment } from '../../components/PierreDiffViewer/PierreDiffViewer';

function toLineComments(
  comments: Awaited<ReturnType<typeof getFileComments>>,
): LineComment[] {
  return comments
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
}

export function useFileCommentsQuery(mrId: number, filePath: string | null) {
  return useQuery({
    queryKey: queryKeys.mrFileComments(mrId, filePath ?? ''),
    queryFn: () => getFileComments(mrId, filePath!).then(toLineComments),
    enabled: mrId > 0 && !!filePath,
    staleTime: 30_000,
  });
}
