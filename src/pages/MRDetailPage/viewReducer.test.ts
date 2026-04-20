import { describe, it, expect } from 'vitest';
import { viewReducerForTest as viewReducer, initialViewState } from './viewReducer';

describe('viewReducer — approval delta', () => {
  it('SET_CHANGED_SET stores the set', () => {
    const next = viewReducer(initialViewState, {
      type: 'SET_CHANGED_SET',
      paths: ['a.ts', 'b.ts'],
    });
    expect(Array.from(next.changedSinceApprovalPaths).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('TOGGLE_CHANGED_FILTER flips filterToChangedOnly', () => {
    const next = viewReducer(initialViewState, { type: 'TOGGLE_CHANGED_FILTER' });
    expect(next.filterToChangedOnly).toBe(true);
    const back = viewReducer(next, { type: 'TOGGLE_CHANGED_FILTER' });
    expect(back.filterToChangedOnly).toBe(false);
  });

  it('DISMISS_BANNER sets bannerDismissed', () => {
    const next = viewReducer(initialViewState, { type: 'DISMISS_BANNER' });
    expect(next.bannerDismissed).toBe(true);
  });

  it('RESET_CHANGED_SET clears set, filter, and banner dismissal', () => {
    const primed = {
      ...initialViewState,
      changedSinceApprovalPaths: new Set(['a.ts']),
      filterToChangedOnly: true,
      bannerDismissed: true,
    };
    const next = viewReducer(primed, { type: 'RESET_CHANGED_SET' });
    expect(next.changedSinceApprovalPaths.size).toBe(0);
    expect(next.filterToChangedOnly).toBe(false);
    expect(next.bannerDismissed).toBe(false);
  });
});
