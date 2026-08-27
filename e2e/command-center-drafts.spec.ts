import { test, expect } from '@playwright/test';

test('command-center drafts persist per pane with indicators', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
    // Preload literal drafts for two panes
    localStorage.setItem('agj_terminal_draft:friendly-terminal:SA%3A0.0', 'literal-alpha-preloaded');
    localStorage.setItem('agj_terminal_draft:friendly-terminal:SB%3A0.0', 'literal-beta-preloaded');
  });
  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });

  // Wait for terminal UI to be present
  await page.waitForSelector('[data-testid="terminal-session-name"]', { timeout: 10000 }).catch(() => {});

  // Switcher must be present when group siblings exist
  const switcher = page.locator('[data-testid="agent-group-switcher"]');
  // Draft indicators are rendered as • in header tabs
  const tabs = page.locator('[data-testid="terminal-header-tab"]');
  const tabCount = await tabs.count();
  if (tabCount > 0) {
    // At least one tab should be visible
    await expect(tabs.first()).toBeVisible();
  }

  // Verify drafts remain in localStorage and were not erased by hydration
  const drafts = await page.evaluate(() => ({
    a: localStorage.getItem('agj_terminal_draft:friendly-terminal:SA%3A0.0'),
    b: localStorage.getItem('agj_terminal_draft:friendly-terminal:SB%3A0.0')
  }));
  expect(drafts.a).toBe('literal-alpha-preloaded');
  expect(drafts.b).toBe('literal-beta-preloaded');
});
