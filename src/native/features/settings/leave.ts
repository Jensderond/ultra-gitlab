/**
 * "Close" for modal-ish screens (Settings, Add instance): go back to the
 * screen we came from. `history.back()` alone is unsafe on a cold start (it
 * could leave the app), so we remember the in-app path seen before this one.
 */

import { useEffect } from 'react';
import { back, navigate, paths, useRoute } from '../../app/router';

let previous: string | null = null;
let current: string | null = null;

/** Mounted once (AppServicesHost) to follow route changes. */
export function useTrackRoute() {
  const { path, query } = useRoute();
  const full = path + (query.toString() ? `?${query}` : '');
  useEffect(() => {
    if (full === current) return;
    // Tab switches inside one screen (?tab=) aren't "coming from" anywhere.
    if (current && current.split('?')[0] !== path) previous = current;
    current = full;
  }, [full, path]);
}

export function leave() {
  const here = location.pathname;
  if (previous && previous.split('?')[0] !== here) back();
  else navigate(paths.inbox(), { replace: true });
}
