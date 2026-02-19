/**
 * Base test fixture for Ultra GitLab Playwright tests.
 *
 * Extends Playwright's test with Tauri IPC mocking so every test
 * runs against the full desktop UI with seeded data.
 */

import { test as base, expect } from '@playwright/test';
import { mockTauriIPC } from './tauri-mock';

/**
 * Extended test fixture that automatically sets up Tauri IPC mocking.
 */
export const test = base.extend<{ autoMockTauri: void }>({
  autoMockTauri: [async ({ page }, use) => {
    await mockTauriIPC(page);
    await use();
  }, { auto: true }],
});

export { expect };
