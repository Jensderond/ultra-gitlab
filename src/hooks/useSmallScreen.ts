import { useState, useEffect } from 'react';

const SMALL_SCREEN_BREAKPOINT = 768;

/**
 * Returns true when viewport width is below 768px.
 * Listens for resize via matchMedia so the value updates live.
 */
export function useSmallScreen(): boolean {
  const [isSmall, setIsSmall] = useState(
    () => window.innerWidth < SMALL_SCREEN_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${SMALL_SCREEN_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsSmall(e.matches);
    mql.addEventListener('change', handler);
    setIsSmall(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isSmall;
}
