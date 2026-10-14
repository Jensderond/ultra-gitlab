/**
 * `src/main.tsx` loads the chosen UI (classic or native) as a separate chunk,
 * so React mounts a moment after the page's load event — later than
 * `page.goto()` resolves. Tests that press shortcuts straight after
 * navigating would race the app's key listeners, so make `goto`/`reload`
 * also wait until the app has rendered something.
 */

import type { Page } from '@playwright/test';

export function waitForAppOnNavigate(page: Page) {
  const mounted = () => page.waitForFunction(() => !!document.getElementById('root')?.firstElementChild);
  const goto = page.goto.bind(page);
  const reload = page.reload.bind(page);
  page.goto = async (...args) => {
    const response = await goto(...args);
    await mounted();
    return response;
  };
  page.reload = async (...args) => {
    const response = await reload(...args);
    await mounted();
    return response;
  };
}
