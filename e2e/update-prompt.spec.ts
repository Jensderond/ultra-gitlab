/**
 * Classic UI: the popup over the app when a new version is available.
 * "Update now" downloads, installs and relaunches; "Later" hides it for an hour.
 * Run: bunx playwright test e2e/update-prompt.spec.ts --retries=0 --reporter=line
 */
import { test, expect } from './fixtures/test-base';

const withUpdate = () => {
  (window as Record<string, unknown>).__MOCK_UPDATE__ = { version: '0.26.0' };
};

test('offers the update and installs it', async ({ page }) => {
  await page.addInitScript(withUpdate);
  await page.goto('/mrs');

  const prompt = page.getByRole('dialog', { name: 'Update available' });
  await expect(prompt).toContainText('Ultra GitLab 0.26.0 is ready to download.');
  await expect(prompt).toContainText('Faster sync.');
  await expect(prompt.getByRole('button', { name: 'Update now' })).toBeFocused();

  await prompt.getByRole('button', { name: 'Update now' }).click();
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_UPDATE_INSTALLED__)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as Record<string, unknown>).__MOCK_RESTARTED__)).toBe(true);
});

test('"Later" hides it for an hour', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(withUpdate);
  await page.goto('/mrs');

  const prompt = page.getByRole('dialog', { name: 'Update available' });
  await prompt.getByRole('button', { name: 'Later' }).click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByText('feat: Add dark mode toggle to settings')).toBeVisible();

  await page.clock.fastForward('59:00');
  await expect(prompt).toHaveCount(0);
  await page.clock.fastForward('01:00');
  await expect(prompt).toBeVisible();

  // Escape is "Later" too.
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
});

test('no popup when up to date', async ({ page }) => {
  await page.goto('/mrs');
  await expect(page.getByText('feat: Add dark mode toggle to settings')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
