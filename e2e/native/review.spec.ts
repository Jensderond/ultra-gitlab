/**
 * Review screen: screenshots + the main flows (thread, composer, drafts,
 * finish sheet) against the mocked backend.
 * Run: bunx playwright test e2e/native/review.spec.ts --retries=0 --reporter=line
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/test-base';
import { installReviewMocks, note, REVIEWED_SHA } from './fixtures/seed-review';

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/native/screenshots/review-${name}.png` });

async function open(page: Page, path = '/review/101') {
  await page.goto(path);
  // Other screens may be mid-edit in the shared dev server; their overlay isn't ours.
  await page.addStyleTag({ content: 'vite-error-overlay { display: none !important; }' });
  await page.locator('.rv-diff, .rv-calm, .rv-image').first().waitFor();
  // Let the worker pool highlight the code.
  await page.waitForTimeout(700);
}

/**
 * Type at the end of a line in the diff editor. Waits for the editor to have
 * focus; the first keystroke after focusing can be dropped, so the harmless,
 * idempotent End goes first, twice.
 */
async function typeAtLineEnd(page: Page, line: Locator, text: string) {
  await line.click();
  const content = page.locator('.rv-diff [data-content][contenteditable="true"]');
  await expect.poll(() => content.evaluate((el) => (el.getRootNode() as ShadowRoot).activeElement === el)).toBe(true);
  await page.keyboard.press('End');
  await page.keyboard.press('End');
  await page.keyboard.type(text);
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
    // With a pending comment the sheet defaults to Comment.
    await expect(page.getByRole('radio', { name: /Comment/ })).toHaveAttribute('aria-checked', 'true');
    await page.locator('#rv-finish-body').fill('Nice and small. One question about tracking, otherwise good to go.');
    await page.getByRole('radio', { name: /Approve/ }).click();
    await shot(page, 'finish');
    await page.getByRole('dialog').getByRole('button', { name: /Approve & post 1/ }).click();
    await expect(page).toHaveURL(/\/inbox\//);
    expect(errors).toEqual([]);
  });

  test('finish sheet defaults to Approve without pending comments', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/App.tsx')}`);

    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: /Approve/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('button', { name: /^Approve/ })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page).toHaveURL(/\/inbox\//);
  });

  test('edit your own posted comment', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const mine = note({
      id: 5104,
      discussionId: 'disc-app-1',
      parentId: 5101,
      authorUsername: 'testuser',
      body: 'Good point, I will add it.',
      filePath: 'src/App.tsx',
      newLine: 16,
    });
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' }, comments: [mine] });
    await open(page, `/review/101?file=${encodeURIComponent('src/App.tsx')}`);

    const thread = page.locator('#rv-thread-disc-app-1');
    // Only your own comment offers Edit.
    await expect(thread.getByRole('button', { name: 'Edit' })).toHaveCount(1);
    await thread.getByRole('button', { name: 'Edit' }).click();
    const box = thread.locator('textarea');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('Good point, I will add it.');
    await box.fill('Good point, added it in the next commit.');
    await box.press('ControlOrMeta+Enter');

    await expect(thread.locator('textarea')).toHaveCount(0);
    await expect(thread).toContainText('Good point, added it in the next commit.');
    const sent = await page.evaluate(() => (window as unknown as { __EDITED_COMMENTS__?: unknown[] }).__EDITED_COMMENTS__);
    expect(sent).toEqual([{ mrId: 101, commentId: 5104, body: 'Good point, added it in the next commit.' }]);
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

  test('line cursor: ↑/↓ move it, ⇧ extends, C comments, Esc clears before leaving', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/styles/theme.css')}`);
    await page.mouse.move(5, 5); // nothing hovered
    // The lines the cursor covers, as "<line-type>:<line>".
    const cursor = () =>
      page.locator('.rv-diff').evaluate((host) =>
        [...host.shadowRoot!.querySelectorAll('[data-content] > [data-line][data-selected-line]')].map(
          (el) => `${el.getAttribute('data-line-type')}:${el.getAttribute('data-line')}`,
        ),
      );

    // The first ↓ shows the cursor on the first line on screen; then it walks
    // the diff in the order it reads, removed lines before their replacement.
    await page.keyboard.press('ArrowDown');
    await expect.poll(cursor).toEqual(['context:1']);
    await page.keyboard.press('ArrowDown');
    await expect.poll(cursor).toEqual(['change-deletion:2']);
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(cursor).toEqual(['change-addition:5']);
    await page.keyboard.press('ArrowUp');
    await expect.poll(cursor).toEqual(['context:4']);
    await page.keyboard.press('ArrowDown');

    // C comments on the cursor's line, no mouse involved.
    await page.keyboard.press('c');
    const composer = page.locator('#rv-new-comment');
    await expect(composer.locator('textarea')).toBeFocused();
    await expect(composer).toContainText('Comment on line 5');
    // Esc backs out a step at a time: the composer, the cursor, then the review.
    await page.keyboard.press('Escape');
    await expect(composer).toHaveCount(0);
    await expect.poll(cursor).toEqual(['change-addition:5']);
    await page.keyboard.press('Escape');
    await expect.poll(cursor).toEqual([]);
    await expect(page).toHaveURL(/\/review\/101/);

    // ⇧J lands the cursor on the first line of a change; ⇧↓ extends a range.
    await page.keyboard.press('Shift+J');
    await page.keyboard.press('Shift+J');
    await page.keyboard.press('Shift+J');
    await expect.poll(cursor).toEqual(['change-addition:9']);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(cursor).toHaveLength(4);
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(cursor).toHaveLength(3);
    await page.keyboard.press('s');
    await expect(composer).toContainText('Comment on lines 9–11');
    await expect(composer.locator('textarea')).toHaveValue(/^```suggestion:-2\+0\n/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect.poll(cursor).toEqual([]);

    // With nothing left to clear, Esc goes back to the inbox.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/inbox\//);
  });

  test('the line cursor stays in view, and follows the mouse only when it moves', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 480 });
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/components/ThemeToggle.tsx')}`);
    const scroll = page.locator('.rv-scroll');
    const cursorLine = () =>
      page.locator('.rv-diff').evaluate((host) => {
        const el = host.shadowRoot!.querySelector('[data-content] > [data-line][data-selected-line]');
        return el ? Number(el.getAttribute('data-line')) : null;
      });
    // Whether the cursor's row is fully visible below the floating file header.
    const inView = () =>
      page.evaluate(() => {
        const el = document.querySelector('.rv-diff')!.shadowRoot!.querySelector('[data-content] > [data-line][data-selected-line]')!;
        const row = el.getBoundingClientRect();
        const head = document.querySelector('.rv-filehead')!.getBoundingClientRect();
        const box = document.querySelector('.rv-scroll')!.getBoundingClientRect();
        return row.top >= head.bottom && row.bottom <= box.bottom;
      });

    // Rest the mouse on a line: ↓ carries on from it.
    await page.locator('.rv-diff [data-line="3"]:not([data-column-number])').hover();
    await page.keyboard.press('ArrowDown');
    await expect.poll(cursorLine).toBe(4);

    // Walking off the bottom scrolls the diff along; the pointer hasn't
    // moved, so the lines passing under it don't steal the cursor.
    for (let i = 0; i < 24; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(cursorLine).toBe(28);
    expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await inView()).toBe(true);
    for (let i = 0; i < 27; i++) await page.keyboard.press('ArrowUp');
    await expect.poll(cursorLine).toBe(1);
    expect(await inView()).toBe(true);

    // Moving the mouse takes the cursor with it.
    await page.locator('.rv-diff [data-line="6"]:not([data-column-number])').hover();
    await expect.poll(cursorLine).toBe(6);
    await page.keyboard.press('ArrowDown');
    await expect.poll(cursorLine).toBe(7);
  });

  test('a sheet animates out before it goes', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page);
    const backdrop = page.locator('.ui-sheet-backdrop');
    const reviewUrl = page.url();

    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(backdrop).toHaveAttribute('data-state', 'open');
    // The dim starts below the toolbar: the sheet hangs from it.
    const dimTop = await backdrop.evaluate((el) => parseFloat(getComputedStyle(el, '::before').top));
    expect(dimTop).toBeGreaterThan(40);

    // Esc: it stays in the page while it leaves, but is no longer a dialog
    // and no longer in the way of the keys or the pointer.
    await page.keyboard.press('Escape');
    await expect(backdrop).toHaveAttribute('data-state', 'closed');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await backdrop.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await expect(backdrop).toHaveCount(0);
    await expect(page).toHaveURL(reviewUrl);

    // Reopening while it leaves turns it around instead of starting over.
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(backdrop).toHaveAttribute('data-state', 'open');
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(backdrop).toHaveCount(1);
  });

  test('file header: one row, nothing clipped, no jump when the inspector toggles', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/components/ThemeToggle.tsx')}`);
    const head = page.locator('.rv-filehead');
    const diffTop = () => page.locator('.rv-diff').evaluate((el) => el.getBoundingClientRect().top);
    // Every control sits fully inside the header, on one line.
    const fits = () =>
      head.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('.rv-filehead__controls > *')].every((c) => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom;
        });
      });

    for (const open of [false, true, false]) {
      const shown = (await page.locator('.rv-aside').count()) > 0;
      if (shown !== open) {
        await page.keyboard.press('ControlOrMeta+Alt+Digit0');
        await page.waitForTimeout(400);
      }
      await expect(page.locator('.rv-aside')).toHaveCount(open ? 1 : 0);
      expect((await head.boundingBox())!.height).toBe(40);
      expect(await fits()).toBe(true);
      expect(await diffTop()).toBe(52 + 40);
      await expect(page.getByRole('button', { name: /Mark viewed/ })).toBeVisible();
    }

    // The footer's way to every shortcut is never clipped.
    const all = page.locator('.rv-footer__end');
    const box = (await all.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(1024);
    await all.click();
    await expect(page.locator('.ui-sheet', { hasText: 'Keyboard Shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');

    // The header stays put while the diff scrolls under it, and only then draws its hairline.
    const line = () => head.evaluate((el) => getComputedStyle(el).borderBottomColor);
    expect(await line()).toBe('rgba(0, 0, 0, 0)');
    await page.locator('.rv-scroll').evaluate((el) => (el.scrollTop = 300));
    await expect.poll(line).not.toBe('rgba(0, 0, 0, 0)');
    expect((await head.boundingBox())!.y).toBe(52);
  });

  test('O opens the MR in GitLab, Y copies its link, the inspector shows the author', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page);
    const url = 'https://gitlab.example.com/frontend/web-app/-/merge_requests/42';

    // The author leads the people block, below the discussions.
    const people = page.getByRole('region', { name: 'Author and reviewers' });
    await expect(people.locator('.rv-reviewer').first()).toHaveText(/alice\s*Author/);

    await page.keyboard.press('o');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __MOCK_OPENED_URLS__?: string[] }).__MOCK_OPENED_URLS__))
      .toEqual([url]);

    await page.keyboard.press('y');
    await expect(page.getByText('Link copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  });

  test('⇧J / ⇧K step through the changes in a file', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 480 });
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/styles/theme.css')}`);
    const scroll = page.locator('.rv-scroll');
    // The first row of the flashed block, by its unified line index.
    const flashed = () =>
      page.locator('.rv-diff').evaluate((host) => {
        const cell = host.shadowRoot!.querySelector('[data-ug-flash]');
        return cell ? parseInt(cell.getAttribute('data-line-index')!, 10) : null;
      });

    await page.keyboard.press('Shift+J');
    await expect.poll(flashed).toBe(1);
    await page.keyboard.press('Shift+J');
    await expect.poll(flashed).toBe(6);
    await page.keyboard.press('Shift+J');
    await expect.poll(flashed).toBe(10);
    const down = await scroll.evaluate((el) => el.scrollTop);
    expect(down).toBeGreaterThan(0);
    await page.keyboard.press('Shift+J');
    await expect.poll(flashed).toBe(19);
    await page.keyboard.press('Shift+J');
    await expect(page.getByText('Last change in this file')).toBeVisible();
    await expect(page).toHaveURL(/theme\.css/);

    await page.keyboard.press('Shift+K');
    await expect.poll(flashed).toBe(10);
    await page.keyboard.press('Shift+K');
    await expect.poll(flashed).toBe(6);
    expect(await scroll.evaluate((el) => el.scrollTop)).toBeLessThan(down);

    // After scrolling by hand, ⇧J starts from what's on screen.
    await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.keyboard.press('Shift+K');
    await expect.poll(flashed).not.toBe(6);
  });

  test('⇧J pages through a change taller than the window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 480 });
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    // A new file: the whole file is one block of changes.
    await open(page, `/review/101?file=${encodeURIComponent('src/components/ThemeToggle.tsx')}`);
    const scroll = page.locator('.rv-scroll');
    const top = () => scroll.evaluate((el) => el.scrollTop);

    await page.keyboard.press('Shift+J');
    await expect.poll(top).toBeGreaterThan(0);
    const first = await top();
    await page.keyboard.press('Shift+J');
    await expect.poll(top).toBeGreaterThan(first);
    await expect(page.getByText('Last change in this file')).toHaveCount(0);

    await page.keyboard.press('Shift+K');
    await expect.poll(top).toBe(first);
  });

  test('⌘? shows the keyboard shortcuts', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page);
    const sheet = page.locator('.ui-sheet', { hasText: 'Keyboard Shortcuts' });
    const reviewUrl = page.url();

    await page.keyboard.press('ControlOrMeta+Shift+Slash');
    await expect(sheet).toBeVisible();
    // The screen you're on comes first.
    await expect(sheet.locator('.ks-section__title').first()).toHaveText('Reviewing changes');
    await expect(sheet).toContainText('Next / previous change in the file');
    await page.waitForTimeout(250);
    await shot(page, 'shortcuts');
    // Keys underneath are blocked while it's open.
    await page.keyboard.press('j');
    await expect(page).toHaveURL(reviewUrl);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(reviewUrl);

    // ⌘? toggles it, and the palette opens it too.
    await page.keyboard.press('ControlOrMeta+Shift+Slash');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+Slash');
    await expect(sheet).toBeHidden();
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('shortcuts');
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
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

  test('multi-line comment with a suggestion', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/styles/theme.css')}`);
    const added = (n: number) => page.locator(`.rv-diff [data-line-type=change-addition][data-column-number="${n}"]`);

    // Drag upwards over the line numbers: the range is still read top to bottom.
    await added(12).hover();
    await page.mouse.down();
    await added(9).hover();
    await page.mouse.up();
    await page.keyboard.press('c');
    const composer = page.locator('#rv-new-comment');
    await expect(composer).toContainText('Comment on lines 9–12');
    await composer.getByRole('button', { name: 'Suggest change' }).click();
    const box = composer.locator('textarea');
    await expect(box).toHaveValue(/^```suggestion:-3\+0\n\[data-theme='dark'\] \{\n(.*\n){3}```\n$/);
    await shot(page, 'multiline');
    await box.press('ControlOrMeta+Enter');
    await expect(page.locator('.rv-thread--draft .rv-note__range')).toHaveText('lines 9–12');

    // Shift-click extends a selection and comments on all of it.
    await added(10).click();
    await page.keyboard.press('Escape');
    await added(11).click({ modifiers: ['Shift'] });
    await expect(composer).toContainText('Comment on lines 10–11');
    await page.keyboard.press('Escape');

    // The range goes to GitLab with the comment.
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await page.getByRole('dialog').getByRole('button', { name: /Post 1 comment/ }).click();
    await expect(page).toHaveURL(/\/inbox\//);
    const sent = await page.evaluate(() => (window as unknown as { __ADDED_COMMENTS__: unknown[] }).__ADDED_COMMENTS__);
    expect(sent).toEqual([
      expect.objectContaining({ newLine: 12, lineRangeStart: { side: 'new', line: 9 } }),
    ]);
  });

  test('S suggests a change on the hovered line', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/styles/theme.css')}`);
    await page.locator('.rv-diff [data-line-type=change-addition][data-column-number="5"]').hover();
    await page.keyboard.press('s');
    const box = page.locator('#rv-new-comment textarea');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('```suggestion:-0+0\n  --color-accent: #e94560;\n```\n');
    // The suggested line is selected, ready to type over.
    expect(await box.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(
      '  --color-accent: #e94560;',
    );
  });

  test('suggest edit turns an in-place edit into a suggestion', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/styles/theme.css')}`);
    const edit = page.getByRole('button', { name: /Suggest edit/ });
    await expect(edit).toBeEnabled();
    await page.keyboard.press('e');
    await expect(page.getByRole('group', { name: 'Suggest edit' })).toBeVisible();
    const create = page.getByRole('button', { name: /Create suggestion/ });
    await expect(create).toBeDisabled();

    // Line 10 of the new version. Letters must reach the editor, not trigger J/K/V shortcuts.
    const code = page.locator('.rv-diff [data-line-index="11,9"]:not([data-column-number])');
    await typeAtLineEnd(page, code, ' /* jk v */');
    await expect(page).toHaveURL(/theme\.css/);
    await shot(page, 'suggest-edit');
    await expect(create).toBeEnabled();
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(page.getByRole('group', { name: 'Suggest edit' })).toHaveCount(0);
    const box = page.locator('#rv-new-comment textarea');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('```suggestion:-0+0\n  --color-primary: #e6e6eb; /* jk v */\n```\n');
    await expect(page.locator('#rv-new-comment')).toContainText('Comment on line 10');
  });

  test('cancelling suggest edit asks only when there are changes', async ({ page }) => {
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page, `/review/101?file=${encodeURIComponent('src/styles/theme.css')}`);
    const bar = page.getByRole('group', { name: 'Suggest edit' });
    await expect(page.getByRole('button', { name: /Suggest edit/ })).toBeEnabled();

    // No changes: Esc (inside the editor) leaves right away.
    await page.keyboard.press('e');
    const code = page.locator('.rv-diff [data-line-index="11,9"]:not([data-column-number])');
    await code.click();
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(page).toHaveURL(/theme\.css/);

    // With changes: Esc asks; "Keep editing" keeps the edit.
    await page.keyboard.press('e');
    await typeAtLineEnd(page, code, ' /* x */');
    await expect(code).toContainText('/* x */');
    // Straight away: the edit counts even before Pierre reports the change.
    await page.keyboard.press('Escape');
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('Discard your edit?');
    await page.waitForTimeout(400);
    await shot(page, 'discard-edit');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(bar).toBeVisible();
    await expect(page.getByRole('button', { name: /Create suggestion/ })).toBeEnabled();
    // …and puts you back where you were: typing carries on at the caret.
    await page.keyboard.type('Q');
    await expect(code).toContainText('/* x */Q');

    // So does the button.
    await page.keyboard.press('Escape');
    await sheet.getByRole('button', { name: 'Keep editing' }).click();
    await page.keyboard.type('R');
    await expect(code).toContainText('/* x */QR');

    // Switching files asks too.
    await page.locator('.rv-file').filter({ hasText: 'App.tsx' }).first().click();
    await expect(sheet).toContainText('Discard your edit?');
    await sheet.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/theme\.css/);

    // The Cancel button asks; Discard leaves edit mode without a comment.
    await bar.getByRole('button', { name: 'Cancel' }).click();
    await sheet.getByRole('button', { name: 'Discard' }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator('#rv-new-comment')).toHaveCount(0);
    await expect(page.locator('.rv-diff')).not.toContainText('/* x */');
  });

  test('since my last review', async ({ page }) => {
    await page.addInitScript((sha) => {
      localStorage.setItem('ug.review.last.101', JSON.stringify({ sha, at: 1700000000 }));
    }, REVIEWED_SHA);
    await installReviewMocks(page, { settings: { diffViewMode: 'unified' } });
    await open(page);
    // The view options sit behind one pop-up button in the file header.
    const view = page.getByRole('button', { name: 'View options' });
    await view.click();
    const menu = page.getByRole('menu', { name: 'View options' });
    await expect(menu.getByRole('menuitemradio', { name: 'Unified' })).toBeFocused();
    await expect(menu.getByRole('menuitemradio', { name: 'All commits' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: 'Since my last review' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    // The button says the diff is narrowed, so it can't hide behind the menu.
    await expect(page.getByRole('button', { name: 'View options: since my last review' })).toHaveText(/Since last review/);
    await page.waitForTimeout(600);
    await shot(page, 'since');

    // Esc closes the menu, not the review.
    await page.getByRole('button', { name: /View options/ }).click();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/\/review\/101/);
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
