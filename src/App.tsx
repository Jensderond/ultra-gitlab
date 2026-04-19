/**
 * Main application component with routing.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MotionConfig } from 'motion/react';
import { useQueries } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { isTauri, tauriListen } from './services/transport';
import { trackEvent, trackShortcut } from './services/analytics';
import Settings from './pages/Settings';
import MRListPage from './pages/MRListPage';
import MRDetailPage from './pages/MRDetailPage';
import MRLoadingPage from './pages/MRLoadingPage';
import MyMRsPage from './pages/MyMRsPage';
import MyMRDetailPage from './pages/MyMRDetailPage';
import PipelinesPage from './pages/PipelinesPage';
import PipelineDetailPage from './pages/PipelineDetailPage';
import IssuesPage from './pages/IssuesPage';
import JobLogPage from './pages/JobLogPage';
import AuthPage from './pages/AuthPage';
import { AppSidebar } from './components/AppSidebar';
import { CommandPalette, type Command } from './components/CommandPalette';
import { KeyboardHelp } from './components/KeyboardHelp';
import { ReAuthPrompt } from './components/ReAuthPrompt';
import useUpdateChecker from './hooks/useUpdateChecker';
import { useHasApprovedMRsQuery } from './hooks/queries/useHasApprovedMRsQuery';
import useNotifications from './hooks/useNotifications';
import { useCompanionStatusQuery } from './hooks/queries/useCompanionStatusQuery';
import useCompanionAuth from './hooks/useCompanionAuth';
import useDeepLink from './hooks/useDeepLink';
import { CommandId, CommandCategory, commandDefinitions } from './commands/registry';
import { manualSync } from './services/storage';
import { useInstancesQuery } from './hooks/queries/useInstancesQuery';
import { queryKeys } from './lib/queryKeys';
import { listPipelineProjects, visitPipelineProject } from './services/tauri';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';
import { ThemeProvider } from './components/ThemeProvider';
import { ShortcutsProvider, useShortcuts } from './components/ShortcutsProvider';
import { HotkeysProvider, useHotkey, parseHotkey } from '@tanstack/react-hotkeys';
import { ToastProvider, ToastContainer } from './components/Toast';
import type { AuthExpiredPayload } from './types';
import './App.css';

/** Worker factory for Pierre diffs syntax highlighting (runs off main thread) */
function workerFactory(): Worker {
  return new Worker(WorkerUrl, { type: 'module' });
}

/** Auth expired state for re-auth prompt */
interface AuthExpiredState {
  instanceId: number;
  instanceUrl: string;
  message: string;
}

/**
 * App content with command palette and keyboard help.
 * Separated from App to have access to router hooks.
 */
