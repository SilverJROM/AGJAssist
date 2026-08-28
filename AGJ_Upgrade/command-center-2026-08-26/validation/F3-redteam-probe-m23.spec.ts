import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const record: Record<string, unknown> = {};

const M2_NEEDLE = "openAgentAfterYouRef.current = false;\n    sendBaselineRef.current = '';";

async function mutateM2(page, key: string) {
  await page.route('**/app.js*', async route => {
    const res = await route.fetch();
    const original = await res.text();
    const hits = original.split(M2_NEEDLE).length - 1;
    const body = original.split(M2_NEEDLE).join('');
    record[key + '_mutationHits'] = hits;
    record[key + '_mutationApplied'] = body !== original;
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  });
}

async function boot(page, state: { pane: string; pending?: string | null }) {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
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
}

// The mid-send specimen: Refresh is NOT disabled while a send is capturing, so the
// user can click it before the send settles. This is the case the shipped spec's
// `waitForTimeout(3000)` ("allow send to settle") steps around.
async function midSendRefresh(page, key: string) {
  const state = { pane: 'initial output fixture', pending: null as string | null };
  await boot(page, state);
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('initial output fixture', { timeout: 15000 });

  await page.locator('[data-testid="terminal-composer-input"]').fill('probe interleaved send kappa');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1, { timeout: 20000 });

  await page.waitForTimeout(500); // still inside captureCommandResult
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });

  state.pane = 'initial output fixture\nPOST REFRESH AGENT TEXT kappa';
  await page.waitForTimeout(6000); // 6+ background poll cycles
  const after = (await conv.innerText()).trim();
  record[key + '_youTurnsAfter'] = await page.locator('[data-testid="terminal-turn-user"]').count();
  record[key + '_livePollRendered'] = after.includes('POST REFRESH AGENT TEXT kappa');
  record[key + '_afterText'] = after;
  await page.screenshot({ path: path.join(outDir, `F3-m23-${key}.png`), fullPage: true });
}

test('LENS 1 HEAD: refresh mid-send keeps the YOU turn and the live poll alive', async ({ page }) => {
  await midSendRefresh(page, 'lens1_head_midsend');
});

test('LENS 2 M2 mutant: same mid-send journey with the send-ref resets removed', async ({ page }) => {
  await mutateM2(page, 'lens2_m2');
  await midSendRefresh(page, 'lens2_m2_midsend');
});

// With a YOU turn present, the refresh must still REPLACE the stale agent tail
// rather than keep or duplicate it — that was the whole point of the F3 fix.
test('LENS 3 HEAD: refresh replaces the agent tail even when a YOU turn is kept', async ({ page }) => {
  const state = { pane: 'initial output fixture\nAGENT REPLY ONE', pending: null as string | null };
  await boot(page, state);
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('AGENT REPLY ONE', { timeout: 15000 });

  await page.locator('[data-testid="terminal-composer-input"]').fill('probe replace tail sigma');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1, { timeout: 20000 });
  await page.waitForTimeout(4000); // let the send settle, agent entry opens after YOU
  const mid = (await conv.innerText()).trim();

  // The pane has moved on: REPLY ONE is gone from the capture window entirely.
  state.pane = 'AGENT REPLY TWO ONLY';
  state.pending = 'AGENT REPLY TWO ONLY';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });
  await page.waitForTimeout(800);
  const after = (await conv.innerText()).trim();
  record['lens3_midText'] = mid;
  record['lens3_afterText'] = after;
  record['lens3_youTurnsAfter'] = await page.locator('[data-testid="terminal-turn-user"]').count();
  record['lens3_showsReplyTwo'] = after.includes('AGENT REPLY TWO ONLY');
  record['lens3_staleReplyOneGone'] = !after.includes('AGENT REPLY ONE');
  record['lens3_youTextKept'] = after.includes('probe replace tail sigma');
  await page.screenshot({ path: path.join(outDir, 'F3-m23-lens3-tail-replace.png'), fullPage: true });
});

// A YOU message that failed to send carries the ONLY recovery affordance
// (resendText + the "↻ Resend" button). Refresh must not eat it.
test('LENS 4 HEAD: a failed YOU turn and its Resend affordance survive refresh', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_term_mem_TEST_0.0', JSON.stringify({
      entries: [
        { id: 'you-failed', role: 'user', label: 'YOU', content: 'undelivered message tau', timestamp: '10:00:00',
          failed: true, resendText: 'undelivered message tau', failReason: 'Not sent' },
        { id: 'agent-old', role: 'agent', label: 'Agent', content: 'stale agent tail tau', timestamp: '10:00:01' }
      ],
      updatedAt: Date.now()
    }));
  });
  const state = { pane: 'initial output fixture', pending: null as string | null };
  await boot(page, state);
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('undelivered message tau', { timeout: 15000 });
  const resendBefore = await page.locator('[data-testid="terminal-resend"]').count();

  state.pending = 'refreshed output fixture tau';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });
  await page.waitForTimeout(800);
  const after = (await conv.innerText()).trim();
  record['lens4_resendBefore'] = resendBefore;
  record['lens4_resendAfter'] = await page.locator('[data-testid="terminal-resend"]').count();
  record['lens4_failedYouSurvived'] = after.includes('undelivered message tau');
  record['lens4_showsRefreshed'] = after.includes('refreshed output fixture tau');
  record['lens4_afterText'] = after;
  record['lens4_memoryAfter'] = await page.evaluate(() => localStorage.getItem('agj_term_mem_TEST_0.0'));
  await page.screenshot({ path: path.join(outDir, 'F3-m23-lens4-failed-you.png'), fullPage: true });
});

test.afterAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'F3-dom-aria-m23-a3.json'), JSON.stringify(record, null, 2));
});
