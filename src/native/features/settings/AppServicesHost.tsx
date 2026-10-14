/** UI for the background services: the "session expired" sheet. Mount once. */

import { dismissAuthExpired, useAuthExpired } from './authStore';
import { useTrackRoute } from './leave';
import { hostOf, TokenSheet } from './TokenSheet';

export function AppServicesHost() {
  useTrackRoute();
  const expired = useAuthExpired();
  if (!expired) return null;
  const host = hostOf(expired.instanceUrl);
  return (
    <TokenSheet
      key={expired.instanceId}
      open
      instanceId={expired.instanceId}
      instanceUrl={expired.instanceUrl}
      title="Your GitLab session expired"
      message={
        <>
          Ultra GitLab can't sync <strong>{host}</strong> because its access token expired or was revoked.
          Paste a new personal access token to pick up where you left off.
        </>
      }
      cancelLabel="Later"
      onClose={(updated) => dismissAuthExpired(!updated)}
    />
  );
}
