import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useToast } from '../components/Toast';
import { parseDeepLinkUrl } from '../utils/deepLinkParser';
import { isTauri, resolveMrByWebUrl, listInstances } from '../services';

// Module-level flag so the cold-start URL is only processed once,
// even if the hook effect re-runs (React strict mode, HMR, etc.)
let coldStartHandled = false;

/**
 * Hook that listens for ultra-gitlab:// deep-link URLs and navigates accordingly.
 *
 * - If MR is found and opened: navigates to /mrs/:localId
 * - If MR is found but merged/closed: shows toast, navigates to /mrs
 * - If MR not found: navigates to /mrs/loading?url=<encoded-web-url>
 * - If instance not configured: shows error toast
 */
export default function useDeepLink() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const processingRef = useRef(false);

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;

    async function handleDeepLinkUrl(url: string) {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const data = parseDeepLinkUrl(url);
        if (!data) return;

        // Check if the instance is configured
        const instances = await listInstances();
        const matchingInstance = instances.find((inst) => {
          try {
            const instHost = new URL(inst.url).host;
            return instHost === data.instanceHost;
          } catch {
            return false;
          }
        });

        if (!matchingInstance) {
          addToast({
            type: 'info',
            title: 'Instance not configured',
            body: `GitLab instance ${data.instanceHost} is not configured`,
            url: '/settings',
          });
          return;
        }

        // Try to resolve the MR locally
        const resolved = await resolveMrByWebUrl(data.webUrl);

        if (!resolved) {
          // MR not synced yet — go to loading page
          navigate(`/mrs/loading?url=${encodeURIComponent(data.webUrl)}`);
          return;
        }

        if (resolved.state === 'opened') {
          navigate(`/mrs/${resolved.localId}`);
        } else {
          addToast({
            type: 'info',
            title: 'MR not actionable',
            body: `This MR has been ${resolved.state} and is no longer actionable`,
          });
          navigate('/mrs');
        }
      } finally {
        processingRef.current = false;
      }
    }

    async function setup() {
      const deepLink = await import('@tauri-apps/plugin-deep-link');

      // Handle cold start — the URL that launched the app.
      // Only process once per app lifecycle to prevent re-navigation
      // when the effect re-runs (strict mode, HMR, dependency changes).
      if (!coldStartHandled) {
        coldStartHandled = true;
        try {
          const urls = await deepLink.getCurrent();
          if (!cancelled && urls && urls.length > 0) {
            handleDeepLinkUrl(urls[0]);
          }
        } catch {
          // getCurrent may fail if no URL launched the app
        }
      }

      // Listen for subsequent deep-link URLs (warm start)
      const unlisten = await deepLink.onOpenUrl(async (urls) => {
        if (!cancelled && urls.length > 0) {
          // Surface the window if it was hidden (macOS hide-on-close)
          const appWindow = getCurrentWindow();
          await appWindow.show();
          await appWindow.setFocus();

          handleDeepLinkUrl(urls[0]);
        }
      });

      return unlisten;
    }

    let unlisten: (() => void) | undefined;
    setup().then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [navigate, addToast]);
}
