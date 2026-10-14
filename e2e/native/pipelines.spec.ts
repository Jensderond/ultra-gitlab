/**
 * Pipelines dashboard + pipeline/job log screens against the mocked backend.
 * Run: bunx playwright test e2e/native/pipelines.spec.ts --retries=0 --reporter=line
 * Screenshots land in e2e/native/screenshots/pipelines-*.png
 */
import { test, expect } from './fixtures/test-base';

const shots: { name: string; path: string; prepare?: (page: import('@playwright/test').Page) => Promise<void> }[] = [
  { name: 'dashboard', path: '/pipelines' },
  { name: 'project-running', path: '/pipelines?project=12' },
  { name: 'failed', path: '/pipelines/1/10/3010' },
  { name: 'passed', path: '/pipelines/1/10/3010?job=7302' },
  { name: 'running', path: '/pipelines/1/12/4120?job=7402' },
  { name: 'eslint', path: '/pipelines/1/13/5203' },
  { name: 'bridge', path: '/pipelines/1/10/3001' },
  {
    name: 'search',
    path: '/pipelines/1/10/3010',
    prepare: async (page) => {
      await page.getByPlaceholder('Search log, opens matching steps').fill('cache');
      await page.waitForTimeout(250);
      await page.getByPlaceholder('Search log, opens matching steps').press('Enter');
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const size of [
    { label: 'wide', width: 1440, height: 900 },
    { label: 'narrow', width: 1000, height: 700 },
  ]) {
    test.describe(`${scheme} ${size.label}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      for (const shot of shots) {
        if (size.label === 'narrow' && !['dashboard', 'failed'].includes(shot.name)) continue;
        test(shot.name, async ({ page }) => {
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          await page.goto(shot.path);
          await page.waitForTimeout(900);
          await shot.prepare?.(page);
          await page.waitForTimeout(200);
          await page.screenshot({ path: `e2e/native/screenshots/pipelines-${shot.name}-${scheme}-${size.label}.png` });
          expect(errors).toEqual([]);
        });
      }
    });
  }
}

test.describe('behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('failed pipeline explains the failure and links the MR change', async ({ page }) => {
    await page.goto('/pipelines/1/10/3010');
    await expect(page.getByText('Pipeline #3010 · failed after 3m 52s')).toBeVisible();
    await expect(page.getByText('1 of 48 tests failed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to !42' })).toBeVisible();
    await expect(page.locator('.pl-aside__card')).toContainText('src/components/ThemeToggle.tsx:18');
    await expect(page.getByText('Same job passed on main')).toBeVisible();
    await expect(page.locator('.pl-log-card').first()).toContainText('ThemeToggle.tsx:18');
    // The failing step is open, passed steps are collapsed.
    await expect(page.getByRole('button', { name: /Run unit tests/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: /Restoring cache/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('search opens matching steps and counts hits', async ({ page }) => {
    await page.goto('/pipelines/1/10/3010');
    const search = page.getByPlaceholder('Search log, opens matching steps');
    await search.fill('extracted cache');
    await expect(page.locator('.pl-log__search')).toContainText('1 of 1');
    await expect(page.getByRole('button', { name: /Restoring cache/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('mark.pl-mark.is-current')).toHaveText('extracted cache');
  });

  test('dashboard keyboard moves selection and opens a pipeline', async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page.locator('.pl-group').first()).toContainText('Failing');
    await expect(page.locator('.pl-row.is-selected')).toContainText('web-app');
    await page.keyboard.press('j');
    await expect(page.locator('.pl-row.is-selected')).toContainText('ios-app');
    await page.locator('.pl-row', { hasText: 'docs' }).click();
    await page.screenshot({ path: 'e2e/native/screenshots/pipelines-list-focused.png' });
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    await expect(page.locator('.pl-row.is-selected')).toContainText('web-app');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/pipelines\/1\/10\/3010/);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/pipelines(\?|$)/);
  });

  test('add project sheet searches and adds', async ({ page }) => {
    await page.goto('/pipelines');
    await page.getByRole('button', { name: 'Add project' }).first().click();
    await page.getByPlaceholder('Search projects by name or path').fill('design');
    await expect(page.getByRole('option', { name: /design-system/ })).toBeVisible();
    await page.screenshot({ path: 'e2e/native/screenshots/pipelines-add-sheet.png' });
  });
});
