import { test, expect } from './fixtures/test-base';

const JOB_LOG_URL =
  '/pipelines/10/3001/jobs/7001?instance=1&name=lint&status=success&stage=test';

/**
 * Override the mocked get_job_trace with a massive trace (~20k lines, >1MB)
 * including collapsible sections, to exercise log virtualization.
 */
async function mockMassiveTrace(page: import('@playwright/test').Page, lineCount: number) {
  await page.addInitScript((count: number) => {
    const lines: string[] = [];
    lines.push('section_start:1700000000:prepare_executor\r\x1b[0K\x1b[36mPreparing executor\x1b[0m');
    for (let i = 0; i < 50; i++) {
      lines.push(`Pulling docker image registry.example.com/build:latest layer ${i}`);
    }
    lines.push('section_end:1700000042:prepare_executor\r\x1b[0K');
    lines.push('section_start:1700000042:build_script\r\x1b[0K\x1b[36mRunning build\x1b[0m');
    for (let i = 0; i < count; i++) {
      lines.push(`\x1b[32m[build]\x1b[0m compiling module ${i} of ${count} — some fairly long log output line to add weight`);
    }
    lines.push('section_end:1700000999:build_script\r\x1b[0K');
    lines.push('Job succeeded');
    const trace = lines.join('\n');

    // The tauri-mock init script has already installed __TAURI_INTERNALS__;
    // wrap its invoke to serve the massive trace.
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    const originalInvoke = internals.invoke;
    internals.invoke = async (cmd, args) => {
      if (cmd === 'get_job_trace') return trace;
      return originalInvoke(cmd, args);
    };
  }, lineCount);
}

test.describe('Job Log Page (virtualized)', () => {
  test('renders a massive log without freezing, keeping DOM size bounded', async ({ page }) => {
    await mockMassiveTrace(page, 20_000);
    await page.goto(JOB_LOG_URL);

    await expect(page.locator('.job-log-trace')).toBeVisible();
    await expect(page.locator('.log-line').first()).toBeVisible();

    // Virtualization: only a window of the ~20k lines is in the DOM
    const renderedLines = await page.locator('.log-line').count();
    expect(renderedLines).toBeGreaterThan(0);
    expect(renderedLines).toBeLessThan(300);

    // The UI stays interactive: the follow toggle responds to a click
    const followBtn = page.locator('.job-log-follow-btn');
    await followBtn.click();
    await expect(followBtn).toHaveClass(/job-log-follow-btn--active/);
  });

  test('scrolling to the bottom reaches the last line', async ({ page }) => {
    await mockMassiveTrace(page, 20_000);
    await page.goto(JOB_LOG_URL);
    await expect(page.locator('.log-line').first()).toBeVisible();

    // Scroll the virtualized list to the bottom (repeatedly, since total
    // height is re-estimated as dynamic rows are measured)
    await expect(async () => {
      await page.evaluate(() => {
        const el = document.querySelector('.job-log-trace > div');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await expect(page.getByText('Job succeeded')).toBeVisible({ timeout: 1000 });
    }).toPass();

    // DOM is still windowed at the bottom
    const renderedLines = await page.locator('.log-line').count();
    expect(renderedLines).toBeLessThan(300);
  });

  test('collapsing a section removes its lines from the list', async ({ page }) => {
    await mockMassiveTrace(page, 20_000);
    await page.goto(JOB_LOG_URL);

    const prepareHeader = page.locator('.log-section-header', { hasText: 'Prepare Executor' });
    await expect(prepareHeader).toBeVisible();
    await expect(prepareHeader).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Pulling docker image', { exact: false }).first()).toBeVisible();

    await prepareHeader.click();

    await expect(prepareHeader).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Pulling docker image', { exact: false })).toHaveCount(0);
  });

  test('small logs still render completely', async ({ page }) => {
    await page.goto(JOB_LOG_URL); // default mock: 3 short lines

    await expect(page.getByText('Job log output mock')).toBeVisible();
    await expect(page.getByText('Line 3')).toBeVisible();
    await expect(page.locator('.log-line')).toHaveCount(3);
  });
});
