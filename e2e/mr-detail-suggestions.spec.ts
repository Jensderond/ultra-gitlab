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
