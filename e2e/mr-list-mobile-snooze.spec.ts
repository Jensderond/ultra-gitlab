import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';

/**
 * Touch-device MR list: condensed rows share the 16px side edges, the snooze
 * clock button is gone (swipe-left snoozes instead), and swipe drives the
 * snooze sheet. Desktop keeps the hover-revealed button.
 */

const ROW = '.mr-list-item';

test.describe('Touch MR list snooze', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test('condensed rows align to the 16px touch side padding', async ({ page }) => {
    // Re-register the mock with condensed mode on; the later init script wins.
    await mockTauriIPC(page, { settings: { mrListCondensed: true } });
    await page.goto('/mrs');

    const row = page.locator(ROW).first();
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/mr-list-item--condensed/);

    const padding = await row.evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('8px 16px');
  });

  test('snooze button is hidden on touch', async ({ page }) => {
    await expect(page.locator('.mr-snooze-button').first()).toBeHidden();
  });
});

test.describe('Desktop MR list keeps the snooze button', () => {
  test('button exists and is not display:none', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();

    const button = page.locator('.mr-snooze-button').first();
    await expect(button).toBeAttached();
    // Hidden-until-hover uses opacity on desktop, never display.
    expect(await button.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
  });
});