function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [authExpired, setAuthExpired] = useState<AuthExpiredState | null>(null);
  const companionAuth = useCompanionAuth(isTauri || location.pathname === '/auth');
  const updateChecker = useUpdateChecker();
  const hasApprovedMRs = useHasApprovedMRsQuery();
  const { getKey } = useShortcuts();
  useNotifications();
  useDeepLink();
  const companionStatusQuery = useCompanionStatusQuery();
  const instancesQuery = useInstancesQuery();

  // Track screen views for main overview screens
  useEffect(() => {
    const screenNames: Record<string, string> = {
      '/mrs': 'mr_list',
      '/my-mrs': 'my_mr_list',
      '/pipelines': 'pipelines',
      '/settings': 'settings',
    };
    const screen = screenNames[location.pathname];
    if (screen) trackEvent('screen_view', { screen_name: screen });
  }, [location.pathname]);

  // In browser mode, redirect to /auth if not authenticated
  useEffect(() => {
    if (companionAuth.isAuthenticated === false) {
      navigate('/auth', { replace: true });
    }
  }, [companionAuth.isAuthenticated, navigate]);

  // Listen for auth-expired events from the backend (Tauri-only)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    tauriListen<AuthExpiredPayload>('auth-expired', (event) => {
      const payload = event.payload;
      setAuthExpired({
        instanceId: payload.instanceId,
        instanceUrl: payload.instanceUrl,
        message: payload.message,
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Load pipeline projects for command palette via TQ
  const isAuthed = companionAuth.isAuthenticated;
  const instances = instancesQuery.data ?? [];
  const pipelineProjectQueries = useQueries({
    queries: instances.map((inst) => ({
      queryKey: queryKeys.pipelineProjects(String(inst.id)),
      queryFn: () => listPipelineProjects(inst.id),
      staleTime: 60_000,
      enabled: isTauri || isAuthed === true,
    })),
  });
  const pipelineProjects = useMemo(
    () => pipelineProjectQueries.filter((q) => q.isSuccess).flatMap((q) => q.data ?? []),
    [pipelineProjectQueries],
  );

  // Clear auth expired state
  const dismissAuthExpired = useCallback(() => {
    setAuthExpired(null);
  }, []);

  // Global keyboard shortcuts via TanStack hotkeys
  useHotkey(parseHotkey(getKey('command-palette') ?? 'Mod+P'), () => {
    trackShortcut('Mod+P', 'open_command_palette', 'global');
    setCommandPaletteOpen(true);
  }, { enabled: isTauri });

  useHotkey(parseHotkey(getKey('open-settings') ?? 'Mod+,'), () => {
    trackShortcut('Mod+,', 'open_settings', 'global');
    navigate('/settings');
  }, { enabled: isTauri });

  useHotkey(parseHotkey(getKey('go-to-mr-list') ?? 'Mod+L'), () => {
    trackShortcut('Mod+L', 'navigate_mr_list', 'global');
    navigate('/mrs');
  });

  useHotkey(parseHotkey(getKey('go-to-my-mrs') ?? 'Mod+M'), () => {
    trackShortcut('Mod+M', 'navigate_my_mrs', 'global');
    navigate('/my-mrs');
  });

  useHotkey(parseHotkey(getKey('go-to-pipelines') ?? 'Mod+I'), () => {
    trackShortcut('Mod+I', 'navigate_pipelines', 'global');
    navigate('/pipelines');
  });

  useHotkey(parseHotkey(getKey('go-to-issues') ?? 'Mod+U'), () => {
    trackShortcut('Mod+U', 'navigate_issues', 'global');
    navigate('/issues');
  });

  useHotkey(parseHotkey(getKey('trigger-sync') ?? 'Mod+R'), () => {
    trackShortcut('Mod+R', 'trigger_sync', 'global');
    manualSync(true).catch(console.error);
  }, { enabled: isTauri });

  useHotkey(parseHotkey(getKey('keyboard-help') ?? 'Shift+/'), () => {
    trackShortcut('?', 'show_keyboard_help', 'global');
    setKeyboardHelpOpen(true);
  });

  // Cmd+1..9 to switch instance (dynamic keys — not customizable)
  useEffect(() => {
    function handleInstanceSwitch(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        trackShortcut(`Mod+${e.key}`, 'switch_instance', 'global');
        window.dispatchEvent(
          new CustomEvent('instance-switch', { detail: { index } })
        );
      }
    }
    window.addEventListener('keydown', handleInstanceSwitch);
    return () => window.removeEventListener('keydown', handleInstanceSwitch);
  }, []);

  // Close command palette
  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  // Close keyboard help
  const closeKeyboardHelp = useCallback(() => {
    setKeyboardHelpOpen(false);
  }, []);

  // Create commands with bound actions based on current context
  const commands: Command[] = useMemo(() => {
    const isOnMRList = location.pathname === '/mrs';
    const isOnMRDetail = location.pathname.startsWith('/mrs/');
    const isOnSettings = location.pathname === '/settings';

    const actionMap: Partial<Record<CommandId, () => void>> = {
      // Navigation commands always available
      [CommandId.GoToMRList]: () => navigate('/mrs'),
      [CommandId.GoToMyMRs]: () => navigate('/my-mrs'),
      [CommandId.GoToPipelines]: () => navigate('/pipelines'),
      [CommandId.GoToIssues]: () => navigate('/issues'),
      [CommandId.GoToSettings]: () => navigate('/settings'),
      [CommandId.OpenSettings]: () => navigate('/settings'),
      [CommandId.OpenCommandPalette]: () => setCommandPaletteOpen(true),
      [CommandId.ShowKeyboardHelp]: () => setKeyboardHelpOpen(true),

      // Sync commands always available
      [CommandId.TriggerSync]: () => {
        manualSync(true).catch(console.error);
      },

      // Go back - context dependent
      [CommandId.GoBack]: () => {
        if (isOnMRDetail) {
          navigate('/mrs');
        } else if (isOnSettings) {
          navigate('/mrs');
        }
      },
    };

    // Only include GoBack when not on MR list
    if (isOnMRList) {
      delete actionMap[CommandId.GoBack];
    }

    // Build commands from definitions with bound actions
    const staticCommands: Command[] = commandDefinitions
      .filter((def) => actionMap[def.id] !== undefined)
      .map((def) => ({
        id: def.id,
        label: def.label,
        description: def.description,
        shortcut: def.shortcut,
        category: def.category,
        action: actionMap[def.id]!,
      }));

    // Add dynamic pipeline project commands
    const pipelineCommands: Command[] = pipelineProjects.map((project) => ({
      id: `pipeline.project.${project.instanceId}.${project.projectId}`,
      label: project.nameWithNamespace,
      description: project.pinned ? 'Pinned pipeline project' : 'Recent pipeline project',
      category: CommandCategory.Pipelines,
      action: () => {
        visitPipelineProject(project.instanceId, project.projectId).catch(console.error);
        navigate('/pipelines');
      },
    }));

    return [...staticCommands, ...pipelineCommands];
  }, [location.pathname, navigate, pipelineProjects]);

  // Auth page renders without sidebar (mobile companion flow)
  const isAuthPage = location.pathname === '/auth';

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
      </Routes>
    );
  }

  // In browser mode, wait for auth check before rendering main app
  if (!isTauri && companionAuth.isAuthenticated !== true) {
    return null;
  }

  return (
    <div className="app">
      {isTauri && <div className="titlebar-drag-region" data-tauri-drag-region />}
      <AppSidebar updateAvailable={updateChecker.available} hasApprovedMRs={hasApprovedMRs} companionEnabled={companionStatusQuery.data?.enabled ?? false} companionDeviceCount={companionStatusQuery.data?.connectedDevices ?? 0} />
      <div className="app-content">
        <Routes>
          {/* Redirect root to MR list */}
          <Route path="/" element={<Navigate to="/mrs" replace />} />

          {/* MR list page */}
          <Route path="/mrs" element={<MRListPage />} />

          {/* MR loading page (deep-link fetch for unsynced MRs) */}
          <Route path="/mrs/loading" element={<MRLoadingPage />} />

          {/* MR detail page */}
          <Route path="/mrs/:id" element={<MRDetailPage updateAvailable={updateChecker.available} />} />

          {/* My MRs pages */}
          <Route path="/my-mrs" element={<MyMRsPage />} />
          <Route path="/my-mrs/:id" element={<MyMRDetailPage />} />

          {/* Pipelines dashboard */}
          <Route path="/pipelines" element={<PipelinesPage />} />
          <Route path="/pipelines/:projectId/:pipelineId" element={<PipelineDetailPage />} />
          <Route path="/pipelines/:projectId/:pipelineId/jobs/:jobId" element={<JobLogPage />} />

          {/* Issues dashboard */}
          <Route path="/issues" element={<IssuesPage />} />

          {/* Settings page (desktop only) */}
          {isTauri && (
            <Route path="/settings" element={<Settings updateChecker={updateChecker} />} />
          )}
        </Routes>
      </div>

      {isTauri && (
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={closeCommandPalette}
          commands={commands}
        />
      )}

      <KeyboardHelp
        isOpen={keyboardHelpOpen}
        onClose={closeKeyboardHelp}
        pathname={location.pathname}
      />

      {authExpired && (
        <ReAuthPrompt
          instanceId={authExpired.instanceId}
          instanceUrl={authExpired.instanceUrl}
          message={authExpired.message}
          onDismiss={dismissAuthExpired}
        />
      )}

      <ToastContainer />
    </div>
  );
}

/**
 * Main application component.
 *
 * Provides routing for:
 * - / - Redirect to /mrs
 * - /mrs - List of merge requests
 * - /mrs/:id - Merge request detail/diff view
 * - /settings - Settings and GitLab instance management
 *
 * Also provides:
 * - Command palette (Cmd+P)
 * - Global keyboard shortcuts
 */
function App() {
  return (
    <MotionConfig reducedMotion="user">
    <ThemeProvider>
      <WorkerPoolContextProvider
        poolOptions={{ workerFactory }}
        highlighterOptions={{
          theme: { dark: 'pierre-dark', light: 'pierre-light' },
        }}
      >
        <ToastProvider>
          <BrowserRouter>
            <HotkeysProvider>
              <ShortcutsProvider>
                <AppContent />
              </ShortcutsProvider>
            </HotkeysProvider>
          </BrowserRouter>
        </ToastProvider>
      </WorkerPoolContextProvider>
    </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
