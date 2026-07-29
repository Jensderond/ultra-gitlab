import { test, expect } from './fixtures/test-base';
import type { Locator } from '@playwright/test';
import { mockTauriIPC } from './fixtures/tauri-mock';
import { mergeRequests } from './fixtures/seed-data';

/**
 * Touch-device MR list: condensed rows share the 16px side edges and swipe-left
 * drives the snooze sheet.
 *
 * There is no per-row snooze button on any device — snoozing is an MR detail
 * page action (see mr-detail-snooze.spec.ts). Swipe-left is the only list-level
 * affordance, and it is touch-only.
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

/**
 * Drag leftward and hold — no touchend, so the row stays mid-gesture. Returns
 * with the finger still down; call `touchRelease` to finish. Splitting the
 * dispatch from the assertion matters: React batches the state updates from a
 * single evaluate, so mid-drag styles are only observable after a round-trip.
 */
async function touchSwipeHold(row: Locator, deltaX: number) {
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
  }, deltaX);
}

async function touchRelease(row: Locator) {
  await row.evaluate((el) => {
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
  });
}

/** Uniform scale factor (matrix m11) from an element's computed transform. */
async function scaleOf(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const t = getComputedStyle(node).transform;
    if (t === 'none') return 1;
    return new DOMMatrixReadOnly(t).a;
  });
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

  test('no row renders a snooze button', async ({ page }) => {
    await expect(page.locator('.mr-snooze-button')).toHaveCount(0);
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

  // The bottom nav bar (.app-sidebar in its mobile bottom-bar mode) sits at
  // the same screen edge as the sheet's last preset. A lower z-index on the
  // sheet let the (opaque) nav bar cover that preset so it couldn't be tapped.
  test('bottom nav does not cover the last preset', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipe(row, -140);

    const lastOption = page.locator('.snooze-menu-option', { hasText: 'Next week' });
    await expect(lastOption).toBeVisible();

    // An un-forced click fails if another element (the nav bar) intercepts
    // pointer events at this location.
    await lastOption.click();
    await expect(page.locator('.snooze-menu')).toBeHidden();
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toHaveCount(0);
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

  // Feedback for the threshold crossing. The haptic that fires alongside this
  // is iOS-native and unobservable here (and absent in the Simulator too) —
  // only the scale animation is testable.
  test('action icon grows with the drag, then pops past the threshold', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    const action = page.locator('.swipe-row-action');
    const track = page.locator('.swipe-row-action-icon');
    const pop = page.locator('.swipe-row-action-icon-pop');

    // Below the 72px threshold: partially grown, not yet armed.
    await touchSwipeHold(row, -40);
    await expect(action).toBeVisible();
    await expect(action).not.toHaveClass(/is-armed/);

    const progress = await action.evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue('--swipe-progress')),
    );
    expect(progress).toBeGreaterThan(0.4);
    expect(progress).toBeLessThan(1);

    const midScale = await scaleOf(track);
    expect(midScale).toBeGreaterThan(0.6);
    expect(midScale).toBeLessThan(1);
    // Unarmed: the pop layer contributes nothing yet.
    expect(await scaleOf(pop)).toBeCloseTo(1, 2);

    await touchRelease(row);
    await page.waitForTimeout(400);

    // Past the threshold: progress saturates and the pop layer overshoots.
    await touchSwipeHold(row, -100);
    await expect(action).toHaveClass(/is-armed/);
    expect(
      await action.evaluate((el) =>
        parseFloat(getComputedStyle(el).getPropertyValue('--swipe-progress')),
      ),
    ).toBeCloseTo(1, 5);
    expect(await scaleOf(track)).toBeCloseTo(1, 2);

    // Wait out the 260ms spring before reading its resting value.
    await page.waitForTimeout(400);
    expect(await scaleOf(pop)).toBeCloseTo(1.18, 2);

    await touchRelease(row);
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

test.describe('Desktop MR list has no snooze control', () => {
  test('rows render neither a snooze button nor a control host', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();

    await expect(page.locator('.mr-snooze-button')).toHaveCount(0);
    // The menu host only exists while the swipe sheet is open, which needs touch.
    await expect(page.locator('.mr-snooze-control')).toHaveCount(0);
  });

  test('hovering a row reveals no trailing control', async ({ page }) => {
    await page.goto('/mrs');
    const row = page.locator(ROW).first();
    await row.hover();
    await expect(page.locator('.mr-snooze-button')).toHaveCount(0);
  });

  test('condensed snoozed row shows the inline clock on desktop too', async ({ page }) => {
    await mockTauriIPC(page, {
      settings: { mrListCondensed: true },
      mergeRequests: mergeRequests.map((mr) =>
        // Well past any preset, so the row is unambiguously snoozed.
        mr.id === 101 ? { ...mr, snoozedUntil: Math.floor(Date.now() / 1000) + 86_400 } : mr,
      ),
    });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();
    // Previously the clock only appeared under (hover: none); with the button
    // gone it is the only snoozed marker in a condensed row on every device.
    await expect(row.locator('.mr-snooze-inline')).toBeVisible();
  });
});
