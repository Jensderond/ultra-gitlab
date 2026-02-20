/**
 * Hook for loading file content with in-memory cache for instant navigation.
 *
 * Uses useLayoutEffect for synchronous cache reads (zero-flash on cache hit)
 * and useEffect for async fetches (SQLite cache, then network).
 * Prefetches adjacent reviewable files in the background.
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { isImageFile } from '../utils/languageDetection';
import { getCachedFilePair, getFileContent, getFileContentBase64 } from '../services/gitlab';
import type { MergeRequest, DiffRefs, DiffFileSummary } from '../types';

interface TextContent {
  original: string;
  modified: string;
}

interface ImageContent {
  originalBase64: string;
  modifiedBase64: string;
}

export interface UseFileContentReturn {
  content: TextContent;
  imageContent: ImageContent;
  isLoading: boolean;
  error: string | null;
  clearCache: () => void;
}

const EMPTY_TEXT: TextContent = { original: '', modified: '' };
const EMPTY_IMAGE: ImageContent = { originalBase64: '', modifiedBase64: '' };

export function useFileContent(
  mrId: number,
  mr: MergeRequest | null,
  diffRefs: DiffRefs | null,
  files: DiffFileSummary[],
  selectedFile: string | null,
  reviewableFiles: DiffFileSummary[],
): UseFileContentReturn {
  const [content, setContent] = useState<TextContent>(EMPTY_TEXT);
  const [imageContent, setImageContent] = useState<ImageContent>(EMPTY_IMAGE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which file the current content belongs to so we can detect the
  // one-frame lag between selectedFile changing and useLayoutEffect updating isLoading.
  const [contentFile, setContentFile] = useState<string | null>(null);

  const textCacheRef = useRef<Map<string, TextContent>>(new Map());
  const imageCacheRef = useRef<Map<string, ImageContent>>(new Map());
  const reviewableFilesRef = useRef(reviewableFiles);
  reviewableFilesRef.current = reviewableFiles;

  const clearCache = useCallback(() => {
    textCacheRef.current.clear();
    imageCacheRef.current.clear();
  }, []);

  // Synchronous: check in-memory cache before paint to avoid content flash
  useLayoutEffect(() => {
    if (!selectedFile || !mr || !diffRefs) {
      setContent(EMPTY_TEXT);
      setImageContent(EMPTY_IMAGE);
      setIsLoading(false);
      setError(null);
      setContentFile(null);
      return;
    }

    const isImg = isImageFile(selectedFile);
    if (isImg) {
      const cached = imageCacheRef.current.get(selectedFile);
      if (cached) {
        setImageContent(cached);
        setContent(EMPTY_TEXT);
        setIsLoading(false);
        setError(null);
        setContentFile(selectedFile);
        return;
      }
    } else {
      const cached = textCacheRef.current.get(selectedFile);
      if (cached) {
        setContent(cached);
        setImageContent(EMPTY_IMAGE);
        setIsLoading(false);
        setError(null);
        setContentFile(selectedFile);
        return;
      }
    }

    // Cache miss — show loading immediately (before paint)
    setIsLoading(true);
    setError(null);
  }, [selectedFile, mr, diffRefs]);

  // Async: fetch content on cache miss, then prefetch neighbors
  useEffect(() => {
    if (!selectedFile || !mr || !diffRefs) return;

    const isImg = isImageFile(selectedFile);

    // Skip fetch if in-memory cache already has it
    if (isImg && imageCacheRef.current.has(selectedFile)) return;
    if (!isImg && textCacheRef.current.has(selectedFile)) {
      prefetchAdjacent(selectedFile, mr, diffRefs, mrId);
      return;
    }

    let cancelled = false;
    const fileInfo = files.find((f) => f.newPath === selectedFile);
    const isNewFile = fileInfo?.changeType === 'added';
    const isDeletedFile = fileInfo?.changeType === 'deleted';
    const oldPath = fileInfo?.oldPath || selectedFile;

    async function fetchContent() {
      try {
        if (isImg) {
          const [originalBase64, modifiedBase64] = await Promise.all([
            isNewFile
              ? Promise.resolve('')
              : getFileContentBase64(mr!.instanceId, mr!.projectId, oldPath, diffRefs!.baseSha).catch(() => ''),
            isDeletedFile
              ? Promise.resolve('')
              : getFileContentBase64(mr!.instanceId, mr!.projectId, selectedFile!, diffRefs!.headSha).catch(() => ''),
          ]);

          if (cancelled) return;
          const result: ImageContent = { originalBase64, modifiedBase64 };
          imageCacheRef.current.set(selectedFile!, result);
          setImageContent(result);
          setContent(EMPTY_TEXT);
          setContentFile(selectedFile);
        } else {
          // Try SQLite cache first
          const sqliteCached = await getCachedFilePair(mrId, selectedFile!).catch(() => null);
          if (cancelled) return;

          const needBase = !isNewFile;
          const needHead = !isDeletedFile;
          const cacheHit =
            sqliteCached &&
            (!needBase || sqliteCached.baseContent !== null) &&
            (!needHead || sqliteCached.headContent !== null);

          let result: TextContent;
          if (cacheHit) {
            result = {
              original: needBase ? (sqliteCached!.baseContent ?? '') : '',
              modified: needHead ? (sqliteCached!.headContent ?? '') : '',
            };
          } else {
            const [original, modified] = await Promise.all([
              isNewFile
                ? Promise.resolve('')
                : getFileContent(mr!.instanceId, mr!.projectId, oldPath, diffRefs!.baseSha).catch(() => ''),
              isDeletedFile
                ? Promise.resolve('')
                : getFileContent(mr!.instanceId, mr!.projectId, selectedFile!, diffRefs!.headSha).catch(() => ''),
            ]);
            if (cancelled) return;
            result = { original, modified };
          }

          textCacheRef.current.set(selectedFile!, result);
          setContent(result);
          setImageContent(EMPTY_IMAGE);
          setContentFile(selectedFile);
          prefetchAdjacent(selectedFile!, mr!, diffRefs!, mrId);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load file content');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchContent();
    return () => { cancelled = true; };
  }, [selectedFile, mr, diffRefs, files, mrId]);

  // Prefetch next/prev reviewable files in background (no state updates)
  function prefetchAdjacent(
    currentPath: string,
    mrData: MergeRequest,
    refs: DiffRefs,
    id: number,
  ) {
    const list = reviewableFilesRef.current;
    const currentIdx = list.findIndex((f) => f.newPath === currentPath);
    if (currentIdx === -1) return;

    const neighbors: DiffFileSummary[] = [];
    if (currentIdx + 1 < list.length) neighbors.push(list[currentIdx + 1]);
    if (currentIdx - 1 >= 0) neighbors.push(list[currentIdx - 1]);

    for (const neighbor of neighbors) {
      const path = neighbor.newPath;
      if (isImageFile(path) || textCacheRef.current.has(path)) continue;

      const isNew = neighbor.changeType === 'added';
      const isDeleted = neighbor.changeType === 'deleted';
      const oPath = neighbor.oldPath || path;

      // Fire-and-forget — writes to ref only, no re-renders
      (async () => {
        try {
          const sqliteCached = await getCachedFilePair(id, path).catch(() => null);
          const needBase = !isNew;
          const needHead = !isDeleted;
          const hit =
            sqliteCached &&
            (!needBase || sqliteCached.baseContent !== null) &&
            (!needHead || sqliteCached.headContent !== null);

          if (hit) {
            textCacheRef.current.set(path, {
              original: needBase ? (sqliteCached!.baseContent ?? '') : '',
              modified: needHead ? (sqliteCached!.headContent ?? '') : '',
            });
            return;
          }

          const [original, modified] = await Promise.all([
            isNew
              ? Promise.resolve('')
              : getFileContent(mrData.instanceId, mrData.projectId, oPath, refs.baseSha).catch(() => ''),
            isDeleted
              ? Promise.resolve('')
              : getFileContent(mrData.instanceId, mrData.projectId, path, refs.headSha).catch(() => ''),
          ]);
          textCacheRef.current.set(path, { original, modified });
        } catch {
          // Silently ignore prefetch errors
        }
      })();
    }
  }

  // Treat as loading if selectedFile changed but content hasn't caught up yet.
  // This closes the one-frame gap between the render where selectedFile changes
  // and the useLayoutEffect that sets isLoading=true.
  const effectiveLoading = isLoading || (selectedFile !== null && selectedFile !== contentFile);

  return { content, imageContent, isLoading: effectiveLoading, error, clearCache };
}
