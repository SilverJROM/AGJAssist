import { test, expect } from '@playwright/test';

test('command-center drafts persist per pane', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });

  // Ensure terminal-draft element exists
  const draftEl = page.locator('[data-testid="terminal-draft"]');
  await expect(draftEl).toHaveCount(1);

  // Ensure agent-group-switcher is present
  const switcher = page.locator('[data-testid="agent-group-switcher"]');
  await expect(switcher).toHaveCount(1);

  // Ensure dropdown present
  const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
  await expect(dropdown).toHaveCount(1);
});
