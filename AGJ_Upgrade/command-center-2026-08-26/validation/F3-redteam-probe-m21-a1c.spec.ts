import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const record: Record<string, unknown> = {};

// Refresh clicked WHILE a send is still capturing. The rebuild drops the YOU turn,
// but openAgentAfterYouRef stays true, so applyConversationSnapshot's
// "if (lastUserIdx < 0 ...) return list" guard can freeze every later poll.
async function run(page, mutate: boolean, key: string) {
  if (mutate) {
    await page.route('**/app.js*', async route => {
      const res = await route.fetch();
      const original = await res.text();
      const body = original.replace(
        'processRefreshSnapshot(normalizeTerminalOutput(data.output));',
        'processSnapshot(normalizeTerminalOutput(data.output));'
      );
      record[key + '_mutationApplied'] = body !== original;
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
    });
  }
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
  const state = { pane: 'initial output fixture' };
  await page.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [{ session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'bash', activity: 1, busy: false }] }] })
  }));
  await page.route('**/api/tmux/panes/*/output*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ output: state.pane })
  }));
  await page.route('**/api/tmux/panes/*/send*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true })
  }));
  await page.route('**/api/tmux/panes/*/keys*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true })
  }));

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]') as HTMLElement | null;
    if (row) row.click();
  });
  await expect(page.locator('[data-testid="terminal-refresh"]').first()).toBeVisible({ timeout: 15000 });
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('initial output fixture', { timeout: 15000 });

  await page.locator('[data-testid="terminal-composer-input"]').fill('probe interleaved send kappa');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1, { timeout: 20000 });

  // Refresh mid-send (the control is not disabled while sending).
  await page.waitForTimeout(500);
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });

  // The pane moves on afterwards; the 1s poll must surface it.
  state.pane = 'initial output fixture\nPOST REFRESH AGENT TEXT kappa';
  await page.waitForTimeout(6000);
  const after = (await conv.innerText()).trim();
  record[key + '_youTurnsAfter'] = await page.locator('[data-testid="terminal-turn-user"]').count();
  record[key + '_livePollRendered'] = after.includes('POST REFRESH AGENT TEXT kappa');
  record[key + '_afterText'] = after;
  await page.screenshot({ path: path.join(outDir, `F3-m21-${key}.png`), fullPage: true });
}

test('LENS F: refresh mid-send, then does the live poll keep rendering', async ({ page }) => {
  await run(page, false, 'lensF_head');
});

test('LENS G control: same journey with the product line reverted', async ({ page }) => {
  await run(page, true, 'lensG_precommit');
});

test.afterAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'F3-dom-aria-m21-a1c.json'), JSON.stringify(record, null, 2));
});
