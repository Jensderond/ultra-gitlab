import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';
import { mergeRequests } from './fixtures/seed-data';

/**
 * Returning to the list from an MR detail page.
 *
 * Two ways in: the in-app back button (a `navigate()` call) and a genuine
 * history POP. The POP is what iOS's native edge-swipe-back gesture fires
 * (`setAllowsBackForwardNavigationGestures`, see src-tauri/src/lib.rs) — so
 * `page.goBack()` here exercises exactly the same path as the swipe. Both must
 * land on the status tab and scroll offset the MR was opened from; anything
 * that lives only in React state or in `location.state` is gone after a POP.
 */

const ROW = '.mr-list-item';

/** Seed with MR 101 user-approved so the Approved tab has something to open. */
const withApproved = mergeRequests.map((mr) =>
  mr.id === 101 ? { ...mr, userHasApproved: true } : mr,
);

/** A list long enough to scroll, entirely inside the Approved tab. */
const FILLER_COUNT = 40;
const manyApproved = [
  ...mergeRequests,
  ...Array.from({ length: FILLER_COUNT }, (_, i) => ({
    ...mergeRequests[0],
    id: 9000 + i,
    iid: 9000 + i,
    title: `chore: approved filler ${i}`,
    userHasApproved: true,
  })),
];

test.describe('returning to the MR list', () => {
  test('a history pop restores the tab the MR was opened from', async ({ page }) => {
    await mockTauriIPC(page, { mergeRequests: withApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/mrs\/101/);

    await page.goBack();

    await expect(page.locator(ROW).first()).toBeVisible();
    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
  });

  test('the in-app back button restores the tab the MR was opened from', async ({ page }) => {
    await mockTauriIPC(page, { mergeRequests: withApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    await page.locator(ROW).filter({ hasText: 'Add dark mode toggle' }).click();
    await expect(page).toHaveURL(/\/mrs\/101/);

    await page.locator('.back-button-icon').click();

    await expect(page.locator(ROW).first()).toBeVisible();
    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
  });

  test('the in-app back button pops the detail entry instead of replacing it', async ({ page }) => {
    await mockTauriIPC(page, { mergeRequests: withApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    await page.locator(ROW).filter({ hasText: 'Add dark mode toggle' }).click();
    await expect(page).toHaveURL(/\/mrs\/101/);

    await page.locator('.back-button-icon').click();
    await expect(page.locator(ROW).first()).toBeVisible();

    // A replace() would have overwritten the detail entry, leaving nothing to
    // go forward to — and stacking a second /mrs entry behind it, so the next
    // edge-swipe back reads as a no-op. iOS enables the forward swipe too.
    await page.goForward();
    await expect(page).toHaveURL(/\/mrs\/101/);
  });

  test('a history pop restores the list scroll offset', async ({ page }) => {
    await mockTauriIPC(page, { mergeRequests: manyApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    const content = page.locator('.mr-list-content');
    // Wait for the *approved* rows specifically. "Some row is visible" is not a
    // readiness gate here — the four needs-review rows satisfy it, and scrolling
    // a four-row list clamps to nearly zero.
    await expect(page.locator(ROW)).toHaveCount(FILLER_COUNT);

    const row = page.locator(ROW).filter({ hasText: 'approved filler 12' });
    await row.scrollIntoViewIfNeeded();
    const offset = await content.evaluate((el) => el.scrollTop);
    expect(offset).toBeGreaterThan(400);
    await row.click();
    await expect(page).toHaveURL(/\/mrs\/90/);

    await page.goBack();
    await expect(page.locator(ROW)).toHaveCount(FILLER_COUNT);

    await expect
      .poll(async () => Math.abs((await content.evaluate((el) => el.scrollTop)) - offset))
      .toBeLessThan(20);
  });
});
