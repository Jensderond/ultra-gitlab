/**
 * Main application component with routing.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import Settings from './pages/Settings';
import MRListPage from './pages/MRListPage';
import MRDetailPage from './pages/MRDetailPage';
import { CommandPalette, type Command } from './components/CommandPalette';
import { KeyboardHelp } from './components/KeyboardHelp';
import { ReAuthPrompt } from './components/ReAuthPrompt';
import { CommandId, commandDefinitions } from './commands/registry';
import { manualSync } from './services/storage';
import type { AuthExpiredPayload } from './types';
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
    return commandDefinitions
      .filter((def) => actionMap[def.id] !== undefined)
      .map((def) => ({
        id: def.id,
        label: def.label,
        description: def.description,
        shortcut: def.shortcut,
        category: def.category,
        action: actionMap[def.id]!,
      }));
  }, [location.pathname, navigate]);

  return (
    <div className="app">
      <Routes>
        {/* Redirect root to MR list */}
        <Route path="/" element={<Navigate to="/mrs" replace />} />

        {/* MR list page */}
        <Route path="/mrs" element={<MRListPage />} />

        {/* MR detail page */}
        <Route path="/mrs/:id" element={<MRDetailPage />} />

        {/* Settings page */}
        <Route path="/settings" element={<Settings />} />
      </Routes>

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
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
