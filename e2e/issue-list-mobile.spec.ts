import { test, expect } from './fixtures/test-base';
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
    await touchSwipe(row, -140);

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
