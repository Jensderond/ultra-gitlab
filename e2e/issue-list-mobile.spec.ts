import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';
import type { Locator } from '@playwright/test';

/**
 * Touch-device issue list: the leading star-button column is gone (swipe-left
 * stars a row instead), rows are tighter, and starred state shows inline.
 * Desktop keeps the tappable star column.
 */

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

const ROW = '.issue-list-item';

test.describe('Touch issue list layout', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/issues');
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test('star column is hidden and rows are tighter', async ({ page }) => {
    // Guard: touch emulation must flip the hover MQ, or none of the layout
    // under test is active and every assertion below would be meaningless.
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);

    await expect(page.locator('.issue-star-button').first()).toBeHidden();

    const padding = await page
      .locator(ROW)
      .first()
      .evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('10px 16px');
  });

  test('MR list rows share the tightened touch padding', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-item').first()).toBeVisible();

    const padding = await page
      .locator('.mr-list-item')
      .first()
      .evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('10px 16px');
  });

  test('condensed MR rows keep their vertical density on touch', async ({ page }) => {
    // Re-register the mock with condensed mode on; the later init script wins.
    await mockTauriIPC(page, { settings: { mrListCondensed: true } });
    await page.goto('/mrs');

    const row = page.locator('.mr-list-item').first();
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/mr-list-item--condensed/);

    // 8px keeps the condensed rhythm; the 16px edges match the regular rows.
    const padding = await row.evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('8px 16px');
  });

  test('starred issue shows an inline star in the header', async ({ page }) => {
    const starredRow = page.locator(ROW).filter({ hasText: 'Dark mode flashes' });
    await expect(starredRow.locator('.issue-star-inline')).toBeVisible();

    const plainRow = page.locator(ROW).filter({ hasText: 'Login button misaligned' });
    await expect(plainRow.locator('.issue-star-inline')).toHaveCount(0);
  });

  test('swipe left past the threshold stars the issue', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Login button misaligned' });
    await expect(row.locator('.issue-star-inline')).toHaveCount(0);

    await touchSwipe(row, -140);
    await expect(row.locator('.issue-star-inline')).toBeVisible();
  });

  test('short swipe leaves the issue unstarred', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Login button misaligned' });
    await touchSwipe(row, -40);

    await expect(row.locator('.issue-star-inline')).toHaveCount(0);
  });

  test('swiping a starred issue unstars it', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Dark mode flashes' });
    await expect(row.locator('.issue-star-inline')).toBeVisible();

    await touchSwipe(row, -140);
    await expect(row.locator('.issue-star-inline')).toHaveCount(0);
  });

  test('swipe does not open the issue detail', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Login button misaligned' });

    // Synthetic TouchEvents never produce a browser click on their own, so
    // this test would pass even if IssueListItem's click guard were deleted.
    // Dispatch a click explicitly, inside the settle window, to exercise it.
    // The swipe and the click are dispatched in a single evaluate call so no
    // Node roundtrip sits between touchend and the click — on a slow runner
    // that gap could otherwise let the 220ms settle window lapse before the
    // click fires, producing a flaky pass. A single macrotask tick (still
    // entirely inside this one evaluate call) is left between touchend and
    // the click so React's batched `dragging`/`settling` state update from
    // the touch handler actually flushes first — dispatching the click in
    // the same synchronous stack as touchend would let the click handler
    // read stale pre-swipe state and navigate for real.
    await row.evaluate(async (el, delta) => {
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
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, -140);

    await expect(row.locator('.issue-star-inline')).toBeVisible();
    await expect(page).toHaveURL(/\/issues$/);
  });
});

test.describe('Desktop issue list keeps the star column', () => {
  test('star button visible, padding only slightly trimmed', async ({ page }) => {
    await page.goto('/issues');
    await expect(page.locator(ROW).first()).toBeVisible();

    await expect(page.locator('.issue-star-button').first()).toBeVisible();

    const padding = await page
      .locator(ROW)
      .first()
      .evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('12px 32px');
  });

  test('inline star stays hidden on hover-capable devices', async ({ page }) => {
    await page.goto('/issues');
    await expect(page.locator(ROW).first()).toBeVisible();

    const inline = page.locator('.issue-star-inline');
    await expect(inline).toBeAttached(); // rendered for the starred seed issue…
    await expect(inline).toBeHidden(); // …but display: none at desktop
  });
});
