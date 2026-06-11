import { test, expect } from './fixtures/test-base';

test.describe('Pipeline detail dialog (from MR detail)', () => {
  test('opens dialog when clicking a pipeline row, MR page stays mounted', async ({ page }) => {
    await page.goto('/my-mrs/201');

    // Pipelines section renders seeded pipeline #3001
    const row = page.locator('.my-mr-pipeline-row').first();
    await expect(row).toBeVisible();
    await expect(row.locator('.my-mr-pipeline-id')).toHaveText('#3001');

    await row.click();

    // Dialog overlay is mounted with the pipeline detail view inside
    const overlay = page.locator('.pipeline-detail-dialog-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.locator('.pipeline-detail-page')).toBeVisible();
    await expect(overlay.locator('.pipeline-detail-title-group h1')).toContainText('Pipeline #3001');

    // URL did not change — MR detail page is still mounted underneath
    await expect(page).toHaveURL(/\/my-mrs\/201$/);
    await expect(page.locator('.my-mr-overview-title')).toBeVisible();
  });

  test('renders jobs grouped by stage inside the dialog', async ({ page }) => {
    await page.goto('/my-mrs/201');
    await page.locator('.my-mr-pipeline-row').first().click();

    const overlay = page.locator('.pipeline-detail-dialog-overlay');
    await expect(overlay).toBeVisible();

    // Jobs tab is the default; seeded stages ("test" + the bridge job's
    // "triggers" stage) should appear
    await expect(overlay.locator('.pipeline-stage-name')).toHaveText(['test', 'triggers']);
    await expect(overlay.getByText('lint')).toBeVisible();
    await expect(overlay.getByText('test', { exact: true }).first()).toBeVisible();
  });

  test('Escape closes the dialog and returns focus to MR detail', async ({ page }) => {
    await page.goto('/my-mrs/201');
    await page.locator('.my-mr-pipeline-row').first().click();

    const overlay = page.locator('.pipeline-detail-dialog-overlay');
    await expect(overlay).toBeVisible();

    await page.keyboard.press('Escape');

    // Overlay tears down (closing animation, then unmount). URL untouched.
    await expect(overlay).toHaveCount(0);
    await expect(page).toHaveURL(/\/my-mrs\/201$/);
    await expect(page.locator('.my-mr-overview-title')).toBeVisible();
  });

  test('clicking the backdrop closes the dialog', async ({ page }) => {
    await page.goto('/my-mrs/201');
    await page.locator('.my-mr-pipeline-row').first().click();

    const overlay = page.locator('.pipeline-detail-dialog-overlay');
    await expect(overlay).toBeVisible();

    // Click the overlay itself (not the inner dialog) at the top-left corner.
    await overlay.click({ position: { x: 5, y: 5 } });

    await expect(overlay).toHaveCount(0);
  });
});
