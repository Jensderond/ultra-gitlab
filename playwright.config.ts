import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Ultra GitLab.
 *
 * Tests run against the Vite dev server. `e2e/fixtures/tauri-mock.ts` injects a
 * fake `__TAURI_INTERNALS__` and mocks the Tauri `invoke()` calls with seeded data,
 * so the app runs in desktop-Tauri mode without needing a live GitLab instance.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['github'], ['blob']] : 'html',
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
