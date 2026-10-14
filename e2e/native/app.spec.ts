/**
 * App-level screens: first-run setup, settings, the toolbar search popover,
 * the session-expired sheet and Markdown rendering.
 * Run: bunx playwright test e2e/native/app.spec.ts --retries=0 --reporter=line
 */
import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';
import * as seed from './fixtures/seed-data';

const RICH_MD = `This replaces the **one batch** sync with a per-account job, so a slow account no longer blocks the rest. See !312 and #88, thanks @daan.

### What changed
- Queue one \`SyncAccount\` job per account
  - retries with backoff
  - [docs](https://gitlab.com/help)
- [x] Unit tests
- [ ] Load test on staging

> Note: the old cron entry stays until the next release.

| Account | Before | After |
|:--|--:|--:|
| Noordkaap | 41s | 6s |

\`\`\`php
$jobs = $accounts->map(fn ($a) => new SyncAccount($a));
\`\`\`

\`\`\`suggestion:-0+0
$jobs = $accounts->map(fn (Account $a) => new SyncAccount($a));
\`\`\`

![screenshot](/uploads/abc/before.png) <script>alert(1)</script>`;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });

    test('first-run setup', async ({ page }) => {
      await mockTauriIPC(page, { instances: [] });
      await page.goto('/');
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.getByRole('heading', { name: 'Welcome to Ultra GitLab' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
      await page.screenshot({ path: `e2e/native/screenshots/app-setup-${scheme}.png` });

      // Validation: an unusable URL is explained inline.
      await page.getByLabel('GitLab URL').fill('not a url');
      await page.getByRole('button', { name: /Connect/ }).click();
      await expect(page.getByRole('alert')).toContainText('Enter the address');
      await page.screenshot({ path: `e2e/native/screenshots/app-setup-error-${scheme}.png` });
    });

    test('add instance', async ({ page }) => {
      await page.goto('/setup');
      await expect(page.getByRole('heading', { name: 'Add a GitLab instance' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
      await page.getByLabel('Access token').fill('glpat-test');
      await page.getByRole('button', { name: /Connect/ }).click();
      await expect(page).toHaveURL(/\/inbox/);
    });

    for (const tab of ['general', 'accounts', 'review', 'notifications']) {
      test(`settings ${tab}`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(tab === 'general' ? '/settings' : `/settings?tab=${tab}`);
        await expect(page.getByRole('tab', { selected: true })).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `e2e/native/screenshots/app-settings-${tab}-${scheme}.png`, fullPage: true });
        expect(errors).toEqual([]);
      });
    }

    test('search popover', async ({ page }) => {
      await page.goto('/inbox/review');
      await page.waitForTimeout(500);
      await page.keyboard.press('ControlOrMeta+k');
      await page.keyboard.type('dark');
      const list = page.getByRole('listbox', { name: 'Search results' });
      await expect(list).toBeVisible();
      await expect(list.getByRole('option').first()).toContainText('dark mode');
      await page.waitForTimeout(250);
      await page.screenshot({ path: `e2e/native/screenshots/app-search-${scheme}.png` });

      // Empty query shows commands.
      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+k');
      await expect(list.getByRole('option', { name: /Settings/ })).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `e2e/native/screenshots/app-search-commands-${scheme}.png` });
    });

    test('session expired sheet', async ({ page }) => {
      await page.goto('/inbox/review');
      await page.waitForTimeout(600);
      await page.evaluate(() =>
        (window as unknown as { __TAURI_MOCK_EMIT__: (e: string, p: unknown) => void }).__TAURI_MOCK_EMIT__(
          'auth-expired',
          { instance_id: 1, instance_url: 'https://gitlab.example.com', message: 'Token expired' },
        ),
      );
      await expect(page.getByRole('dialog')).toContainText('Your GitLab session expired');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/native/screenshots/app-reauth-${scheme}.png` });
    });

    test('markdown', async ({ page }) => {
      const mergeRequests = seed.mergeRequests.map((m, i) => (i === 0 ? { ...m, description: RICH_MD } : m));
      await mockTauriIPC(page, { mergeRequests });
      await page.goto(`/inbox/review?mr=${mergeRequests[0].id}`);
      await expect(page.locator('.md-suggestion')).toBeVisible();
      await expect(page.locator('.md script')).toHaveCount(0);
      await page.locator('.md').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/native/screenshots/app-markdown-${scheme}.png` });
    });
  });
}

