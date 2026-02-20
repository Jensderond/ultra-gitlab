/**
 * MR Loading page for deep-linked MRs not yet synced locally.
 *
 * Reads the `url` query param, fetches the MR from GitLab,
 * then navigates to the MR detail page once stored.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { parseDeepLinkUrl, type DeepLinkData } from '../utils/deepLinkParser';
import { fetchMrByWebUrl } from '../services';
import './MRLoadingPage.css';

const TIMEOUT_MS = 30_000;

export default function MRLoadingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { addToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const webUrl = searchParams.get('url') || '';

  // Parse display info from the URL
  const parsed: DeepLinkData | null = webUrl
    ? parseDeepLinkUrl(`ultra-gitlab://open?url=${encodeURIComponent(webUrl)}`)
    : null;

  useEffect(() => {
    if (!webUrl || startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setError('Request timed out after 30 seconds. The MR may not exist or the server is unreachable.');
    }, TIMEOUT_MS);

    async function fetchMR() {
      try {
        const result = await fetchMrByWebUrl(webUrl);

        clearTimeout(timeout);
        if (controller.signal.aborted) return;

        if (result.state === 'merged' || result.state === 'closed') {
          addToast({
            type: 'info',
            title: 'MR not actionable',
            body: `This MR has been ${result.state} and is no longer actionable`,
          });
          navigate('/mrs', { replace: true });
        } else {
          navigate(`/mrs/${result.localId}`, { replace: true });
        }
      } catch (err) {
        clearTimeout(timeout);
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch merge request');
      }
    }

    fetchMR();

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webUrl]);

  if (error) {
    return (
      <div className="mr-loading-page">
        <div className="mr-loading-error">
          <div className="mr-loading-error-icon">!</div>
          <p className="mr-loading-error-message">{error}</p>
          <button
            className="mr-loading-error-button"
            onClick={() => navigate('/mrs', { replace: true })}
          >
            Go to Merge Requests
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-loading-page">
      <div className="mr-loading-spinner" />
      <p className="mr-loading-text">
        {parsed
          ? `Loading MR !${parsed.mrIid} from ${parsed.projectPath}...`
          : 'Loading merge request...'}
      </p>
    </div>
  );
}
