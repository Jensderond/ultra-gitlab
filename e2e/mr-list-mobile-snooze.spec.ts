import { test, expect } from './fixtures/test-base';
import type { Locator } from '@playwright/test';
import { mockTauriIPC } from './fixtures/tauri-mock';
import { mergeRequests } from './fixtures/seed-data';

/**
 * Touch-device MR list: condensed rows share the 16px side edges, the snooze
 * clock button is gone (swipe-left snoozes instead), and swipe drives the
 * snooze sheet. Desktop keeps the hover-revealed button.
 */

const ROW = '.mr-list-item';

/** Dispatch a synthetic leftward touch-drag on a row, then release. */
async function touchSwipe(row: Locator, deltaX: number) {
  await row.evaluate((el, delta) => {
    const touch = (x: number) =>
      new Touch({ identifier: 1, target: el, clientX: x, clientY: 200 });
    const opts = { bubbles: true, cancelable: true };
    el.dispatchEvent(new TouchEvent('touchstart', { ...opts, touches: [touch(300)] }));
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      el.dispatchEvent(
        new TouchEvent('touchmove', { ...opts, touches: [touch(300 + (delta * i) / steps)] }),
      );
    }
    el.dispatchEvent(new TouchEvent('touchend', { ...opts, touches: [] }));
  }, deltaX);
}

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

  test('swipe left opens the snooze sheet; a preset snoozes the MR', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipe(row, -140);

    // The sheet opens only after the row finishes settling (~220ms).
    const menu = page.locator('.snooze-menu');
    await expect(menu).toBeVisible();

    await menu.locator('.snooze-menu-option', { hasText: '1 hour' }).click();

    // Snoozed rows leave Needs review and appear under the Snoozed tab.
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toHaveCount(0);
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toBeVisible();
    await expect(page.locator('.mr-snoozed-badge')).toBeVisible();
  });

  test('short swipe does not open the sheet', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipe(row, -40);

    // The sheet legitimately opens only after the ~220ms settle, so an
    // immediate absence check would pass even if the swipe wrongly armed.
    // Wait out the settle window before asserting.
    await page.waitForTimeout(400);
    await expect(page.locator('.snooze-menu')).toHaveCount(0);
  });

  test('swiping a snoozed row unsnoozes it', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipe(row, -140);
    await page.locator('.snooze-menu-option', { hasText: '1 hour' }).click();
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(snoozedRow).toBeVisible();
    await touchSwipe(snoozedRow, -140);

    // No menu for unsnooze — the row returns to Needs review directly.
    // (Menu absence is checked after the settle window; see 'short swipe'.)
    await page.waitForTimeout(400);
    await expect(page.locator('.snooze-menu')).toHaveCount(0);
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toHaveCount(0);
    await page.locator('.mr-tab', { hasText: 'Needs review' }).click();
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toBeVisible();
  });

  test('approved MRs do not respond to swipe', async ({ page }) => {
    const withApproved = mergeRequests.map((mr) =>
      mr.id === 101 ? { ...mr, userHasApproved: true } : mr,
    );
    await mockTauriIPC(page, { mergeRequests: withApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();

    await touchSwipe(row, -140);
    await page.waitForTimeout(400);
    await expect(page.locator('.snooze-menu')).toHaveCount(0);
  });

  test('condensed snoozed row shows the inline clock on touch', async ({ page }) => {
    await mockTauriIPC(page, { settings: { mrListCondensed: true } });
    await page.goto('/mrs');

    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();
    await touchSwipe(row, -140);
    await page.locator('.snooze-menu-option', { hasText: '1 hour' }).click();

    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();
    await expect(page.locator('.mr-snooze-inline')).toBeVisible();
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
