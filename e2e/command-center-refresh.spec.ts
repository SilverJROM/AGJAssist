import { test, expect } from '@playwright/test';

test('command-center refresh control is always reachable and re-pulls output and session metadata', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
    localStorage.setItem('agj_terminal_draft:friendly-terminal:TEST%3A0.0', 'keep-me');
  });

  let sessionsCallCount = 0;
  await page.route('**/api/tmux/sessions', async route => {
    sessionsCallCount++;
    if (sessionsCallCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            { session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'bash', activity: 0, busy: false }] }
          ]
        })
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            { session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'zsh', activity: 99, busy: false }] }
          ]
        })
      });
    }
  });

  let outputCallCount = 0;
  let pendingRefreshOutput = null;
  let searchRefreshOutputServed = false;
  await page.route('**/api/tmux/panes/*/output*', async route => {
    outputCallCount++;
    const isExplicitRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
    if (!isExplicitRefresh || !pendingRefreshOutput) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ output: '' })
      });
      return;
    }

    const output = pendingRefreshOutput;
    pendingRefreshOutput = null;
    if (output === 'search refresh output fixture') searchRefreshOutputServed = true;
    // Keep the response pending long enough to observe the public busy state.
    await new Promise(r => setTimeout(r, 1200));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output })
    });
  });

  await page.route('**/api/tmux/panes/*/send*', async route => {
    await route.fulfill({ status: 200, body: 'ok' });
  });

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.terminal-list-name', { timeout: 10000 });

  // Open first terminal session row
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 10000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]');
    if (row) row.click();
  });

  // Wait for FriendlyTerminalView to mount
  const refreshBtn = page.locator('[data-testid="terminal-refresh"]');
  await expect(refreshBtn).toBeVisible({ timeout: 10000 });

  const composer = page.locator('[data-testid="terminal-composer-input"]');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue('keep-me');

  const refreshStatus = page.locator('[data-testid="terminal-refresh-status"]');

  // The second literal output fixture belongs to the normal-topbar refresh.
  pendingRefreshOutput = 'refreshed output fixture';

  // Click refresh without force
  await refreshBtn.click();

  // Assert in-progress state
  await expect(refreshBtn).toBeDisabled();
  await expect(refreshBtn).toHaveAttribute('aria-busy', 'true');
  await expect(refreshStatus).toContainText('Refreshing');
  // Updated should not be present yet while output is delayed
  await expect(refreshStatus).not.toContainText('Updated');

  // Wait for refresh to complete: status becomes Updated
  await expect(refreshStatus).toContainText('Updated', { timeout: 10000 });

  // Composer must stay interactive and retain value
  await expect(composer).toHaveValue('keep-me');

  // Verify request counts increased
  expect(sessionsCallCount).toBeGreaterThanOrEqual(2);
  expect(outputCallCount).toBeGreaterThanOrEqual(2);

  // Verify UI reflects second fixtures: output appears in transcript
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('refreshed output fixture', { timeout: 10000 });

  // Search-open uses the same persistent refresh cluster, including live status.
  const searchToggle = page.locator('[data-testid="terminal-search-toggle"]');
  await searchToggle.click();
  const searchBar = page.locator('[data-testid="terminal-search-bar"]');
  await expect(searchBar).toBeVisible();
  const refreshBtnInSearch = searchBar.locator('[data-testid="terminal-refresh"]');
  const refreshStatusInSearch = searchBar.locator('[data-testid="terminal-refresh-status"]');
  await expect(refreshBtnInSearch).toHaveCount(1);
  await expect(refreshStatusInSearch).toHaveCount(1);
  await expect(refreshBtnInSearch).toBeVisible();
  await expect(refreshBtnInSearch).toBeEnabled();
  await expect(refreshStatusInSearch).toBeVisible();

  // The third literal output fixture proves the search-open control drives its lifecycle.
  pendingRefreshOutput = 'search refresh output fixture';
  await refreshBtnInSearch.click();
  await expect(refreshBtnInSearch).toBeDisabled();
  await expect(refreshBtnInSearch).toHaveAttribute('aria-busy', 'true');
  await expect(refreshStatusInSearch).toContainText('Refreshing');
  await expect(refreshStatusInSearch).not.toContainText('Updated');
  await expect(refreshStatusInSearch).toContainText('Updated', { timeout: 10000 });
  expect(searchRefreshOutputServed).toBe(true);
});
