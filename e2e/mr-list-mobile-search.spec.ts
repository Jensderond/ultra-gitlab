import { test, expect } from './fixtures/test-base';
import type { Locator } from '@playwright/test';

/**
 * Small-screen MR list: collapsed search bar + pull-to-refresh.
 *
 * On small screens the search bar renders inside the scroll container and is
 * hidden above the fold by an initial scroll offset (the iOS
 * UISearchController pattern). Pulling down reveals it through plain native
 * scrolling; once the list is at the top, continued pulling runs the
 * pull-to-refresh gesture with an armed "Release to refresh" state.
 */

// Small screens now render three MRList panes side by side in the pager (one
// per status tab), so a bare `.mr-list-content` matches all three — scope to
// the one pane that isn't inert.
const CONTENT = '.tab-pager-pane:not([inert]) .mr-list-content';
const SLOT = '.mr-list-search-slot';
const INPUT = `${SLOT} .search-bar-input`;

/** Dispatch a synthetic vertical touch-drag on the scroll container. */
async function touchDrag(content: Locator, deltaY: number) {
  await content.evaluate((el, delta) => {
    const touch = (y: number) =>
      new Touch({ identifier: 1, target: el, clientX: 200, clientY: y });
    const opts = { bubbles: true, cancelable: true };
    el.dispatchEvent(new TouchEvent('touchstart', { ...opts, touches: [touch(100)] }));
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const y = 100 + (delta * i) / steps;
      el.dispatchEvent(new TouchEvent('touchmove', { ...opts, touches: [touch(y)] }));
    }
  }, deltaY);
}

async function touchRelease(content: Locator) {
  await content.evaluate((el) => {
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] }));
  });
}

test.describe('Mobile collapsed search + pull-to-refresh', () => {
  test.use({ viewport: { width: 390, height: 664 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-item').first()).toBeVisible();
  });

  test('search bar starts collapsed above the viewport and unfocused', async ({ page }) => {
    const content = page.locator(CONTENT);
    await expect(page.locator(SLOT)).toBeAttached();

    // Scrolled out of view: container rests below the search bar…
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    // …so the bar's bottom settles at/above the container's top edge (polled:
    // late font loads shift layout and the settle logic re-collapses it).
    await expect
      .poll(async () => {
        const slotBottom = await page
          .locator(SLOT)
          .evaluate((el) => el.getBoundingClientRect().bottom);
        const contentTop = await content.evaluate((el) => el.getBoundingClientRect().top);
        return slotBottom - contentTop;
      }, { timeout: 3000 })
      .toBeLessThanOrEqual(1);

    await expect(page.locator(INPUT)).not.toBeFocused();
  });

  test('a mostly revealed search bar settles fully open without focusing', async ({ page }) => {
    const content = page.locator(CONTENT);
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Leave the bar three-quarters revealed; the settle logic should snap it open.
    await content.evaluate((el) => {
      el.scrollTop = Math.round(el.scrollTop / 4);
    });
    await expect.poll(() => content.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBe(0);

    // Revealing must not focus the field or show any refresh UI.
    await expect(page.locator(INPUT)).not.toBeFocused();
    await expect(page.locator('.pull-refresh-indicator')).not.toBeAttached();
  });

  test('a barely revealed search bar settles back to collapsed', async ({ page }) => {
    const content = page.locator(CONTENT);
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const hidden = await content.evaluate((el) => el.scrollTop);

    // Reveal only a sliver; it should snap back shut.
    await content.evaluate((el, target) => {
      el.scrollTop = target;
    }, hidden - 8);
    await expect
      .poll(() => content.evaluate((el) => el.scrollTop), { timeout: 3000 })
      .toBeGreaterThanOrEqual(hidden - 1);
  });

  test('header search button reveals and focuses the search field', async ({ page }) => {
    const content = page.locator(CONTENT);
    await page.locator('button[aria-label="Search merge requests"]').click();

    await expect(page.locator(INPUT)).toBeFocused();
    await expect.poll(() => content.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBe(0);
  });

  test('typing filters the list and close collapses the bar again', async ({ page }) => {
    const content = page.locator(CONTENT);
    await page.locator('button[aria-label="Search merge requests"]').click();
    await expect(page.locator(INPUT)).toBeFocused();

    await page.locator(INPUT).fill('carol');
    await expect(page.locator('.mr-list-item')).toHaveCount(1);

    await page.locator(`${SLOT} .search-bar-cancel`).click();
    await expect(page.locator('.mr-list-item')).toHaveCount(4);
    await expect
      .poll(() => content.evaluate((el) => el.scrollTop), { timeout: 3000 })
      .toBeGreaterThan(0);
  });

  test('pulling while the bar is still collapsed never shows refresh UI', async ({ page }) => {
    const content = page.locator(CONTENT);
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Synthetic touches don't natively scroll, so scrollTop stays > 0 for the
    // whole drag — the refresh gesture must not engage during the reveal stage.
    await touchDrag(content, 200);
    await expect(page.locator('.pull-refresh-indicator')).not.toBeAttached();
    await touchRelease(content);
    await expect(page.locator('.pull-refresh-indicator--active')).not.toBeAttached();
  });

  test('pull below the threshold shows hint and does not refresh on release', async ({ page }) => {
    const content = page.locator(CONTENT);
    await content.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(0);

    // 80px drag * 0.5 resistance = 40px < 64px threshold.
    await touchDrag(content, 80);
    await expect(page.locator('.pull-refresh-label')).toHaveText('Pull to refresh');

    await touchRelease(content);
    await expect(page.locator('.pull-refresh-indicator--active')).not.toBeAttached();
    await expect(page.locator('.pull-refresh-indicator')).not.toBeAttached();
  });

  test('pull past the threshold arms, and releasing triggers the refresh', async ({ page }) => {
    const content = page.locator(CONTENT);
    await content.evaluate((el) => el.scrollTo({ top: 0 }));
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(0);

    // 180px drag * 0.5 resistance = 90px > 64px threshold → armed.
    await touchDrag(content, 180);
    await expect(page.locator('.pull-refresh-label')).toHaveText('Release to refresh');

    await touchRelease(content);
    await expect(page.locator('.pull-refresh-indicator--active')).toBeVisible();
    await expect(page.locator('.pull-refresh-label')).toHaveText('Refreshing');
  });
});

test.describe('Desktop keeps the overlay search', () => {
  test('no collapsed search slot renders at desktop width', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-item').first()).toBeVisible();

    await expect(page.locator(SLOT)).not.toBeAttached();

    // No search button in the header at desktop width — ⌘F is the way in.
    await expect(page.locator('button[aria-label="Search merge requests"]')).not.toBeAttached();
    await page.keyboard.press('Control+f');
    await expect(page.locator('.mr-list-page-content > .search-bar')).toBeVisible();
  });
});
