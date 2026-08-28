import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const record: Record<string, unknown> = {};

// LENS D — the strongest form of the history question: a YOU bubble created by a
// REAL send through the public composer (no seeded storage), then Refresh.
test('LENS D live send: does Refresh keep the YOU bubble the user just sent', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });

  const state = { pending: null as string | null, pane: 'initial output fixture' };
  await page.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [{ session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'bash', activity: 1, busy: false }] }] })
  }));
  await page.route('**/api/tmux/panes/*/output*', async route => {
    const isRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
    if (isRefresh) {
      const out = state.pending; state.pending = null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: out || state.pane }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: state.pane }) });
  });
  await page.route('**/api/tmux/panes/*/send*', route => route.fulfill({ status: 200, body: 'ok' }));
  await page.route('**/api/tmux/panes/*/keys*', route => route.fulfill({ status: 200, body: 'ok' }));

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]') as HTMLElement | null;
    if (row) row.click();
  });
  await expect(page.locator('[data-testid="terminal-refresh"]').first()).toBeVisible({ timeout: 15000 });

  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('initial output fixture', { timeout: 15000 });

  // Send a real message through the public composer.
  await page.locator('[data-testid="terminal-composer-input"]').fill('probe live sent message omega');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1, { timeout: 20000 });
  await expect(conv).toContainText('probe live sent message omega', { timeout: 20000 });
  const youBefore = await page.locator('[data-testid="terminal-turn-user"]').count();
  await page.screenshot({ path: path.join(outDir, 'F3-m21-lensD-before-refresh.png'), fullPage: true });

  // The pane itself moves on, exactly as a live agent would.
  state.pane = 'initial output fixture\nagent replied to omega';
  state.pending = 'initial output fixture\nagent replied to omega';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });
  await page.waitForTimeout(500);

  const youAfter = await page.locator('[data-testid="terminal-turn-user"]').count();
  const after = (await conv.innerText()).trim();
  const memAfter = await page.evaluate(() => localStorage.getItem('agj_term_mem_TEST_0.0'));
  record['lensD_youTurnsBefore'] = youBefore;
  record['lensD_youTurnsAfter'] = youAfter;
  record['lensD_afterText'] = after;
  record['lensD_sentMessageSurvived'] = after.includes('probe live sent message omega');
  record['lensD_memoryAfterRefresh'] = memAfter;
  await page.screenshot({ path: path.join(outDir, 'F3-m21-lensD-after-refresh.png'), fullPage: true });
});


// LENS E — control: the SAME journey with this commit's one product line reverted.
// If the YOU bubble survives here but not in LENS D, the loss is introduced by this diff.
test('LENS E control: pre-commit refreshOutput keeps the YOU bubble', async ({ page }) => {
  let mutated = false;
  await page.route('**/app.js*', async route => {
    const res = await route.fetch();
    const original = await res.text();
    const body = original.replace(
      'processRefreshSnapshot(normalizeTerminalOutput(data.output));',
      'processSnapshot(normalizeTerminalOutput(data.output));'
    );
    mutated = body !== original;
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  });
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
  const state = { pending: null as string | null, pane: 'initial output fixture' };
  await page.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [{ session_name: 'TEST', panes: [{ target: 'TEST:0.0', command: 'bash', activity: 1, busy: false }] }] })
  }));
  await page.route('**/api/tmux/panes/*/output*', async route => {
    const isRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
    if (isRefresh) {
      const out = state.pending; state.pending = null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: out || state.pane }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: state.pane }) });
  });
  await page.route('**/api/tmux/panes/*/send*', route => route.fulfill({ status: 200, body: 'ok' }));
  await page.route('**/api/tmux/panes/*/keys*', route => route.fulfill({ status: 200, body: 'ok' }));

  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]') as HTMLElement | null;
    if (row) row.click();
  });
  await expect(page.locator('[data-testid="terminal-refresh"]').first()).toBeVisible({ timeout: 15000 });
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('initial output fixture', { timeout: 15000 });
  await page.locator('[data-testid="terminal-composer-input"]').fill('probe live sent message omega');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1, { timeout: 20000 });
  state.pane = 'initial output fixture\nagent replied to omega';
  state.pending = 'initial output fixture\nagent replied to omega';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });
  await page.waitForTimeout(500);
  const youAfter = await page.locator('[data-testid="terminal-turn-user"]').count();
  const after = (await conv.innerText()).trim();
  record['lensE_mutationApplied'] = mutated;
  record['lensE_youTurnsAfter'] = youAfter;
  record['lensE_sentMessageSurvived'] = after.includes('probe live sent message omega');
  record['lensE_afterText'] = after;
  await page.screenshot({ path: path.join(outDir, 'F3-m21-lensE-control-after.png'), fullPage: true });
});

test.afterAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'F3-dom-aria-m21-a1b.json'), JSON.stringify(record, null, 2));
});
