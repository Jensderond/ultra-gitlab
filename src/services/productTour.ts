/**
 * Product tour service.
 *
 * Thin wrapper around driver.js that builds the first-run tour steps and
 * theming. Stays router-agnostic — callers pass a `navigate` function so
 * this module has no dependency on react-router.
 */

import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import '../components/ProductTour.css';

const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 2000;

/**
 * Polls the DOM for `selector` (used after a route change mounts new
 * content) and calls `onFound` once it appears. Gives up after ~2s and
 * calls `onFound` anyway — driver.js gracefully renders a step whose
 * element is missing as a centered modal, so timing out is safe.
 */
export function waitForElement(selector: string, onFound: () => void): void {
  const start = performance.now();

  function poll() {
    if (document.querySelector(selector)) {
      onFound();
      return;
    }
    if (performance.now() - start >= POLL_TIMEOUT_MS) {
      onFound();
      return;
    }
    setTimeout(() => requestAnimationFrame(poll), POLL_INTERVAL_MS);
  }

  requestAnimationFrame(poll);
}

export interface ProductTourOptions {
  /** Router navigation, used for the settings step which requires a route change. */
  navigate: (path: string) => void;
  /** Called once the tour is dismissed/completed/closed (driver's onDestroyed). */
  onFinished: () => void;
}

/**
 * Builds the eight-step first-run product tour and returns the driver.js
 * instance. Call `.drive()` on the result to start it.
 */
export function createProductTour({ navigate, onFinished }: ProductTourOptions): Driver {
  const steps: DriveStep[] = [
    {
      popover: {
        title: 'Welcome to Ultra GitLab',
        description:
          'A local-first GitLab client — merge requests, pipelines, and issues sync to your machine, so reviews work offline.',
      },
    },
    {
      element: '[data-tour="sidebar-nav"]',
      popover: {
        title: 'Navigate',
        description:
          'Reviews, My MRs, Pipelines, and Issues live here. Press ⌘1–⌘4 to jump between sections.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '[data-tour="mr-list"]',
      popover: {
        title: 'Your review queue',
        description: 'Merge requests waiting for your review, synced locally.',
        side: 'left',
      },
    },
    {
      popover: {
        title: 'Stay in sync',
        description:
          'Syncs happen automatically in the background; press ⌘R to trigger one manually.',
      },
    },
    {
      element: '[data-tour="shortcut-bar"]',
      popover: {
        title: 'Keyboard first',
        description:
          'Contextual shortcuts always show down here. Press ? (Shift+/) anytime for the full list — every binding is customizable in Settings.',
        side: 'top',
        // Advancing requires a route change to /pipelines, so the default
        // advance is disabled (by providing onNextClick) and we drive it
        // manually once the pipelines page has mounted.
        onNextClick: (_element, _step, { driver: driverObj }) => {
          navigate('/pipelines');
          waitForElement('[data-tour="pipelines"]', () => {
            driverObj.moveNext();
          });
        },
      },
    },
    {
      element: '[data-tour="pipelines"]',
      popover: {
        title: 'Pipelines',
        description:
          'Follow pipeline status across your projects. Pin your own projects to keep them at the top.',
        side: 'left',
        onPrevClick: (_element, _step, { driver: driverObj }) => {
          navigate('/mrs');
          waitForElement('[data-tour="shortcut-bar"]', () => {
            driverObj.movePrevious();
          });
        },
        onNextClick: (_element, _step, { driver: driverObj }) => {
          navigate('/settings/instances');
          waitForElement('[data-tour="settings-instances"]', () => {
            driverObj.moveNext();
          });
        },
      },
    },
    {
      element: '[data-tour="settings-instances"]',
      popover: {
        title: 'Instances',
        description:
          'Add more GitLab instances, and customize themes, fonts, and shortcuts here.',
        side: 'bottom',
        onPrevClick: (_element, _step, { driver: driverObj }) => {
          navigate('/pipelines');
          waitForElement('[data-tour="pipelines"]', () => {
            driverObj.movePrevious();
          });
        },
      },
    },
    {
      popover: {
        title: "That's it",
        description:
          'Press ⌘K for the command palette. You can replay this tour from Settings.',
      },
    },
  ];

  return driver({
    animate: true,
    duration: 350,
    smoothScroll: true,
    overlayOpacity: 0.55,
    stagePadding: 8,
    stageRadius: 8,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    popoverClass: 'ultra-tour-popover',
    allowClose: true,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    onDestroyed: onFinished,
    steps,
  });
}
