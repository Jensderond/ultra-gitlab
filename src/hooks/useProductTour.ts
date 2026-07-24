/**
 * Owns the lifecycle of the first-run product tour.
 *
 * Auto-starts once (per app session) when `enabled` and the user hasn't
 * seen it yet, and exposes `startTour` for manual replay (e.g. from
 * Settings). Also listens for a window-level replay event so a distant
 * component (Settings) can trigger a restart without lifting state.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Driver } from 'driver.js';
import { queryKeys } from '../lib/queryKeys';
import { updateHasSeenProductTour } from '../services/tauri';
import { createProductTour } from '../services/productTour';
import { useSettingsQuery } from './queries/useSettingsQuery';

/** Dispatch this window event to (re)start the tour from anywhere in the app. */
export const PRODUCT_TOUR_REPLAY_EVENT = 'ultra:start-product-tour';

interface UseProductTourOptions {
  /** Gates auto-start only — `startTour()` always works regardless of this. */
  enabled: boolean;
}

export function useProductTour({ enabled }: UseProductTourOptions) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const driverRef = useRef<Driver | null>(null);
  const hasAutoStartedRef = useRef(false);

  const markSeen = useCallback(() => {
    updateHasSeenProductTour(true)
      .catch((err) => console.error('Failed to persist product tour state:', err))
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      });
  }, [queryClient]);

  const runTour = useCallback(() => {
    driverRef.current?.destroy();
    const tour = createProductTour({ navigate, onFinished: markSeen });
    driverRef.current = tour;
    tour.drive();
  }, [navigate, markSeen]);

  const startTour = useCallback(() => {
    runTour();
  }, [runTour]);

  // Auto-start on first run, once settings have loaded. Waits two animation
  // frames so components mounted during this commit (e.g. after a route
  // change) are actually in the DOM before driver.js looks for them.
  useEffect(() => {
    if (!enabled) return;
    if (hasAutoStartedRef.current) return;
    if (!settingsQuery.data) return;
    if (settingsQuery.data.hasSeenProductTour) return;

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        // Set only when the tour actually fires: StrictMode runs this effect,
        // its cleanup (cancelling the frames), then the effect again — setting
        // the ref synchronously would make the second run bail and no tour start.
        hasAutoStartedRef.current = true;
        runTour();
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [enabled, settingsQuery.data, runTour]);

  // Manual replay trigger, fired e.g. from the Settings page.
  useEffect(() => {
    function handleReplay() {
      startTour();
    }
    window.addEventListener(PRODUCT_TOUR_REPLAY_EVENT, handleReplay);
    return () => window.removeEventListener(PRODUCT_TOUR_REPLAY_EVENT, handleReplay);
  }, [startTour]);

  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
    };
  }, []);

  return { startTour };
}
