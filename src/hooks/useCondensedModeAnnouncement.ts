import { useEffect, useRef } from 'react';
import { useToast } from '../components/Toast';
import { useSettingsQuery } from './queries/useSettingsQuery';

const STORAGE_KEY = 'ultragitlab.condensedModeToastSeen.v1';
const ACTIVE_THRESHOLD_MS = 8000;

/**
 * Announces the new "condensed MR list" setting via a one-time toast,
 * shown after the user has spent ~8s interacting with an MR list page.
 * No-ops if the user has already seen it or already has condensed mode on.
 */
export function useCondensedModeAnnouncement() {
  const { addToast } = useToast();
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  const settingsQuery = useSettingsQuery();
  const condensed = settingsQuery.data?.mrListCondensed ?? false;

  useEffect(() => {
    if (!settingsQuery.isSuccess) return;

    if (localStorage.getItem(STORAGE_KEY) === '1') return;

    if (condensed) {
      // User already enabled it (e.g. discovered via settings) — suppress the toast forever.
      localStorage.setItem(STORAGE_KEY, '1');
      return;
    }

    let interacted = false;
    let elapsed = 0;
    let lastTick = Date.now();
    let fired = false;

    const markInteraction = () => {
      interacted = true;
    };

    const events: Array<keyof WindowEventMap> = ['keydown', 'mousedown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, markInteraction, { passive: true }));

    const interval = window.setInterval(() => {
      const now = Date.now();
      if (!document.hidden) {
        elapsed += now - lastTick;
      }
      lastTick = now;

      if (!fired && interacted && elapsed >= ACTIVE_THRESHOLD_MS) {
        fired = true;
        localStorage.setItem(STORAGE_KEY, '1');
        addToastRef.current({
          type: 'info',
          title: 'New: Condensed MR list',
          body: 'Fit more MRs on screen with a tighter two-line layout. Enable it in Appearance settings.',
          route: '/settings?highlight=condensed-mr-list',
          sticky: true,
        });
        window.clearInterval(interval);
        events.forEach((e) => window.removeEventListener(e, markInteraction));
      }
    }, 1000);

    return () => {
      window.clearInterval(interval);
      events.forEach((e) => window.removeEventListener(e, markInteraction));
    };
  }, [settingsQuery.isSuccess, condensed]);
}
