import { useEffect, useState } from 'react';
import { preloadHighlighter, getFiletypeFromFileName } from '@pierre/diffs';

/**
 * Preload the main-thread highlighter grammar for a file.
 *
 * Pierre's editor tokenizes on the main thread (the worker pool only covers
 * read-only renders) and silently drops keystrokes typed before its grammar
 * loads — so edit mode must stay unavailable until this resolves.
 */
export function useHighlighterPreload(filePath: string | null, enabled: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || !filePath) {
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: [getFiletypeFromFileName(filePath)],
    })
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // Stay not-ready: the edit button remains disabled, diff stays usable read-only.
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, enabled]);

  return ready;
}
