/**
 * Review inbox: every view, the preview in reviewer and author mode, light and
 * dark, wide and narrow. Run:
 *   bunx playwright test e2e/native/inbox.spec.ts --retries=0 --reporter=line
 */
import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';

const shots: [string, string][] = [
  ['review', '/inbox/review'],
  ['selected-failed', '/inbox/review?mr=101'],
  ['running', '/inbox/review?mr=105'],
  ['large', '/inbox/review?mr=106'],
  ['mine', '/inbox/mine?mr=201'],
  ['returned', '/inbox/returned'],
  ['ready', '/inbox/ready'],
  ['snoozed', '/inbox/snoozed'],
  ['approved', '/inbox/approved'],
  ['client', '/inbox/review?client=backend'],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    for (const [name, path] of shots) {
      if (scheme === 'dark' && !['review', 'selected-failed', 'mine'].includes(name)) continue;
      test(name, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(path);
        await expect(page.locator('.inbox-row').first()).toBeVisible();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `e2e/native/screenshots/inbox-${name}-${scheme}.png` });
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe('narrow', () => {
  test.use({ viewport: { width: 1000, height: 700 } });
  for (const [name, path] of [
    ['review', '/inbox/review?mr=101'],
    ['mine', '/inbox/mine?mr=203'],
  ]) {
    test(name, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('.inbox-row').first()).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `e2e/native/screenshots/inbox-narrow-${name}.png` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
    });
  }
});

test.describe('behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('auto-selects the first row and moves with J/K', async ({ page }) => {
    await page.goto('/inbox/review');
    await expect(page).toHaveURL(/mr=\d+/);
    const first = new URL(page.url()).searchParams.get('mr');
    await page.keyboard.press('j');
    await expect(page).not.toHaveURL(new RegExp(`mr=${first}(&|$)`));
    await page.keyboard.press('k');
    await expect(page).toHaveURL(new RegExp(`mr=${first}(&|$)`));
    await expect(page.locator('.inbox-row.is-selected')).toHaveCount(1);
  });

  test('review view hides my approved and snoozed MRs', async ({ page }) => {
    await page.goto('/inbox/review');
    await expect(page.locator('.inbox-row').first()).toBeVisible();
    await expect(page.locator('#inbox-row-109')).toHaveCount(0); // approved by me
    await expect(page.locator('#inbox-row-108')).toHaveCount(0); // snoozed
    await expect(page.locator('#inbox-row-105')).toHaveCount(1);
  });

  test('client filter from the sidebar', async ({ page }) => {
    await page.goto('/inbox/review');
    await page.getByRole('button', { name: /^Backend/ }).click();
    await expect(page).toHaveURL(/client=backend/);
    await expect(page.locator('#inbox-row-101')).toHaveCount(0);
    await expect(page.locator('#inbox-row-105')).toHaveCount(1);
  });

  test('my merged MRs sit in their own group', async ({ page }) => {
    // Recently merged MRs only show when Settings › General has them switched on.
    await mockTauriIPC(page, { settings: { showRecentlyMergedMrs: true } });
    await page.goto('/inbox/mine');
    await expect(page.locator('.inbox-group__head.is-merged')).toContainText('Merged recently');
    await expect(page.locator('#inbox-row-204')).toHaveCount(1);
  });

  test('approve with ⌘⇧A moves on to the next MR', async ({ page }) => {
    await page.goto('/inbox/review?mr=105');
    await expect(page.locator('#inbox-row-105')).toHaveClass(/is-selected/);
    await page.keyboard.press('ControlOrMeta+Shift+A');
    await expect(page.locator('#inbox-row-105')).toHaveCount(0);
    await expect(page).not.toHaveURL(/mr=105/);
    await expect(page.locator('.inbox-row.is-selected')).toHaveCount(1);
    await expect(page.getByText('Approved !88')).toBeVisible();
  });

  test('Esc clears the selection', async ({ page }) => {
    await page.goto('/inbox/review?mr=105');
    await expect(page.locator('#inbox-row-105')).toHaveClass(/is-selected/);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/mr=/);
    await expect(page.locator('.inbox-row.is-selected')).toHaveCount(0);
    await expect(page.getByText('No merge request selected')).toBeVisible();
  });

  test('merge asks for confirmation', async ({ page }) => {
    await page.goto('/inbox/ready?mr=201');
    const merge = page.locator('.inbox-actions').getByRole('button', { name: /^Merge/ }).first();
    await expect(merge).toBeEnabled();
    await merge.click();
    await expect(page.getByRole('dialog')).toContainText('Merge !50?');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'e2e/native/screenshots/inbox-merge-sheet.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('sidebar on the pipelines dashboard', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('keeps working for section=pipelines', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/pipelines?filter=failing');
    await expect(page.locator('nav').getByRole('button', { name: /Failing/ })).toHaveAttribute('aria-current', 'page');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/native/screenshots/inbox-sidebar-pipelines.png' });
    await page.getByRole('button', { name: /^Needs my review/ }).click();
    await expect(page).toHaveURL(/\/inbox\/review/);
    expect(errors).toEqual([]);
  });
});

test('recently merged MRs stay hidden when the setting is off', async ({ page }) => {
  await page.goto('/inbox/mine');
  await expect(page.locator('.inbox-row').first()).toBeVisible();
  await expect(page.locator('#inbox-row-204')).toHaveCount(0);
});
