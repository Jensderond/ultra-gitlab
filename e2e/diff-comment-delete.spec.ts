import { test, expect } from './fixtures/test-base';

/**
 * E2E tests for comment deletion in the MRDetailPage diff viewer.
 *
 * MR 101 has inline comments on ThemeToggle.tsx:
 * - carol (id 5002) at line 5: "Could we add a system preference detection here?"
 * - testuser (id 5004) at line 6: "We should memoize this callback to avoid re-renders."
 *
 * Current user is "testuser" (from seed instances).
 */

/** Helper: find annotation elements inside Pierre's shadow DOM. */
async function findAnnotations(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const container = document.querySelector('diffs-container');
    if (!container?.shadowRoot) return [];

    // Pierre renders annotation content into the shadow DOM
    // Walk the entire shadow DOM tree looking for our annotation divs
    const results: Array<{
      text: string;
      hasDeleteBtn: boolean;
      author: string;
    }> = [];

    const walk = (root: Node) => {
      if (root instanceof HTMLElement) {
        if (root.classList.contains('pierre-annotation-comment')) {
          const author = root.querySelector('strong')?.textContent || '';
          const hasDeleteBtn = root.querySelector('.annotation-delete-btn') !== null;
          results.push({ text: root.textContent || '', hasDeleteBtn, author });
        }
      }
      // Check children
      if (root instanceof HTMLElement || root instanceof DocumentFragment) {
        for (const child of root.childNodes) {
          walk(child);
        }
      }
    };

    walk(container.shadowRoot);

    // If nothing found in shadow DOM, check light DOM as fallback
    if (results.length === 0) {
      document.querySelectorAll('.pierre-annotation-comment').forEach((el) => {
        const author = el.querySelector('strong')?.textContent || '';
        const hasDeleteBtn = el.querySelector('.annotation-delete-btn') !== null;
        results.push({ text: el.textContent || '', hasDeleteBtn, author });
      });
    }

    return results;
  });
}

test.describe('Diff Viewer Comment Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs/101');

    // Select ThemeToggle.tsx which has inline comments
    await page.locator('.mr-detail-sidebar').getByText('ThemeToggle.tsx').click();

    // Wait for Pierre diff to render
    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    // Wait for both annotation comments to appear
    await expect.poll(async () => {
      const annotations = await findAnnotations(page);
      return annotations.length;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });

  test('shows delete button only on own comments', async ({ page }) => {
    const annotations = await findAnnotations(page);

    // Carol's comment should NOT have a delete button
    const carolAnnotation = annotations.find((a) => a.text.includes('system preference detection'));
    expect(carolAnnotation).toBeDefined();
    expect(carolAnnotation!.hasDeleteBtn).toBe(false);

    // Testuser's comment SHOULD have a delete button
    const testUserAnnotation = annotations.find((a) => a.text.includes('memoize this callback'));
    expect(testUserAnnotation).toBeDefined();
    expect(testUserAnnotation!.hasDeleteBtn).toBe(true);
  });

  test('deletes comment when delete button is clicked', async ({ page }) => {
    // Verify testuser's comment exists
    let annotations = await findAnnotations(page);
    expect(annotations.find((a) => a.text.includes('memoize this callback'))).toBeDefined();

    // Hover over testuser's comment to reveal delete button, then click it
    // Use Playwright's built-in shadow DOM piercing with text matching
    const testUserComment = page.locator('.pierre-annotation-comment', { hasText: 'memoize this callback' });
    await testUserComment.hover();
    await testUserComment.locator('.annotation-delete-btn').click();

    // Comment should be removed after deletion
    await expect.poll(async () => {
      const anns = await findAnnotations(page);
      return anns.some((a) => a.text.includes('memoize this callback'));
    }, { timeout: 5_000 }).toBe(false);

    // Carol's comment should still be present
    annotations = await findAnnotations(page);
    expect(annotations.find((a) => a.text.includes('system preference detection'))).toBeDefined();
  });

  test('does not show delete button for other users comments', async ({ page }) => {
    const annotations = await findAnnotations(page);

    const carolAnnotation = annotations.find((a) => a.text.includes('system preference detection'));
    expect(carolAnnotation).toBeDefined();
    expect(carolAnnotation!.hasDeleteBtn).toBe(false);
    expect(carolAnnotation!.author).toBe('carol');
  });
});
