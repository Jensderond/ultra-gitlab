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

test.describe('Pipeline detail header heights', () => {
  const PIPELINE_URL =
    '/pipelines/10/3001?instance=1&project=frontend%2Fweb-app&ref=main' +
    '&url=https%3A%2F%2Fgitlab.example.com%2Ffrontend%2Fweb-app%2F-%2Fpipelines%2F3001';

  test('desktop drill-in header matches the shared height and keeps its meta on one line', async ({ page }) => {
    await page.goto(PIPELINE_URL);
    await expect(page.locator('.page-header h1')).toHaveText('Pipeline #3001');

    const headerBox = (await page.locator('.page-header').boundingBox())!;
    expect(headerBox.height).toBe(DESKTOP_HEIGHT);

    // Back button, project path and ref all sit inside the fixed-height bar.
    for (const selector of ['.back-button-icon', '.pipeline-detail-project', '.pipeline-detail-ref']) {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(headerBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
    }
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('header matches the mobile height and drops the project/ref meta', async ({ page }) => {
      await page.goto(PIPELINE_URL);
      await expect(page.locator('.page-header h1')).toHaveText('Pipeline #3001');
      expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);

      await expect(page.locator('.page-header .pipeline-detail-project')).toBeHidden();
      await expect(page.locator('.page-header .pipeline-detail-ref')).toBeHidden();
    });
  });
});

test.describe('Job log header heights', () => {
  const JOB_LOG_URL =
    '/pipelines/10/3001/jobs/4001?instance=1&name=lint&status=success&stage=test' +
    '&duration=100&project=frontend%2Fweb-app&ref=main';

  test('desktop header matches the shared height; Follow floats over the trace', async ({ page }) => {
    await page.goto(JOB_LOG_URL);
    await expect(page.locator('.page-header h1')).toHaveText('lint');

    const headerBox = (await page.locator('.page-header').boundingBox())!;
    expect(headerBox.height).toBe(DESKTOP_HEIGHT);

    // The auto-scroll toggle lives over the log, well below the header.
    const fabBox = (await page.locator('.job-log-follow-fab').boundingBox())!;
    expect(fabBox.y).toBeGreaterThan(headerBox.y + headerBox.height);
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('header matches the mobile height and Follow stays a floating control', async ({ page }) => {
      await page.goto(JOB_LOG_URL);
      await expect(page.locator('.page-header h1')).toHaveText('lint');

      const headerBox = (await page.locator('.page-header').boundingBox())!;
      expect(headerBox.height).toBe(MOBILE_HEIGHT);

      // Stage/duration are dropped so the name and status badge get the bar.
      await expect(page.locator('.page-header .job-log-stage')).toBeHidden();
      await expect(page.locator('.page-header .job-log-duration')).toBeHidden();

      const fab = page.locator('.job-log-follow-fab');
      await expect(fab).toBeVisible();
      const fabBox = (await fab.boundingBox())!;
      expect(fabBox.y).toBeGreaterThan(headerBox.y + headerBox.height);
      // Icon-only circle on phones.
      expect(Math.round(fabBox.width)).toBe(52);
      await expect(page.locator('.job-log-follow-label')).toBeHidden();
    });
  });
});

test.describe('Settings header heights', () => {
  test('desktop rail+detail header matches the same height and shows the active section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toHaveText('GitLab Instances');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('category list header matches the mobile height', async ({ page }) => {
      await page.goto('/settings');
      await expect(page.locator('h1')).toHaveText('Settings');
      expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);
    });

    test('drill-in header matches the mobile height and the back button fits inside it', async ({ page }) => {
      await page.goto('/settings/instances');
      await expect(page.locator('h1')).toHaveText('GitLab Instances');

      const headerBox = (await page.locator('.page-header').boundingBox())!;
      expect(headerBox.height).toBe(MOBILE_HEIGHT);

      const backButton = page.locator('.back-button-icon');
      await expect(backButton).toBeVisible();
      const backBox = (await backButton.boundingBox())!;
      expect(backBox.y).toBeGreaterThanOrEqual(headerBox.y);
      expect(backBox.y + backBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
    });
  });
});
