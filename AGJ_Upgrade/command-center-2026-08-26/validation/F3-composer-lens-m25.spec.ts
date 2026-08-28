import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const record: Record<string, unknown> = {};

// SCOPE LENS: "composer stays interactive". The shipped spec only asserts the composer RETAINS
// its value across a refresh. This types into it WHILE the refresh is in flight and after it,
// through the public control, and checks the text actually lands.
test('LENS 7: composer accepts typing during and after an in-flight refresh', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
  let pending: string | null = null;
  await page.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [{ session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'bash', activity: 1, busy: false }] }] })
  }));
  await page.route('**/api/tmux/panes/*/output*', async route => {
    const isRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
    if (isRefresh && pending) {
      const out = pending; pending = null;
      await new Promise(r => setTimeout(r, 2500));   // hold the refresh in flight
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: out }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: 'initial output fixture' }) });
  });
  await page.route('**/api/tmux/panes/*/send*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 30000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]') as HTMLElement | null;
    if (row) row.click();
  });
  const composer = page.locator('[data-testid="terminal-composer-input"]');
  await expect(composer).toBeVisible({ timeout: 30000 });

  pending = 'refreshed output fixture';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Refreshing');

  // IN FLIGHT: type through the public control.
  await composer.fill('typed-while-refreshing');
  record['duringRefresh_editable'] = await composer.isEditable();
  record['duringRefresh_value'] = await composer.inputValue();
  await page.screenshot({ path: path.join(outDir, 'F3-m25-lens7-during-refresh.png'), fullPage: true });

  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 20000 });
  record['afterRefresh_valueKept'] = await composer.inputValue();
  await composer.fill('typed-after-refreshing');
  record['afterRefresh_editable'] = await composer.isEditable();
  record['afterRefresh_value'] = await composer.inputValue();
  record['afterRefresh_sendEnabled'] = await page.locator('[data-testid="terminal-send-command"]').isEnabled();
  await page.screenshot({ path: path.join(outDir, 'F3-m25-lens7-after-refresh.png'), fullPage: true });
  fs.writeFileSync(path.join(outDir, 'F3-dom-aria-m25-a5c.json'), JSON.stringify(record, null, 2));
});
