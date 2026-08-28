import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const record: Record<string, unknown> = {};

function seedRoutes(page, opts: { initial: string }) {
  const state = { sessionCalls: 0, outputCalls: 0, refreshCalls: 0, pending: null as string | null };

  page.route('**/api/tmux/sessions', async route => {
    state.sessionCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{
          session_name: 'TEST',
          panes: [{ target: 'TEST:0.0', command: state.sessionCalls === 1 ? 'bash' : 'zsh', activity: state.sessionCalls, busy: false }]
        }]
      })
    });
  });

  page.route('**/api/tmux/panes/*/output*', async route => {
    state.outputCalls += 1;
    const isRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
    if (!isRefresh) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: opts.initial }) });
      return;
    }
    state.refreshCalls += 1;
    const out = state.pending;
    state.pending = null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: out || '' }) });
  });

  page.route('**/api/tmux/panes/*/send*', route => route.fulfill({ status: 200, body: 'ok' }));
  page.route('**/api/tmux/panes/*/keys*', route => route.fulfill({ status: 200, body: 'ok' }));
  return state;
}

async function openTerminal(page) {
  await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="terminal-session-row"]') as HTMLElement | null;
    if (row) row.click();
  });
  await expect(page.locator('[data-testid="terminal-refresh"]').first()).toBeVisible({ timeout: 15000 });
}

// LENS A — does the shipped assertion actually discriminate? Serve app.js with the
// ONE line of this commit's product change reverted (processRefreshSnapshot -> processSnapshot)
// and re-run the shipped journey's core claim. The mutant MUST keep the stale transcript.
test('LENS A mutation: reverting refreshOutput to processSnapshot leaves the stale transcript', async ({ page }) => {
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

  const state = seedRoutes(page, { initial: 'initial output fixture' });
  await openTerminal(page);
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('initial output fixture', { timeout: 15000 });

  state.pending = 'refreshed output fixture';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });

  const text = (await conv.innerText()).trim();
  record['lensA_mutationApplied'] = mutated;
  record['lensA_refreshCalls'] = state.refreshCalls;
  record['lensA_conversationText'] = text;
  record['lensA_stillStale'] = text.includes('initial output fixture');
  record['lensA_showsRefreshed'] = text.includes('refreshed output fixture');
  await page.screenshot({ path: path.join(outDir, 'F3-m21-lensA-mutant-after.png'), fullPage: true });

  expect(mutated, 'mutation must have been applied to app.js').toBe(true);
  // Discrimination proof: with the product line reverted, the shipped assertions must be red.
  expect(text.includes('initial output fixture'), 'mutant must keep stale transcript').toBe(true);
});

// LENS B — does the rebuild destroy conversation history the app had restored?
// Seed the persistent recent-message memory the app itself writes, open the pane,
// confirm the YOU bubble renders, then refresh and see whether it survives.
test('LENS B history: refresh rebuild vs previously restored YOU bubbles', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
    localStorage.setItem('agj_term_mem_TEST_0.0', JSON.stringify({
      entries: [
        { id: 'u-probe', role: 'user', label: 'YOU', content: 'probe user message zeta', timestamp: '10:00:00' },
        { id: 'a-probe', role: 'agent', label: 'Agent', content: 'probe earlier agent reply zeta', timestamp: '10:00:01' }
      ],
      updatedAt: Date.now()
    }));
  });

  const state = seedRoutes(page, { initial: 'initial output fixture' });
  await openTerminal(page);
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('probe user message zeta', { timeout: 15000 });
  const before = (await conv.innerText()).trim();
  const userBefore = await page.locator('[data-testid="terminal-turn-user"]').count();
  await page.screenshot({ path: path.join(outDir, 'F3-m21-lensB-before.png'), fullPage: true });

  state.pending = 'refreshed output fixture';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });
  await expect(conv).toContainText('refreshed output fixture', { timeout: 15000 });

  const after = (await conv.innerText()).trim();
  const userAfter = await page.locator('[data-testid="terminal-turn-user"]').count();
  const memAfter = await page.evaluate(() => localStorage.getItem('agj_term_mem_TEST_0.0'));
  record['lensB_userTurnsBefore'] = userBefore;
  record['lensB_userTurnsAfter'] = userAfter;
  record['lensB_beforeText'] = before;
  record['lensB_afterText'] = after;
  record['lensB_youBubbleSurvived'] = after.includes('probe user message zeta');
  record['lensB_memoryAfterRefresh'] = memAfter;
  await page.screenshot({ path: path.join(outDir, 'F3-m21-lensB-after.png'), fullPage: true });
});

// LENS C — after a completed refresh, does the 1s background poll immediately
// re-introduce the content the shipped test asserts is gone? (transient vs stable)
test('LENS C stability: transcript state 3s after refresh completes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
    localStorage.setItem('agj_token', 'test-token');
  });
  const state = seedRoutes(page, { initial: 'initial output fixture' });
  await openTerminal(page);
  const conv = page.locator('[data-testid="terminal-conversation"]');
  await expect(conv).toContainText('initial output fixture', { timeout: 15000 });

  state.pending = 'refreshed output fixture';
  await page.locator('[data-testid="terminal-refresh"]').first().click();
  await expect(page.locator('[data-testid="terminal-refresh-status"]').first()).toContainText('Updated', { timeout: 15000 });
  await expect(conv).toContainText('refreshed output fixture', { timeout: 15000 });
  const immediate = (await conv.innerText()).trim();
  await page.waitForTimeout(3000);
  const settled = (await conv.innerText()).trim();
  record['lensC_immediateHasInitial'] = immediate.includes('initial output fixture');
  record['lensC_settledHasInitial'] = settled.includes('initial output fixture');
  record['lensC_settledHasRefreshed'] = settled.includes('refreshed output fixture');
  record['lensC_settledText'] = settled;
  record['lensC_outputCalls'] = state.outputCalls;
  await page.screenshot({ path: path.join(outDir, 'F3-m21-lensC-settled.png'), fullPage: true });
});

test.afterAll(() => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'F3-dom-aria-m21-a1.json'), JSON.stringify(record, null, 2));
});
