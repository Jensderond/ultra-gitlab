import { test, expect } from './fixtures/test-base';

// Pipeline #3001 (project 10) — same seed data as pipeline-downstream.spec.ts.
const PARENT_URL =
  '/pipelines/10/3001?instance=1&project=frontend%2Fweb-app&ref=main' +
  '&url=https%3A%2F%2Fgitlab.example.com%2Ffrontend%2Fweb-app%2F-%2Fpipelines%2F3001';

test.describe('Auto-run manual jobs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PARENT_URL);
  });

  test('manual job shows Auto button; completed jobs do not', async ({ page }) => {
    const manualRow = page.locator('.pipeline-job-row', { hasText: 'Deploy production' });
    await expect(manualRow.locator('.pipeline-job-action-btn--auto')).toBeVisible();
    await expect(manualRow.locator('.pipeline-job-action-btn--auto')).toHaveText(/Auto/);

    const successRow = page.locator('.pipeline-job-row', { hasText: 'lint' });
    await expect(successRow.locator('.pipeline-job-action-btn--auto')).toHaveCount(0);
  });

  test('clicking Auto arms the job and clicking again disarms it', async ({ page }) => {
    const manualRow = page.locator('.pipeline-job-row', { hasText: 'Deploy production' });
    const autoBtn = manualRow.locator('.pipeline-job-action-btn--auto');

    await autoBtn.click();
    await expect(autoBtn).toHaveText(/Armed/);
    await expect(autoBtn).toHaveClass(/pipeline-job-action-btn--auto-armed/);
    await expect(autoBtn).toHaveAttribute('aria-pressed', 'true');

    await autoBtn.click();
    await expect(autoBtn).toHaveText(/Auto/);
    await expect(autoBtn).not.toHaveClass(/pipeline-job-action-btn--auto-armed/);
    await expect(autoBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
