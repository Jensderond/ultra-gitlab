import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';
import { issues as seedIssues } from './fixtures/seed-data';
import type { Page } from '@playwright/test';

/**
 * Pull-to-refresh on the issues list must only arm at the top of the scroll,
 * the same way it does on the MR list. The gesture hook gates on the
 * `scrollTop` of the element it is bound to, so if that element isn't the one
 * that actually scrolls, `scrollTop` stays 0 forever and every upward drag —
 * including a plain scroll-back-to-the-top — starts a refresh instead.
 */

/** Enough rows that the list is comfortably taller than a phone viewport. */
const manyIssues = Array.from({ length: 30 }, (_, i) => ({
  ...seedIssues[0],
  id: 9100 + i,
  iid: 100 + i,
  title: `Scrollable filler issue ${i + 1}`,
  starred: false,
}));

/**
 * Dispatch a downward touch-drag and leave the finger down, so the pull state
 * can be inspected mid-gesture (touchend would reset it before we could look).
 */
async function touchDragDown(page: Page, deltaY: number) {
  await page.locator('.issue-list-item').first().evaluate((el, delta) => {
    const touch = (y: number) =>
      new Touch({ identifier: 1, target: el, clientX: 200, clientY: y });
    const opts = { bubbles: true, cancelable: true };
    el.dispatchEvent(new TouchEvent('touchstart', { ...opts, touches: [touch(300)] }));
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      el.dispatchEvent(
        new TouchEvent('touchmove', { ...opts, touches: [touch(300 + (delta * i) / steps)] }),
      );
    }
  }, deltaY);
}

async function endTouch(page: Page) {
  await page.locator('.issue-list-item').first().evaluate((el) => {
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
  });
}

test.describe('Issues pull-to-refresh', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await mockTauriIPC(page, { issues: manyIssues });
    await page.goto('/issues');
    await expect(page.locator('.issue-list-item').first()).toBeVisible();
  });

  test('dragging down while scrolled does not start a refresh', async ({ page }) => {
    // Scroll away from the top — whichever element owns the scroll.
    await page.locator('.issue-list-item').last().scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Math.max(
            document.querySelector('.issues-main')?.scrollTop ?? 0,
            document.querySelector('.issues-list')?.scrollTop ?? 0,
          ),
        ),
      )
      .toBeGreaterThan(0);

    await touchDragDown(page, 160);
    await expect(page.locator('.pull-refresh-indicator')).toHaveCount(0);
    await endTouch(page);
  });

  test('dragging down from the top does start a pull', async ({ page }) => {
    await touchDragDown(page, 160);
    await expect(page.locator('.pull-refresh-indicator')).toBeVisible();
    await endTouch(page);
  });
});