test.describe('narrow', () => {
  test.use({ viewport: { width: 1000, height: 700 }, colorScheme: 'light' });

  test('settings + search at 1000×700', async ({ page }) => {
    await page.goto('/settings?tab=accounts');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'e2e/native/screenshots/app-settings-narrow.png' });
    // Cold start on Settings: Esc falls back to the inbox instead of leaving the app.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/inbox\/review/);
    // Coming from a screen: ⌘, then Esc returns there.
    await page.goto('/pipelines');
    await page.waitForTimeout(300);
    await page.keyboard.press('ControlOrMeta+,');
    await expect(page).toHaveURL(/\/settings/);
    await page.getByRole('tab', { name: 'Review' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/pipelines(\?|$)/);
    await page.goto('/inbox/review');
    await page.waitForTimeout(400);
    await page.keyboard.press('/');
    await page.keyboard.type('web');
    await page.waitForTimeout(250);
    await page.screenshot({ path: 'e2e/native/screenshots/app-search-narrow.png' });
  });

  test('setup at 1000×700', async ({ page }) => {
    await mockTauriIPC(page, { instances: [] });
    await page.goto('/setup');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/native/screenshots/app-setup-narrow.png' });
  });
});

test.describe('behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('pasting an MR URL jumps to the review', async ({ page }) => {
    await page.goto('/inbox/review');
    await page.waitForTimeout(300);
    const mr = seed.mergeRequests[0];
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.insertText(mr.webUrl + '/diffs');
    const results = page.getByRole('listbox', { name: 'Search results' });
    await expect(results.getByRole('option').first()).toContainText(`Open !${mr.iid}`);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/review/${mr.id}`));
  });

  test('arrow keys + enter run a command', async ({ page }) => {
    await page.goto('/inbox/review');
    await page.waitForTimeout(300);
    await page.keyboard.press('/');
    await page.keyboard.type('go');
    const results = page.getByRole('listbox', { name: 'Search results' });
    const selected = results.getByRole('option', { selected: true });
    await expect(selected).toContainText('Go to Merge requests');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(selected).toContainText('Go to Pipelines');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/pipelines/);
  });

  test('settings switches persist', async ({ page }) => {
    await page.goto('/settings');
    const drafts = page.getByRole('switch', { name: 'Show drafts' });
    await expect(drafts).toHaveAttribute('aria-checked', 'true');
    await drafts.click();
    await expect(drafts).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('tab', { name: 'Notifications' }).click();
    const native = page.getByRole('switch', { name: 'Show macOS notifications' });
    const before = await native.getAttribute('aria-checked');
    await native.click();
    await expect(native).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  });

  test('notification clicks map old routes', async ({ page }) => {
    await page.goto('/inbox/review');
    await page.waitForTimeout(500);
    await page.evaluate(() =>
      (window as unknown as { __TAURI_MOCK_EMIT__: (e: string, p: unknown) => void }).__TAURI_MOCK_EMIT__(
        'notification:clicked',
        { route: '/pipelines/10/3001?instance=1&project=frontend%2Fweb-app' },
      ),
    );
    await expect(page).toHaveURL(/\/pipelines\/1\/10\/3001/);
  });

  test('pipeline notification toasts', async ({ page }) => {
    await page.goto('/inbox/review');
    await page.waitForTimeout(500);
    await page.evaluate(() =>
      (window as unknown as { __TAURI_MOCK_EMIT__: (e: string, p: unknown) => void }).__TAURI_MOCK_EMIT__(
        'notification:pipeline-changed',
        { projectName: 'frontend/web-app', oldStatus: 'running', newStatus: 'failed', refName: 'main', webUrl: '', instanceId: 1, projectId: 10, pipelineId: 3001 },
      ),
    );
    await expect(page.getByRole('status')).toContainText('Pipeline Failed — frontend/web-app (main)');
  });
});
