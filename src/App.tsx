/**
 * Main application component with routing.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import Settings from './pages/Settings';
import MRListPage from './pages/MRListPage';
import MRDetailPage from './pages/MRDetailPage';
import MyMRsPage from './pages/MyMRsPage';
import MyMRDetailPage from './pages/MyMRDetailPage';
import PipelinesPage from './pages/PipelinesPage';
import { AppSidebar } from './components/AppSidebar';
import { CommandPalette, type Command } from './components/CommandPalette';
import { KeyboardHelp } from './components/KeyboardHelp';
import { ReAuthPrompt } from './components/ReAuthPrompt';
import useUpdateChecker from './hooks/useUpdateChecker';
import useHasApprovedMRs from './hooks/useHasApprovedMRs';
import { CommandId, CommandCategory, commandDefinitions } from './commands/registry';
import { manualSync } from './services/storage';
import { listInstances } from './services/gitlab';
import { listPipelineProjects, visitPipelineProject } from './services/tauri';
import { MonacoProvider } from './components/Monaco';
import { ToastProvider, useToast, ToastContainer } from './components/Toast';
import type { AuthExpiredPayload, PipelineProject } from './types';
import './App.css';

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
  const [pipelineProjects, setPipelineProjects] = useState<PipelineProject[]>([]);
  const updateChecker = useUpdateChecker();
  const hasApprovedMRs = useHasApprovedMRs();
  const { toasts } = useToast();

  // Listen for auth-expired events from the backend
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<AuthExpiredPayload>('auth-expired', (event) => {
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

  // Load pipeline projects for command palette
  useEffect(() => {
    async function loadPipelineProjects() {
      try {
        const instances = await listInstances();
        const allProjects: PipelineProject[] = [];
        for (const inst of instances) {
          const projects = await listPipelineProjects(inst.id);
          allProjects.push(...projects);
        }
        setPipelineProjects(allProjects);
      } catch {
        // Non-critical — command palette just won't show pipeline projects
      }
    }
    loadPipelineProjects();
  }, []);

  // Clear auth expired state
  const dismissAuthExpired = useCallback(() => {
    setAuthExpired(null);
  }, []);

  // Open command palette with Cmd+P (or Ctrl+P on Windows/Linux)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Cmd+P or Ctrl+P to open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Cmd+, or Ctrl+, to open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        navigate('/settings');
        return;
      }

      // Cmd+L or Ctrl+L to go to MR list
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        navigate('/mrs');
        return;
      }

      // Cmd+M or Ctrl+M to go to My MRs
      if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault();
        navigate('/my-mrs');
        return;
      }

      // Cmd+I or Ctrl+I to go to Pipelines
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        navigate('/pipelines');
        return;
      }

      // Cmd+R or Ctrl+R to trigger sync (prevent browser refresh)
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        manualSync().catch(console.error);
        return;
      }

      // '?' to show keyboard help (but not Shift+/ which is also '?')
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setKeyboardHelpOpen(true);
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

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
      [CommandId.GoToSettings]: () => navigate('/settings'),
      [CommandId.OpenSettings]: () => navigate('/settings'),
      [CommandId.OpenCommandPalette]: () => setCommandPaletteOpen(true),
      [CommandId.ShowKeyboardHelp]: () => setKeyboardHelpOpen(true),

      // Sync commands always available
      [CommandId.TriggerSync]: () => {
        manualSync().catch(console.error);
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

  return (
    <div className="app">
      <div className="titlebar-drag-region" data-tauri-drag-region />
      <AppSidebar updateAvailable={updateChecker.available} hasApprovedMRs={hasApprovedMRs} hasActiveToasts={toasts.length > 0} />
      <div className="app-content">
        <Routes>
          {/* Redirect root to MR list */}
          <Route path="/" element={<Navigate to="/mrs" replace />} />

          {/* MR list page */}
          <Route path="/mrs" element={<MRListPage />} />

          {/* MR detail page */}
          <Route path="/mrs/:id" element={<MRDetailPage updateAvailable={updateChecker.available} />} />

          {/* My MRs pages */}
          <Route path="/my-mrs" element={<MyMRsPage />} />
          <Route path="/my-mrs/:id" element={<MyMRDetailPage />} />

          {/* Pipelines dashboard */}
          <Route path="/pipelines" element={<PipelinesPage />} />

          {/* Settings page */}
          <Route path="/settings" element={<Settings updateChecker={updateChecker} />} />
        </Routes>
      </div>

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={closeCommandPalette}
        commands={commands}
      />

      <KeyboardHelp
        isOpen={keyboardHelpOpen}
        onClose={closeKeyboardHelp}
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
    <MonacoProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </ToastProvider>
    </MonacoProvider>
  );
}

export default App;
