import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation/F3-netprobe-m24.jsonl');

test('NETPROBE: what does the mount phase wait on', async ({ page }) => {
  test.setTimeout(120000);
  const T0 = Date.now();
  const ext: Record<string, number> = {};
  page.on('requestfinished', req => {
    const u = req.url();
    if (/esm\.sh|telegram\.org|jsdelivr/.test(u)) {
      let ms = -1;
      try { ms = Math.round(req.timing().responseEnd); } catch {}
      ext[u.replace(/\?.*$/, '')] = ms;
    }
  });
  page.on('requestfailed', req => {
    const u = req.url();
    if (/esm\.sh|telegram\.org|jsdelivr/.test(u)) ext['FAILED ' + u.replace(/\?.*$/, '')] = Date.now() - T0;
  });

  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
  await page.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [{ session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'bash', activity: 0, busy: false }] }] })
  }));
  await page.route('**/api/tmux/panes/*/output*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ output: 'initial output fixture' })
  }));

  const tGoto = Date.now() - T0;
  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  const tDom = Date.now() - T0;
  await page.waitForSelector('.terminal-list-name', { timeout: 30000 });
  const tList = Date.now() - T0;
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 30000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]') as HTMLElement | null;
    if (row) row.click();
  });
  await expect(page.locator('[data-testid="terminal-refresh"]').first()).toBeVisible({ timeout: 30000 });
  const tMount = Date.now() - T0;
  fs.appendFileSync(OUT, JSON.stringify({ tGoto, tDomContentLoaded: tDom, tListRendered: tList, tViewMounted: tMount, external: ext }) + '\n');
});
