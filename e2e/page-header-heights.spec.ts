import { test, expect } from './fixtures/test-base';

/**
 * MR List, My MRs, Pipelines and Issues all render the same <PageHeader>
 * component. Its height must be a fixed constant per breakpoint —
 * 60px desktop, 56px mobile (<768px) — regardless of which action buttons
 * a given page happens to mount.
 */

const DESKTOP_HEIGHT = 60;
const MOBILE_HEIGHT = 56;

test.describe('Page header heights — desktop', () => {
  test('MR List, My MRs, Pipelines and Issues headers are all the same height', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('h1')).toHaveText('Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);

    await page.goto('/my-mrs');
    await expect(page.locator('h1')).toHaveText('My Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);

    await page.goto('/pipelines');
    await expect(page.locator('h1')).toHaveText('Pipelines');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);

    await page.goto('/issues');
    await expect(page.locator('h1')).toHaveText('Issues');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);
  });
});

test.describe('Page header heights — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('MR List, My MRs, Pipelines and Issues headers are all the same height', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('h1')).toHaveText('Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);

    await page.goto('/my-mrs');
    await expect(page.locator('h1')).toHaveText('My Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);

    await page.goto('/pipelines');
    await expect(page.locator('h1')).toHaveText('Pipelines');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);

    await page.goto('/issues');
    await expect(page.locator('h1')).toHaveText('Issues');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);
  });
});
