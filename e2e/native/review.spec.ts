/**
 * Review screen: screenshots + the main flows (thread, composer, drafts,
 * finish sheet) against the mocked backend.
 * Run: bunx playwright test e2e/native/review.spec.ts --retries=0 --reporter=line
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/test-base';
import { installReviewMocks, REVIEWED_SHA } from './fixtures/seed-review';

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/native/screenshots/review-${name}.png` });

async function open(page: Page, path = '/review/101') {
  await page.goto(path);
  // Other screens may be mid-edit in the shared dev server; their overlay isn't ours.
  await page.addStyleTag({ content: 'vite-error-overlay { display: none !important; }' });
  await page.locator('.rv-diff, .rv-calm, .rv-image').first().waitFor();
  // Let the worker pool highlight the code.
  await page.waitForTimeout(700);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });

    test(`overview ${scheme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
      await open(page);
      await expect(page.locator('.rv-file').first()).toContainText('ThemeToggle.tsx');
      await shot(page, scheme);
      expect(errors).toEqual([]);
    });

    test(`thread ${scheme}`, async ({ page }) => {
      await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
      await open(page, `/review/101?file=${encodeURIComponent('src/App.tsx')}`);
      await expect(page.locator('#rv-thread-disc-app-1')).toBeVisible();
      await shot(page, `thread-${scheme}`);
    });
  });
}

test.describe('flows', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

  test('reply composer, draft, finish sheet', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/App.tsx')}`);

    const thread = page.locator('#rv-thread-disc-app-1');
    await thread.getByRole('button', { name: 'Reply' }).click();
    const box = thread.locator('textarea');
    await expect(box).toBeFocused();
    await box.fill('Agreed — the page view covers the initial theme, so this is fine.');
    await shot(page, 'composer');

    await box.press('ControlOrMeta+Enter');
    await expect(thread.locator('.rv-note--draft')).toBeVisible();
    await expect(page.getByRole('button', { name: /Finish review · 1 pending/ })).toBeVisible();

    // New comment on a line via the line number.
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('#rv-finish-body').fill('Nice and small. One question about tracking, otherwise good to go.');
    await page.getByRole('radio', { name: /Approve/ }).click();
    await shot(page, 'finish');
    await page.getByRole('dialog').getByRole('button', { name: /Approve & post 1/ }).click();
    await expect(page).toHaveURL(/\/inbox\//);
    expect(errors).toEqual([]);
  });

  test('keyboard: J/K, V, C, N', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page);
    await expect(page).toHaveURL(/file=src%2Fcomponents%2FThemeToggle\.tsx/);

    // Scroll position is kept per file.
    await page.locator('.rv-scroll').evaluate((el) => (el.scrollTop = 400));
    await page.keyboard.press('j');
    await expect(page).toHaveURL(/file=src%2FApp\.tsx/);
    await page.waitForTimeout(300);
    expect(await page.locator('.rv-scroll').evaluate((el) => el.scrollTop)).toBe(0);
    await page.keyboard.press('k');
    await expect(page).toHaveURL(/ThemeToggle\.tsx/);
    await page.waitForTimeout(300);
    expect(await page.locator('.rv-scroll').evaluate((el) => el.scrollTop)).toBe(400);

    await page.keyboard.press('v');
    await expect(page).toHaveURL(/file=src%2FApp\.tsx/);
    await expect(page.locator('.rv-file.is-viewed')).toHaveCount(1);
    await expect(page.locator('.rv-progress__text')).toContainText('1 of 7 files viewed');

    // Hover a line and press C to comment on it.
    await page.locator('.rv-diff').hover({ position: { x: 300, y: 120 } });
    await page.keyboard.press('c');
    await expect(page.locator('#rv-new-comment textarea')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#rv-new-comment')).toHaveCount(0);

    // N jumps to the next unresolved discussion.
    await page.keyboard.press('n');
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/file=/);
  });

  test('new comment via line number', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/styles/theme.css')}`);
    const num = page.locator('.rv-diff').locator('[data-column-number]').nth(3);
    await num.click();
    await expect(page.locator('#rv-new-comment textarea')).toBeFocused();
    await page.locator('#rv-new-comment textarea').fill('Can we name this `--color-surface` instead?');
    await page.getByRole('button', { name: 'Suggest change' }).click();
    await shot(page, 'new-comment');
    await page.locator('#rv-new-comment textarea').press('ControlOrMeta+Enter');
    await expect(page.locator('.rv-thread--draft')).toHaveCount(1);
  });

  test('since my last review', async ({ page }) => {
    await page.addInitScript((sha) => {
      localStorage.setItem('ug.review.last.101', JSON.stringify({ sha, at: 1700000000 }));
    }, REVIEWED_SHA);
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page);
    await page.getByRole('button', { name: 'Since my last review' }).click();
    await page.waitForTimeout(600);
    await shot(page, 'since');
  });

  test('split, image, generated', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'split' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/App.tsx')}`);
    await shot(page, 'split');
    await open(page, `/review/101?file=${encodeURIComponent('public/icons/moon.svg')}`);
    await shot(page, 'image');
    await open(page, `/review/101?file=${encodeURIComponent('package-lock.json')}`);
    await shot(page, 'generated');
    await open(page, `/review/101?file=${encodeURIComponent('src/legacy/OldTheme.css')}`);
    await shot(page, 'deleted');
  });

  test('⌘K palette', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page);
    const palette = page.getByRole('dialog', { name: 'Search or jump to' });
    const results = palette.getByRole('listbox', { name: 'Search results' });

    // Esc closes the palette, not the review underneath; J/K don't move files while it's open.
    const reviewUrl = page.url();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette).toBeVisible();
    await expect(results.getByRole('option', { name: /Settings/ })).toBeVisible();
    await page.waitForTimeout(250);
    await shot(page, 'palette');
    await page.keyboard.type('jk');
    await expect(page).toHaveURL(reviewUrl);
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(reviewUrl);

    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('go to pipe');
    await expect(results.getByRole('option', { selected: true })).toContainText('Go to Pipelines');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/pipelines$/);
    await expect(palette).toBeHidden();

    // Back home, ⌘K focuses the toolbar field instead.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('combobox', { name: 'Search or jump to' })).toBeFocused();
    await expect(palette).toHaveCount(0);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`narrow ${scheme}`, () => {
    test.use({ viewport: { width: 1000, height: 700 }, colorScheme: scheme });
    test(`narrow ${scheme}`, async ({ page }) => {
      await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
      await open(page);
      await shot(page, `narrow-${scheme}`);
    });
  });
}
