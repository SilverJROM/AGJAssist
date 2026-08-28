import { test, expect } from '@playwright/test';

test('FIXCHECK: shipped journey with a per-test timeout override', async ({ page }) => {
  // The journey itself is ~10s of deliberate waits; page mount on this shared box has been
  // measured between 1.2s and 16.9s. 30000ms leaves no headroom.
  test.setTimeout(90000);
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
  let nonRefreshOutput = 'initial output fixture';
  let delayRefreshResponse = true;
  await page.route('**/api/tmux/panes/*/output*', async route => {
    outputCallCount++;
    const isExplicitRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
    if (!isExplicitRefresh) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ output: nonRefreshOutput })
      });
      return;
    }
    if (!pendingRefreshOutput) {
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
    if (delayRefreshResponse) await new Promise(r => setTimeout(r, 1200));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output })
    });
  });

  await page.route('**/api/tmux/panes/*/send*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
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

  // Initial output fixture must be rendered
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('initial output fixture', { timeout: 10000 });

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
  await expect(page.locator('[data-testid="terminal-conversation"]')).not.toContainText('initial output fixture');

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
  // Verify search-open refresh replaces transcript
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('search refresh output fixture', { timeout: 10000 });
  await expect(page.locator('[data-testid="terminal-conversation"]')).not.toContainText('initial output fixture');
  expect(searchRefreshOutputServed).toBe(true);

  // History preservation: YOU turn must survive refresh
  const sendBtn = page.locator('[data-testid="terminal-send-command"]');
  await composer.fill('you-turn fixture');
  await sendBtn.click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1);
  // Allow send to settle before refreshing
  await page.waitForTimeout(3000);
  pendingRefreshOutput = 'refreshed after you fixture';
  await refreshBtn.click();
  await expect(refreshStatus).toContainText('Updated', { timeout: 10000 });
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('you-turn fixture');

  // Freeze prevention: background poll must still reach the transcript after refresh
  nonRefreshOutput = 'refreshed after you fixture\npost refresh poll fixture';
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('post refresh poll fixture', { timeout: 10000 });

  // Freeze prevention: refresh clicked WHILE the send is still capturing.
  // This capture exits early (~1.15s) because the pane output changes right before send;
  // the immediate refresh response lands while openAgentAfterYouRef is still set.
  nonRefreshOutput = 'initial output fixture';
  await composer.fill('midsend fixture');
  await sendBtn.click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(2);
  await page.waitForTimeout(400);                       // NO settle wait — that is the point
  delayRefreshResponse = false;   // land the rebuild INSIDE the send window
  pendingRefreshOutput = 'initial output fixture\nmidsend refresh body fixture';
  await refreshBtn.click();
  await expect(refreshStatus).toContainText('Updated', { timeout: 10000 });
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('midsend refresh body fixture', { timeout: 10000 });
  // The pane moves on; only the 1s background poll can deliver this literal.
  nonRefreshOutput = 'initial output fixture\nmidsend refresh body fixture\nmidsend poll fixture';
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('midsend poll fixture', { timeout: 10000 });
});
