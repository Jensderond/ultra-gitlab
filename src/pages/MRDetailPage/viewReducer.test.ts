import { describe, it, expect } from 'vitest';
import { viewReducer, initialViewState } from './viewReducer';

describe('viewReducer editMode', () => {
  it('starts with editMode off', () => {
    expect(initialViewState.editMode).toBe(false);
  });

  it('enters and exits edit mode', () => {
    const entered = viewReducer(initialViewState, { type: 'ENTER_EDIT_MODE' });
    expect(entered.editMode).toBe(true);
    const exited = viewReducer(entered, { type: 'EXIT_EDIT_MODE' });
    expect(exited.editMode).toBe(false);
  });

  it('leaves edit mode when a file is selected', () => {
    const entered = viewReducer(initialViewState, { type: 'ENTER_EDIT_MODE' });
    const next = viewReducer(entered, {
      type: 'SELECT_FILE',
      path: 'src/other.ts',
      index: 1,
      hasSavedState: false,
    });
    expect(next.editMode).toBe(false);
  });

  it('leaves edit mode when the view mode changes', () => {
    const entered = viewReducer(initialViewState, { type: 'ENTER_EDIT_MODE' });
    const next = viewReducer(entered, { type: 'SET_VIEW_MODE', mode: 'split' });
    expect(next.editMode).toBe(false);
  });
});
