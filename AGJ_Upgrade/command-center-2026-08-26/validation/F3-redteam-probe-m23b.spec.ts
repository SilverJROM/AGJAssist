import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const record: Record<string, unknown> = {};
const M2_NEEDLE = "openAgentAfterYouRef.current = false;\n    sendBaselineRef.current = '';";

// Sharper specimen than LENS 2: the mid-send refresh returns NEW pane content, so the
// rebuild actually OPENS an agent entry after the kept YOU turn. That is the shape in
// which `lastUserIdx < lastAgentIdx` becomes true while openAgentAfterYouRef is still set.
async function midSendRefreshWithNewBody(page, key: string, mutate: boolean) {
  if (mutate) {
    await page.route('**/app.js*', async route => {
      const res = await route.fetch();
      const original = await res.text();
      record[key + '_mutationHits'] = original.split(M2_NEEDLE).length - 1;
      const body = original.split(M2_NEEDLE).join('');
      record[key + '_mutationApplied'] = body !== original;
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
    });
  }
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
  const state = { pane: 'initial output fixture', pending: null as string | null };
  await page.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [{ session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'bash', activity: 1, busy: false }] }] })
  }));
  await page.route('**/api/tmux/panes/*/output*', async route => {
    const isRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
    if (isRefresh) { const out = state.pending; state.pending = null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: out || state.pane }) }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: state.pane }) });
  });
  await page.route('**/api/tmux/panes/*/send*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.route('**/api/tmux/panes/*/keys*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]') as HTMLElement | null;
    if (row) row.click();
  });
  await expect(page.locator('[data-testid="terminal-refresh"]').first()).toBeVisible({ timeout: 15000 });
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('initial output fixture', { timeout: 15000 });

  await page.locator('[data-testid="terminal-composer-input"]').fill('probe midsend body rho');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1, { timeout: 20000 });

  await page.waitForTimeout(400);
  state.pending = 'initial output fixture\nREFRESH BODY rho';   // NEW content -> opens an agent after YOU
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });
  await expect(conv).toContainText('REFRESH BODY rho', { timeout: 10000 });

  state.pane = 'initial output fixture\nREFRESH BODY rho\nPOST REFRESH POLL rho';
  await page.waitForTimeout(6000);
  const after = (await conv.innerText()).trim();
  record[key + '_youTurnsAfter'] = await page.locator('[data-testid="terminal-turn-user"]').count();
  record[key + '_livePollRendered'] = after.includes('POST REFRESH POLL rho');
  record[key + '_afterText'] = after;
  await page.screenshot({ path: path.join(outDir, `F3-m23-${key}.png`), fullPage: true });
}

test('LENS 5 HEAD: mid-send refresh WITH new body, live poll must keep flowing', async ({ page }) => {
  await midSendRefreshWithNewBody(page, 'lens5_head', false);
});

test('LENS 6 M2 mutant: same, with the send-ref resets removed', async ({ page }) => {
  await midSendRefreshWithNewBody(page, 'lens6_m2', true);
});

test.afterAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'F3-dom-aria-m23-a3b.json'), JSON.stringify(record, null, 2));
});
