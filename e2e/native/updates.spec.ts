/**
 * Native UI: the update button at the bottom of the home sidebar — blue while
 * an update downloads, green once it's ready, one click to install + relaunch.
 * Run: bunx playwright test e2e/native/updates.spec.ts --retries=0 --reporter=line
 *
 * The dev server skips automatic checks, so the flow starts from Settings →
 * "Check for updates" (the same code path the hourly check uses).
 */
import { test, expect } from './fixtures/test-base';

test.use({ viewport: { width: 1440, height: 900 } });

test('downloads in blue, installs from green', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Record<string, unknown>).__MOCK_UPDATE__ = { version: '0.26.0' };
  });
  await page.goto('/settings');
  await expect(page.getByText('Ultra GitLab 0.25.3')).toBeVisible();
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByText('Downloading 0.26.0 · 40%')).toBeVisible();

  // Back to the inbox: state survives navigation, the sidebar shows the download.
  await page.keyboard.press('Escape');
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  const downloading = sidebar.getByRole('status');
  await expect(downloading).toContainText('Downloading update…');
  await expect(downloading).toContainText('Version 0.26.0 · 40%');
  await expect(downloading).toHaveCSS('background-color', 'rgb(10, 95, 200)');
  await page.screenshot({ path: 'e2e/native/screenshots/update-downloading.png' });

  await page.evaluate(() => (window as unknown as { __MOCK_UPDATE_FINISH__: () => void }).__MOCK_UPDATE_FINISH__());
  const restart = sidebar.getByRole('button', { name: /Restart to update/ });
  await expect(restart).toContainText('Version 0.26.0');
  await expect(restart).toHaveCSS('background-color', 'rgb(30, 122, 52)');
  await page.screenshot({ path: 'e2e/native/screenshots/update-ready.png' });

  await restart.click();
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_UPDATE_INSTALLED__)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_RESTARTED__)).toBe(true);
});

test('no button when up to date', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByText("You're on the latest version.")).toBeVisible();
  await page.keyboard.press('Escape');
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole('status')).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: /Restart to update/ })).toHaveCount(0);
});

test('switch back to the classic UI', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Switch to classic UI' }).click();
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_UI_VARIANT__)).toBe('classic');
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_RESTARTED__)).toBe(true);
});
