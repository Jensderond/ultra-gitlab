/**
 * Hook that checks whether the current browser session is authenticated
 * with the companion server by calling /api/instances.
 *
 * Used by App.tsx (gate main app) and AuthPage.tsx (skip PIN if already authed).
 * This is a browser-mode auth guard, NOT a data-fetching hook.
 */

import { useState, useEffect } from 'react';

interface CompanionAuthState {
  /** null while checking, true/false once resolved */
  isAuthenticated: boolean | null;
  /** true while the initial check is in flight */
  isChecking: boolean;
}

export default function useCompanionAuth(skip = false): CompanionAuthState {
  const [state, setState] = useState<CompanionAuthState>({
    isAuthenticated: skip ? null : null,
    isChecking: !skip,
  });

  useEffect(() => {
    if (skip) return;

    let cancelled = false;

    async function checkSession() {
      try {
        const res = await fetch('/api/instances', { credentials: 'include' });
        if (!cancelled) {
          setState({ isAuthenticated: res.ok, isChecking: false });
        }
      } catch {
        if (!cancelled) {
          setState({ isAuthenticated: false, isChecking: false });
        }
      }
    }

    checkSession();
    return () => { cancelled = true; };
  }, [skip]);

  return state;
}
