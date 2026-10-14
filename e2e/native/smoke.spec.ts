/**
 * Smoke screenshots of every screen against the mocked backend.
 * Run: bunx playwright test e2e/native/smoke.spec.ts  → e2e/native/screenshots/*.png
 */
import { test, expect } from './fixtures/test-base';

const routes: [string, string][] = [
  ['inbox', '/inbox/review'],
  ['inbox-selected', '/inbox/review?mr=101'],
  ['my-mrs', '/inbox/mine'],
  ['review', '/review/101'],
  ['pipelines', '/pipelines'],
  ['settings', '/settings'],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    for (const [name, path] of routes) {
      test(name, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(path);
        await page.waitForTimeout(900);
        await page.screenshot({ path: `e2e/native/screenshots/${name}-${scheme}.png` });
        expect(errors).toEqual([]);
      });
    }
  });
}
