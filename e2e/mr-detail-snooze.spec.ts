import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';
import { mergeRequests } from './fixtures/seed-data';

/**
 * Snoozing lives on the MR detail page: a header button next to Approve, plus
 * the `z` shortcut. It used to be a per-row control on the MR list.
 */

const SNOOZE_BTN = '.mr-snooze-action-btn';

test.describe('MR detail snooze', () => {
  test('header exposes a snooze button next to approve', async ({ page }) => {
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-header');

    const button = page.locator(SNOOZE_BTN);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', 'Snooze merge request');
    // Approve stays the rightmost action.
    const actions = page.locator('.mr-detail-actions');
    await expect(actions.locator('.mr-snooze-action')).toBeVisible();
  });

  test('clicking opens the preset menu and a preset snoozes the MR', async ({ page }) => {
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-header');

    await page.locator(SNOOZE_BTN).click();
    const menu = page.locator('.snooze-menu');
    await expect(menu).toBeVisible();

    await menu.locator('.snooze-menu-option', { hasText: '1 hour' }).click();
    await expect(menu).toBeHidden();

    // The button flips to its snoozed state and offers the way back out.
    const button = page.locator(SNOOZE_BTN);
    await expect(button).toHaveClass(/mr-snooze-action-btn--active/);
    await expect(button).toHaveAttribute('aria-label', 'Unsnooze merge request');
  });

  test('z opens the preset menu', async ({ page }) => {
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-header');

    await page.keyboard.press('z');
    await expect(page.locator('.snooze-menu')).toBeVisible();
  });

  test('z on an already-snoozed MR unsnoozes without a menu', async ({ page }) => {
    await mockTauriIPC(page, {
      mergeRequests: mergeRequests.map((mr) =>
        mr.id === 101 ? { ...mr, snoozedUntil: Math.floor(Date.now() / 1000) + 86_400 } : mr,
      ),
    });
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-header');

    const button = page.locator(SNOOZE_BTN);
    await expect(button).toHaveClass(/mr-snooze-action-btn--active/);

    await page.keyboard.press('z');
    await expect(page.locator('.snooze-menu')).toHaveCount(0);
    await expect(button).not.toHaveClass(/mr-snooze-action-btn--active/);
  });

  test('merged MRs offer no snooze', async ({ page }) => {
    await mockTauriIPC(page, {
      mergeRequests: mergeRequests.map((mr) =>
        mr.id === 101 ? { ...mr, state: 'merged' } : mr,
      ),
    });
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-header');

    await expect(page.locator(SNOOZE_BTN)).toHaveCount(0);
  });

  // The header applies `backdrop-filter` for its glass effect, which makes it
  // the containing block for `position: fixed` descendants. Rendered in
  // place, the narrow-viewport bottom sheet anchored to the header's own box
  // instead of the viewport and landed mostly above the visible screen.
  test('narrow viewport: preset sheet renders inside the viewport, not above it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-header');

    await page.locator(SNOOZE_BTN).click();
    const menu = page.locator('.snooze-menu');
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  });

  // The mobile bottom-bar nav (.app-sidebar in its narrow-viewport mode) sits
  // at z-index: 100. The sheet's last preset lands at the very bottom of the
  // screen, right where the nav bar is — a lower z-index on the sheet let the
  // (opaque) nav bar cover it, so it couldn't be tapped.
  test('narrow viewport: bottom nav does not cover the last preset', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-header');

    await page.locator(SNOOZE_BTN).click();
    const lastOption = page.locator('.snooze-menu-option', { hasText: 'Next week' });
    await expect(lastOption).toBeVisible();

    // An un-forced click fails if another element (the nav bar) intercepts
    // pointer events at this location.
    await lastOption.click();
    await expect(page.locator('.snooze-menu')).toBeHidden();
    await expect(page.locator(SNOOZE_BTN)).toHaveClass(/mr-snooze-action-btn--active/);
  });
});
