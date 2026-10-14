/**
 * Entry point: boots either the classic UI or the native UI beta (see
 * `uiVariant.ts`). Each lives in its own chunk, so only the chosen one loads.
 */

import { uiVariant } from './uiVariant';

if (uiVariant === 'native') {
  import('./native/main').catch((error) => {
    // A broken native bundle must never lock someone out: fall back to classic.
    console.error('[ui] Native UI failed to load, falling back to classic', error);
    void import('./main.classic');
  });
} else {
  void import('./main.classic');
}
