import { manualSync } from './storage';

type ManualRefreshHandler = () => Promise<void> | void;

/**
 * The currently mounted pull-to-refresh surface, if any. Pages register their
 * animated triggerRefresh here so the global Mod+R shortcut can drive the
 * indicator instead of firing a silent background sync. Only one surface is
 * mounted at a time (they live on separate routes), so a singleton suffices.
 */
let current: ManualRefreshHandler | null = null;

export function registerManualRefreshHandler(handler: ManualRefreshHandler): () => void {
  current = handler;
  return () => {
    if (current === handler) current = null;
  };
}

/** Run the page's animated refresh, or fall back to a silent full sync. */
export async function runManualRefresh(): Promise<void> {
  if (current) {
    await current();
  } else {
    await manualSync(true);
  }
}
