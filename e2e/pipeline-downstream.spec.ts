import { test, expect } from './fixtures/test-base';

// Pipeline #3001 (project 10) has a bridge job "Docs" that triggered
// downstream pipeline #3002 in project 11 (see fixtures/seed-data.ts).
const PARENT_URL =
  '/pipelines/10/3001?instance=1&project=frontend%2Fweb-app&ref=main' +
  '&url=https%3A%2F%2Fgitlab.example.com%2Ffrontend%2Fweb-app%2F-%2Fpipelines%2F3001';

test.describe('Downstream pipelines (bridge/trigger jobs)', () => {
  test('bridge job renders with trigger badge and downstream status', async ({ page }) => {
    await page.goto(PARENT_URL);

    const bridgeRow = page.locator('.pipeline-job-row', { hasText: 'Docs' });
    await expect(bridgeRow).toBeVisible();
    await expect(bridgeRow.locator('.pipeline-job-trigger-badge')).toHaveText('trigger');
    await expect(bridgeRow.locator('.pipeline-job-downstream')).toContainText('#3002');

    // The trigger stage from the bridge job shows up in the stages bar.
    await expect(page.locator('.pipeline-stage-chip', { hasText: 'triggers' })).toBeVisible();
  });

  test('clicking a bridge job drills into the downstream pipeline and back', async ({ page }) => {
    await page.goto(PARENT_URL);

    await page
      .locator('.pipeline-job-row', { hasText: 'Docs' })
      .locator('.pipeline-job-info--clickable')
      .click();

    // Navigated to the downstream pipeline in its own project.
    await expect(page).toHaveURL(/\/pipelines\/11\/3002\?/);
    await expect(page.locator('.pipeline-detail-title-group h1')).toContainText('Pipeline #3002');
    await expect(page.getByText('build-docs')).toBeVisible();

    // Escape returns to the parent pipeline, not the dashboard.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/pipelines\/10\/3001\?/);
    await expect(page.getByText('Docs')).toBeVisible();
  });

  test('bridge click inside the MR pipeline dialog swaps to the downstream pipeline', async ({ page }) => {
    await page.goto('/my-mrs/201');
    await page.locator('.my-mr-pipeline-row').first().click();

    const overlay = page.locator('.pipeline-detail-dialog-overlay');
    await expect(overlay).toBeVisible();

    await overlay
      .locator('.pipeline-job-row', { hasText: 'Docs' })
      .locator('.pipeline-job-info--clickable')
      .click();

    // Dialog stays open, now showing the downstream pipeline's jobs.
    await expect(overlay.locator('.pipeline-detail-title-group h1')).toContainText('Pipeline #3002');
    await expect(overlay.getByText('build-docs')).toBeVisible();
    await expect(page).toHaveURL(/\/my-mrs\/201$/);
  });
});
