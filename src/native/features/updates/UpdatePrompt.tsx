/**
 * The restart prompt: a sheet over the whole app once an update has
 * downloaded, so nobody has to be asked to update. "Later" (or Esc) puts it
 * away for an hour; the sidebar footer keeps the Restart button meanwhile.
 */

import { Button, Sheet } from '../../ui/components';
import { installUpdate, snoozeUpdate, useUpdateState } from './updater';
import './updates.css';

export function UpdatePrompt() {
  const { phase, version, notes, prompt } = useUpdateState();
  const installing = phase === 'installing';

  return (
    <Sheet
      open={prompt}
      onClose={() => !installing && snoozeUpdate()}
      title="Update ready"
      width={460}
      footer={
        <>
          <Button onClick={snoozeUpdate} disabled={installing} data-autofocus-skip>
            Later
          </Button>
          <Button variant="primary" busy={installing} onClick={() => void installUpdate()}>
            Restart now
          </Button>
        </>
      }
    >
      <p className="upd-prompt__lead">
        Ultra GitLab {version} has been downloaded. Restart to finish updating; it takes a few seconds.
      </p>
      {notes && <div className="upd-prompt__notes">{notes}</div>}
    </Sheet>
  );
}
