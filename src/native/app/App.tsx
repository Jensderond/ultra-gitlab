/**
 * App root: routing, global shortcuts, first-run redirect.
 */

import { useEffect } from 'react';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';
import { isTauri } from '../api/client';
import { useInstances } from '../data/hooks';
import { InboxScreen } from '../features/inbox/InboxScreen';
import { CommandPalette } from '../features/palette/CommandPalette';
import { PipelineScreen } from '../features/pipelines/PipelineScreen';
import { PipelinesScreen } from '../features/pipelines/PipelinesScreen';
import { ReviewScreen } from '../features/review/ReviewScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { SetupScreen } from '../features/setup/SetupScreen';
import { AppServicesHost, useAppServices } from '../features/settings/services';
import { startUpdater } from '../features/updates/updater';
import { Toaster } from '../ui/components';
import { refreshAll } from './home/HomeLayout';
import { useKeys } from './keys';
import { back, forward, homePath, navigate, paths, useRoute } from './router';

const workerFactory = () => new Worker(WorkerUrl, { type: 'module' });

function Routes() {
  const route = useRoute();
  const { segments: s, query } = route;
  const { data: instances, loading } = useInstances();
  const num = (v: string | null | undefined) => (v ? Number(v) : undefined);

  const needsSetup = !loading && instances !== undefined && instances.length === 0;
  useEffect(() => {
    if (needsSetup && s[0] !== 'setup') navigate(paths.setup(), { replace: true });
  }, [needsSetup, s]);
  useEffect(() => {
    if (s.length === 0) navigate(paths.inbox(), { replace: true });
  }, [s.length]);

  switch (s[0]) {
    case 'setup':
      return <SetupScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'review':
      return <ReviewScreen key={s[1]} mrId={Number(s[1])} file={query.get('file') ?? undefined} />;
    case 'pipelines':
      if (s.length >= 4) {
        return (
          <PipelineScreen
            instanceId={Number(s[1])}
            projectId={Number(s[2])}
            pipelineId={Number(s[3])}
            jobId={num(query.get('job'))}
          />
        );
      }
      return <PipelinesScreen projectId={num(query.get('project'))} filter={query.get('filter') ?? undefined} />;
    case 'inbox':
    default:
      return <InboxScreen view={s[1] ?? 'review'} selectedMrId={num(query.get('mr'))} />;
  }
}

export function App() {
  useAppServices();
  useEffect(startUpdater, []);

  useKeys({
    'mod+1': () => navigate(homePath('inbox')),
    'mod+2': () => navigate(homePath('pipelines')),
    'mod+,': () => navigate(paths.settings()),
    'mod+r': () => void refreshAll(),
    'mod+[': () => back(),
    'mod+]': () => forward(),
  });

  // Mouse back/forward buttons, like Finder.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) back();
      if (e.button === 4) forward();
    };
    window.addEventListener('mouseup', onMouse);
    return () => window.removeEventListener('mouseup', onMouse);
  }, []);

  // The browser's own context menu ("Reload", "Inspect") breaks the illusion.
  useEffect(() => {
    if (!isTauri || import.meta.env.DEV) return;
    const block = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('input, textarea, .selectable, code, pre')) e.preventDefault();
    };
    window.addEventListener('contextmenu', block);
    return () => window.removeEventListener('contextmenu', block);
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory }}
      highlighterOptions={{ theme: { dark: 'pierre-dark', light: 'pierre-light' } }}
    >
      <Routes />
      <CommandPalette />
      <Toaster />
      <AppServicesHost />
    </WorkerPoolContextProvider>
  );
}
