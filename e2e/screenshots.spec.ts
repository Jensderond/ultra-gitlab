/**
 * Screenshot generator for README.
 *
 * Takes screenshots of key app views using seeded mock data.
 * Run with: bunx playwright test e2e/screenshots.spec.ts
 *
 * Screenshots are saved to e2e/screenshots/
 */

import { test } from './fixtures/test-base';

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

const screenshotDir = 'e2e/screenshots';

/** Hide the TanStack React Query devtools button */
async function hideDevtools(page: import('@playwright/test').Page) {
  await page.addStyleTag({ content: '.tsqd-open-btn-container { display: none !important; }' });
}

test.describe('README Screenshots', () => {
  test('MR list', async ({ page }) => {
    await page.goto('/mrs');
    await page.waitForSelector('.mr-list-item');
    await hideDevtools(page);
    await page.screenshot({ path: `${screenshotDir}/mr-list.png`, fullPage: false });
  });

  test('MR detail with diff', async ({ page }) => {
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-sidebar');
    await page.waitForTimeout(500);
    await hideDevtools(page);
    await page.screenshot({ path: `${screenshotDir}/mr-detail.png`, fullPage: false });
  });

  test('MR detail with activity drawer', async ({ page }) => {
    await page.goto('/mrs/101');
    await page.waitForSelector('.mr-detail-sidebar');
    await page.keyboard.press('Meta+d');
    await page.waitForSelector('.activity-drawer');
    await page.waitForTimeout(300);
    await hideDevtools(page);
    await page.screenshot({ path: `${screenshotDir}/mr-detail-activity.png`, fullPage: false });
  });

  test('My MRs', async ({ page }) => {
    await page.goto('/my-mrs');
    await page.waitForSelector('.mr-list-item');
    await hideDevtools(page);
    await page.screenshot({ path: `${screenshotDir}/my-mrs.png`, fullPage: false });
  });

  test('Pipelines', async ({ page }) => {
    await page.goto('/pipelines');
    await page.waitForTimeout(500);
    await hideDevtools(page);
    await page.screenshot({ path: `${screenshotDir}/pipelines.png`, fullPage: false });
  });
});
