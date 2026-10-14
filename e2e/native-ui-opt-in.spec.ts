/**
 * Classic UI: opting in to the native UI beta from Settings stores the choice
 * and relaunches (the native UI's own tests live in e2e/native/).
 */
import { test, expect } from './fixtures/test-base';

test('Settings → Native UI (beta) switches and relaunches', async ({ page }) => {
  await page.goto('/settings/native-ui');
  await page.getByRole('button', { name: 'Switch to native UI' }).click();
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_UI_VARIANT__)).toBe('native');
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_RESTARTED__)).toBe(true);
});
