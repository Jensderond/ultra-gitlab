import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';

test.describe('Product tour', () => {
  test('auto-starts on first run and walks through every step', async ({ page }) => {
    // Re-register the mock with the flag unset; the later init script wins.
    await mockTauriIPC(page, { settings: { hasSeenProductTour: false } });
    await page.goto('/mrs');

    const popover = page.locator('.driver-popover.ultra-tour-popover');
    const nextBtn = popover.locator('.driver-popover-next-btn');

    // Step 1: welcome modal
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Welcome to Ultra GitLab');

    // Step 2: sidebar nav
    await nextBtn.click();
    await expect(popover).toContainText('Navigate');

    // Step 3: MR list
    await nextBtn.click();
    await expect(popover).toContainText('Your review queue');

    // Step 4: refresh/sync
    await nextBtn.click();
    await expect(popover).toContainText('Stay in sync');

    // Step 5: shortcut bar / keyboard shortcuts notice
    await nextBtn.click();
    await expect(popover).toContainText('Keyboard first');

    // Step 6: route change to Pipelines, with pinning tip
    await nextBtn.click();
    await expect(page).toHaveURL(/\/pipelines/);
    await expect(popover).toContainText('Pin your own projects');

    // Step 7: route change to Settings
    await nextBtn.click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(popover).toContainText('Instances');

    // Step 8: outro modal, then finish
    await nextBtn.click();
    await expect(popover).toContainText("That's it");
    await nextBtn.click();
    await expect(popover).toHaveCount(0);
  });

  test('back button navigates across the route-change steps', async ({ page }) => {
    await mockTauriIPC(page, { settings: { hasSeenProductTour: false } });
    await page.goto('/mrs');

    const popover = page.locator('.driver-popover.ultra-tour-popover');
    const nextBtn = popover.locator('.driver-popover-next-btn');
    const prevBtn = popover.locator('.driver-popover-prev-btn');

    // Walk forward to the Settings step.
    await expect(popover).toContainText('Welcome to Ultra GitLab');
    for (let i = 0; i < 6; i++) await nextBtn.click();
    await expect(popover).toContainText('Instances');

    // Back to Pipelines, then back to the MR list's shortcut bar.
    await prevBtn.click();
    await expect(page).toHaveURL(/\/pipelines/);
    await expect(popover).toContainText('Pin your own projects');

    await prevBtn.click();
    await expect(page).toHaveURL(/\/mrs/);
    await expect(popover).toContainText('Keyboard first');
  });

  test('does not auto-start when the tour was already seen', async ({ page }) => {
    await page.goto('/mrs');

    await expect(page.locator('.mr-list-content')).toBeVisible();
    await expect(page.locator('.driver-popover')).toHaveCount(0);
  });

  test('can be replayed from Settings', async ({ page }) => {
    await page.goto('/settings/appearance');
    await page.getByRole('button', { name: 'Replay product tour' }).click();

    // Replay navigates back to /mrs and starts from the welcome step.
    await expect(page).toHaveURL(/\/mrs/);
    const popover = page.locator('.driver-popover.ultra-tour-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Welcome to Ultra GitLab');
  });
});
