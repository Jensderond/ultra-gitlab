import { test, expect } from './fixtures/test-base';

/**
 * Touch-device issue list: the leading star-button column is gone (swipe-left
 * stars a row instead), rows are tighter, and starred state shows inline.
 * Desktop keeps the tappable star column.
 */

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
});
