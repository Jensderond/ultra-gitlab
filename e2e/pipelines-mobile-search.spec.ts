import { test, expect } from './fixtures/test-base';

/**
 * Pipelines search chrome differs by viewport.
 *
 * Desktop keeps the persistent inline search bar. Mobile (< 768px) hides it
 * behind a bottom-right floating button that opens a full-screen overlay with
 * an auto-focused input; selecting a result or tapping close dismisses it.
 */

const FAB = '.pipelines-search-fab';
const OVERLAY = '.pipelines-search-overlay';
const OVERLAY_INPUT = `${OVERLAY} .pipelines-search-input`;
const INLINE_INPUT = '.pipelines-search-container .pipelines-search-input';

test.describe('Desktop keeps the inline search bar', () => {
  test('inline input is present and no floating button renders', async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page.locator('.pipeline-card').first()).toBeVisible();

    await expect(page.locator(INLINE_INPUT)).toBeVisible();
    await expect(page.locator(FAB)).not.toBeAttached();
  });
});

test.describe('Mobile floating search button + overlay', () => {
  test.use({ viewport: { width: 390, height: 664 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page.locator('.pipeline-card').first()).toBeVisible();
  });

  test('shows the floating button and hides the inline bar', async ({ page }) => {
    await expect(page.locator(FAB)).toBeVisible();
    await expect(page.locator(INLINE_INPUT)).not.toBeAttached();
  });

  test('tapping the button opens the overlay with the input focused', async ({ page }) => {
    await page.locator(FAB).click();
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(OVERLAY_INPUT)).toBeFocused();
  });

  test('typing shows results and selecting one closes the overlay', async ({ page }) => {
    await page.locator(FAB).click();
    await page.locator(OVERLAY_INPUT).fill('design');

    const result = page.locator(`${OVERLAY} .pipelines-search-result`).first();
    await expect(result).toBeVisible();
    await expect(result).toContainText('design-system');

    await result.click();
    await expect(page.locator(OVERLAY)).not.toBeAttached();
    await expect(page.locator(FAB)).toBeVisible();
  });

  test('the close button dismisses the overlay', async ({ page }) => {
    await page.locator(FAB).click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    await page.locator('button[aria-label="Close search"]').click();
    await expect(page.locator(OVERLAY)).not.toBeAttached();
    await expect(page.locator(FAB)).toBeVisible();
  });
});
