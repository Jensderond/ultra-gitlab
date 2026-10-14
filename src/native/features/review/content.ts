/**
 * File contents for the diff: the SQLite cache first (instant), GitLab as a
 * fallback. Results live in the shared query cache, so switching back to a
 * file is instant and neighbours can be prefetched.
 */

import { api } from '../../api/client';
import type { DiffFile, DiffRefs, MergeRequest } from '../../api/types';
import { prefetch, useQuery } from '../../data/query';
import { pairKey } from './state';

export interface FilePair {
  /** Which file/commit this is, so callers never show another file's content. */
  path: string;
  sha: string;
  base: string;
  head: string;
}

async function loadPair(mr: MergeRequest, refs: DiffRefs, file: DiffFile): Promise<FilePair> {
  const needBase = file.changeType !== 'added';
  const needHead = file.changeType !== 'deleted';
  const cached = await api.cachedFilePair(mr.id, file.newPath).catch(() => null);
  if (
    cached &&
    (!needBase || cached.baseContent !== null) &&
    (!needHead || cached.headContent !== null)
  ) {
    return {
      path: file.newPath,
      sha: refs.headSha,
      base: needBase ? (cached.baseContent ?? '') : '',
      head: needHead ? (cached.headContent ?? '') : '',
    };
  }
  const [base, head] = await Promise.all([
    needBase
      ? api.fileContent(mr.instanceId, mr.projectId, file.oldPath || file.newPath, refs.baseSha)
      : Promise.resolve(''),
    needHead ? api.fileContent(mr.instanceId, mr.projectId, file.newPath, refs.headSha) : Promise.resolve(''),
  ]);
  return { path: file.newPath, sha: refs.headSha, base, head };
}

export function useFilePair(
  mr: MergeRequest | undefined,
  refs: DiffRefs | undefined,
  file: DiffFile | undefined,
  enabled = true,
) {
  return useQuery(
    mr && refs && file && enabled ? pairKey(mr.id, file.newPath, refs.headSha) : null,
    () => loadPair(mr!, refs!, file!),
    { staleTime: 5 * 60_000 },
  );
}

export function prefetchPair(mr: MergeRequest, refs: DiffRefs, file: DiffFile) {
  void prefetch(pairKey(mr.id, file.newPath, refs.headSha), () => loadPair(mr, refs, file)).catch(() => {});
}

export interface ContentAt {
  path: string;
  sha: string;
  /** null when the file didn't exist at that commit. */
  text: string | null;
}

/** The file as it was at your last reviewed head. */
export function useContentAt(
  mr: MergeRequest | undefined,
  file: DiffFile | undefined,
  sha: string | undefined,
) {
  return useQuery(
    mr && file && sha ? ['mr', mr.id, 'at', file.newPath, sha] : null,
    async (): Promise<ContentAt> => {
      const at = (text: string | null) => ({ path: file!.newPath, sha: sha!, text });
      const renamed = file!.oldPath && file!.oldPath !== file!.newPath ? file!.oldPath : null;
      // The backend answers a missing file (404) with '' rather than an error,
      // so for renames an empty answer means "look under the old path".
      try {
        const text = await api.fileContent(mr!.instanceId, mr!.projectId, file!.newPath, sha!);
        if (text !== '' || !renamed) return at(text);
      } catch {
        if (!renamed) return at(null);
      }
      try {
        const text = await api.fileContent(mr!.instanceId, mr!.projectId, renamed, sha!);
        return at(text === '' ? null : text);
      } catch {
        return at(null);
      }
    },
    { staleTime: 30 * 60_000 },
  );
}

export interface ImagePair {
  path: string;
  base: string | null;
  head: string | null;
}

export function useImagePair(
  mr: MergeRequest | undefined,
  refs: DiffRefs | undefined,
  file: DiffFile | undefined,
  enabled: boolean,
) {
  return useQuery(
    mr && refs && file && enabled ? ['mr', mr.id, 'image', file.newPath, refs.headSha] : null,
    async (): Promise<ImagePair> => {
      const [base, head] = await Promise.all([
        file!.changeType === 'added'
          ? null
          : api
              .fileContentBase64(mr!.instanceId, mr!.projectId, file!.oldPath || file!.newPath, refs!.baseSha)
              .catch(() => null),
        file!.changeType === 'deleted'
          ? null
          : api.fileContentBase64(mr!.instanceId, mr!.projectId, file!.newPath, refs!.headSha).catch(() => null),
      ]);
      return { path: file!.newPath, base: base || null, head: head || null };
    },
    { staleTime: 30 * 60_000 },
  );
}
