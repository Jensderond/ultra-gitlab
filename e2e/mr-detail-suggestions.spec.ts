import { test, expect } from './fixtures/test-base';
import type { Page } from '@playwright/test';

async function dragSelectAddedLines(page: Page, startLine: number, endLine: number) {
  const diffContainer = page.locator('diffs-container');
  await expect(diffContainer).toBeVisible({ timeout: 15_000 });

  const { startBox, endBox } = await diffContainer.evaluate((element, lines) => {
    const shadow = element.shadowRoot;
    if (!shadow) {
      throw new Error('Diff container shadow root is unavailable');
    }

    const start = shadow.querySelector(`[data-column-number="${lines.startLine}"]`);
    const end = shadow.querySelector(`[data-column-number="${lines.endLine}"]`);

    if (!(start instanceof HTMLElement) || !(end instanceof HTMLElement)) {
      throw new Error(`Could not find line numbers ${lines.startLine}-${lines.endLine} in diff gutter`);
    }

    const startRect = start.getBoundingClientRect();
    const endRect = end.getBoundingClientRect();

    return {
      startBox: {
        x: startRect.x,
        y: startRect.y,
        width: startRect.width,
        height: startRect.height,
      },
      endBox: {
        x: endRect.x,
        y: endRect.y,
        width: endRect.width,
        height: endRect.height,
      },
    };
  }, { startLine, endLine });

  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function clickCodeLine(page: Page, line: number) {
  const diffContainer = page.locator('diffs-container');
  const box = await diffContainer.evaluate((element, target) => {
    const gutter = element.shadowRoot?.querySelector(`[data-column-number="${target}"]`);
    if (!(gutter instanceof HTMLElement)) throw new Error(`Line ${target} not found`);
    const rect = gutter.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, line);
  // Click well to the right of the gutter to land in the code column.
  await page.mouse.click(box.x + box.width + 160, box.y + box.height / 2);
}

async function enterEditMode(page: Page) {
  const editBtn = page.locator('.suggest-edit-btn');
  await expect(editBtn).toBeEnabled({ timeout: 15_000 }); // waits for highlighter preload
  await editBtn.click();
  // Wait for pierre to attach the editor before clicking/typing — the
  // contentEditable surface appears inside the shadow root slightly after
  // the edit prop flips.
  await expect(page.locator('diffs-container [contenteditable="true"]').first()).toBeAttached({ timeout: 10_000 });
}

/**
 * Append text at the end of a line and verify it landed. The editor
 * occasionally isn't focused by the first click (keystrokes are dropped
 * whole, never partially), so retry the click+type until the text shows.
 */
async function typeAtEndOfLine(page: Page, line: number, text: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickCodeLine(page, line);
    await page.keyboard.press('End');
    await page.keyboard.type(text);
    try {
      await expect(page.locator('diffs-container')).toContainText(text, { timeout: 2_000 });
      return;
    } catch {
      // Editor wasn't focused yet — retry.
    }
  }
  throw new Error(`Typing "${text}" into line ${line} never landed`);
}

test.describe('MR Detail Suggestions', () => {
  test('multi-line suggestions include selected code with GitLab-style offsets', async ({ page }) => {
    await page.goto('/mrs/101');

    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    await dragSelectAddedLines(page, 4, 6);
    await page.keyboard.press('s');

    await expect(page.locator('.comment-input-overlay')).toBeVisible();
    await expect(page.locator('.comment-input-header')).toContainText('Add comment on new line 4 – 6');

    const expectedSuggestion = [
      '```suggestion:-2+0',
      'function Component() {',
      '  const [active, setActive] = useState(false);',
      '  return <div className="updated">Modified</div>;',
      '```',
      '',
    ].join('\n');

    await expect(page.locator('.comment-textarea')).toHaveValue(expectedSuggestion);
  });
});

test.describe('MR Detail Suggest Edit mode', () => {
  test('editing the diff produces a pre-filled suggestion in the overlay', async ({ page }) => {
    await page.goto('/mrs/101');
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    await enterEditMode(page);

    const confirmBtn = page.locator('.suggest-edit-confirm');
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeDisabled();

    await typeAtEndOfLine(page, 4, ' // edited');

    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    await expect(page.locator('.comment-input-overlay')).toBeVisible();
    const expected = [
      '```suggestion:-0+0',
      'function Component() { // edited',
      '```',
      '',
    ].join('\n');
    await expect(page.locator('.comment-textarea')).toHaveValue(expected);
  });

  test('escape cancels edit mode and reverts content', async ({ page }) => {
    await page.goto('/mrs/101');
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    await enterEditMode(page);
    // typeAtEndOfLine proves the edit landed before the revert assertions —
    // otherwise broken caret placement would make them pass vacuously.
    await typeAtEndOfLine(page, 4, ' // discarded');
    await expect(page.locator('.suggest-edit-confirm')).toBeEnabled();

    await page.keyboard.press('Escape');

    await expect(page.locator('.suggest-edit-btn')).toBeVisible();
    await expect(page.locator('.comment-input-overlay')).not.toBeVisible();
    await expect(page.locator('diffs-container')).not.toContainText('// discarded');
  });

  test('switching files mid-edit discards the edit session', async ({ page }) => {
    await page.goto('/mrs/101');
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    const selectedFile = page.locator('.file-nav-item.selected').first();
    const firstFileName = (await selectedFile.textContent())?.trim() ?? '';

    await enterEditMode(page);
    await typeAtEndOfLine(page, 4, ' // stale');

    // Leave edit mode by selecting another file, then return to the first.
    await page.locator('.file-nav-item:not(.selected)').first().click();
    await expect(page.locator('.suggest-edit-btn')).toBeVisible();
    await page.locator('.file-nav-item').filter({ hasText: firstFileName }).first().click();

    await expect(page.locator('diffs-container')).toBeVisible();
    await expect(page.locator('diffs-container')).not.toContainText('// stale');
    await expect(page.locator('.suggest-edit-btn')).toBeVisible();
  });

  test('file-navigation hotkeys are inert while editing', async ({ page }) => {
    await page.goto('/mrs/101');
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    const activeFile = page.locator('.file-nav-item.selected').first();
    const before = await activeFile.textContent();

    await enterEditMode(page);
    await clickCodeLine(page, 4);
    await page.keyboard.press('j'); // next-file hotkey — must type into the editor instead

    await expect(activeFile).toHaveText(before ?? '');
    await page.keyboard.press('Escape');
    await expect(page.locator('.suggest-edit-btn')).toBeVisible();
  });
});
