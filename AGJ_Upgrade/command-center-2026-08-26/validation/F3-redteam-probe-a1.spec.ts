import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');

test('F3 validation probe records refresh reachability and request behavior', async ({ page }) => {
  let sessionCalls = 0;
  let outputCalls = 0;

  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
    localStorage.setItem('agj_terminal_draft:friendly-terminal:TEST%3A0.0', 'keep-me');
  });

  await page.route('**/api/tmux/sessions', async route => {
    sessionCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{
          session_name: 'TEST',
          panes: [{
            target: 'TEST:0.0',
            command: sessionCalls === 1 ? 'bash' : 'zsh',
            activity: sessionCalls === 1 ? 1 : 99,
            busy: sessionCalls > 1
          }]
        }]
      })
    });
  });

  await page.route('**/api/tmux/panes/*/output*', async route => {
    outputCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: outputCalls === 1 ? 'initial output fixture' : 'refreshed output fixture'
      })
    });
  });

  await page.route('**/api/tmux/panes/*/send*', async route => {
    await route.fulfill({ status: 200, body: 'ok' });
  });

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 10000 });
  await page.click('[data-testid="terminal-session-row"]');
  await page.waitForSelector('[data-testid="terminal-refresh"]', { timeout: 10000 });

  const before = {
    refreshVisible: await page.locator('[data-testid="terminal-refresh"]').isVisible(),
    composerValue: await page.locator('[data-testid="terminal-composer-input"]').inputValue(),
    statusText: await page.locator('[data-testid="terminal-status"]').textContent(),
    lastUpdated: await page.locator('[data-testid="terminal-last-updated"]').textContent(),
    sessionCalls,
    outputCalls
  };

  await page.click('[data-testid="terminal-search-toggle"]');
  await page.waitForSelector('[data-testid="terminal-search-bar"]');
  const whileSearchOpen = {
    refreshCount: await page.locator('[data-testid="terminal-refresh"]').count(),
    searchBarVisible: await page.locator('[data-testid="terminal-search-bar"]').isVisible()
  };
  await page.click('[data-testid="terminal-search-close"]');

  await page.screenshot({ path: path.join(outDir, 'F3-refresh-before-a1.png'), fullPage: true });
  await page.click('[data-testid="terminal-refresh"]');
  await page.waitForFunction(() => window.__f3Done === true, null, { timeout: 100 }).catch(() => {});
  await page.waitForTimeout(250);

  const after = {
    refreshVisible: await page.locator('[data-testid="terminal-refresh"]').isVisible(),
    composerValue: await page.locator('[data-testid="terminal-composer-input"]').inputValue(),
    statusText: await page.locator('[data-testid="terminal-status"]').textContent(),
    lastUpdated: await page.locator('[data-testid="terminal-last-updated"]').textContent(),
    sessionCalls,
    outputCalls
  };

  await page.screenshot({ path: path.join(outDir, 'F3-refresh-after-a1.png'), fullPage: true });
  const aria = await page.locator('body').evaluate(body => {
    const buttons = [...body.querySelectorAll('button')].map(button => ({
      testid: button.getAttribute('data-testid'),
      ariaLabel: button.getAttribute('aria-label'),
      disabled: button.hasAttribute('disabled'),
      text: button.textContent?.trim() || ''
    }));
    return { buttons, text: body.textContent?.replace(/\s+/g, ' ').trim() };
  });

  fs.writeFileSync(
    path.join(outDir, 'F3-dom-aria-a1.json'),
    JSON.stringify({ before, whileSearchOpen, after, aria }, null, 2)
  );
});
