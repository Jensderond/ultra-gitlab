import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Ultra GitLab.
 *
 * Tests run against the Vite dev server. Since Playwright runs in a real browser
 * (no `__TAURI_INTERNALS__`), the app falls back to companion HTTP mode.
 * Tests use route interception to mock the `/api/*` responses with seeded data.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html']] : 'html',
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
