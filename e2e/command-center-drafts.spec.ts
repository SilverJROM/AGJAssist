import { test, expect } from '@playwright/test';

test('command-center drafts persist per pane with indicators', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
    localStorage.setItem('agj_terminal_draft:friendly-terminal:SA%3A0.0', 'literal-alpha-preloaded');
    localStorage.setItem('agj_terminal_draft:friendly-terminal:SB%3A0.0', 'literal-beta-preloaded');
    localStorage.setItem('agj_terminal_groups', JSON.stringify([{ id: 'g1', name: 'Group1', sessions: ['SA','SB'] }]));
  });

  await page.route('**/api/tmux/sessions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          { session_name: 'SA', panes: [{ target: 'SA:0.0', command: '', activity: 0, busy: false }] },
          { session_name: 'SB', panes: [{ target: 'SB:0.0', command: '', activity: 0, busy: false }] }
        ]
      })
    });
  });

  await page.route('**/api/tmux/panes/*/output*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '' }) });
  });

  await page.route('**/api/tmux/panes/*/send*', async route => {
    await route.fulfill({ status: 200, body: 'ok' });
  });

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('.terminal-list-name', { timeout: 10000 });

  // Click SA row
  await page.locator('.terminal-list-name').filter({ hasText: 'SA' }).first().click();

  const composer = page.locator('[data-testid="terminal-composer-input"]');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue('literal-alpha-preloaded');

  // Sibling tab for SB with draft marker
  const tabSB = page.locator('[data-testid="terminal-header-tab"]').filter({ hasText: /SB/ });
  await expect(tabSB).toBeVisible();
  await expect(tabSB).toContainText('•');

  // Edit SA draft
  await composer.fill('literal-alpha-live');

  // Switch to SB via public switcher
  await tabSB.click();
  await expect(composer).toHaveValue('literal-beta-preloaded');

  // Edit SB draft
  await composer.fill('literal-beta-live');

  // Switch back to SA
  const tabSA = page.locator('[data-testid="terminal-header-tab"]').filter({ hasText: /SA/ });
  await tabSA.click();
  await expect(composer).toHaveValue('literal-alpha-live');

  // Send SA
  await page.locator('[data-testid="terminal-send-command"]').click();
  await page.waitForTimeout(500);

  // Switch to SB again, draft should persist
  await tabSB.click();
  await expect(composer).toHaveValue('literal-beta-live');

  // SA draft should be cleared from storage
  const saDraft = await page.evaluate(() => localStorage.getItem('agj_terminal_draft:friendly-terminal:SA%3A0.0'));
  expect(saDraft).toBeNull();

  // SB draft should still exist
  const sbDraft = await page.evaluate(() => localStorage.getItem('agj_terminal_draft:friendly-terminal:SB%3A0.0'));
  expect(sbDraft).toBe('literal-beta-live');
});
