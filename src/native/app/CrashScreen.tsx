/**
 * Last-resort error boundary for the native UI beta. A render crash shows
 * this instead of a blank window, with a one-click way back to the classic
 * UI so nobody gets stuck on the beta.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { switchUiVariant } from '../../uiVariant';
import { Button, EmptyState } from '../ui/components';
import { Window } from '../ui/layout';

export class CrashBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ui] Native UI crashed: ${error.stack ?? error.message}${info.componentStack ?? ''}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Window className="crash-screen">
        <div data-tauri-drag-region style={{ height: 'var(--toolbar-h)' }} />
        <EmptyState
          title="Something went wrong"
          message={
            <>
              The native UI beta hit an error: <span className="selectable">{this.state.error.message}</span>
            </>
          }
          action={
            <>
              <Button variant="primary" onClick={() => window.location.reload()}>
                Reload
              </Button>{' '}
              <Button onClick={() => void switchUiVariant('classic')}>Switch back to the classic UI</Button>
            </>
          }
        />
      </Window>
    );
  }
}
