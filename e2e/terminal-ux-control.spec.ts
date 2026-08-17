import { expect, test } from '@playwright/test';

// Chat-driven control: a tool-permission prompt in the pane becomes tappable
// option buttons; a tap sends the right navigation + Enter over the tmux
// WebSocket. The always-on control bar sends raw keys (Esc, Ctrl-C, Shift-Tab).
// The WS is mocked so we can assert the exact bytes each tap emits.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'GATE-TERM:0.0';

// Tool-permission dialog: ❯ cursor on option 1 (selectedIndex 0).
const PROMPT_OUTPUT = [
  '● I will run the build now.',
  '╭─────────────────────────────────────╮',
  '│ Bash: npm run build                 │',
  '│ Do you want to proceed?             │',
  '│ ❯ 1. Yes                            │',
  '│   2. No                             │',
  '│   3. Yes, and do not ask again      │',
  '╰─────────────────────────────────────╯',
].join('\n');

function tailLines(text: string, n: number) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const safe = Math.max(1, Number.isFinite(n) ? n : 25);
  return lines.slice(-safe).join('\n');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-control',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-control-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'control', username: 'e2e', role: 'owner' }));
  });
});

async function installTransport(page: import('@playwright/test').Page) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) });
  });
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ patterns: [] }) });
  });
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'GATE-TERM', panes: [{ target: TARGET, command: 'claude' }] }] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const requested = Number(new URL(route.request().url()).searchParams.get('lines') || '25');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: tailLines(PROMPT_OUTPUT, requested), target: TARGET, lines: requested }) });
  });
}

async function openFriendly(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 800, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('.terminal-chat-view').isVisible().catch(() => false)) return;
  await page.setViewportSize({ width: 800, height: 844 });
  const picker = page.locator('.terminal-mobile-picker select');
  if (await picker.isVisible().catch(() => false)) {
    await picker.selectOption(TARGET);
  } else {
    const pane = page.locator('.session-tree .tree-item', { hasText: TARGET });
    await expect(pane).toBeVisible({ timeout: 15_000 });
    await pane.click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('selection prompt → option buttons + control bar POST the right named keys over REST', async ({ page }) => {
  test.setTimeout(60_000);
  // The action path is REST /keys (works over the tunnel; no WebSocket).
  const sent: string[][] = [];
  await page.route(/\/api\/tmux\/panes\/[^/]+\/keys$/, async (route) => {
    try { sent.push((route.request().postDataJSON() as { keys: string[] }).keys); } catch {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) });
  });
  await installTransport(page);
  await openFriendly(page);

  // Selection card renders the parsed options.
  const sel = page.locator('[data-testid="terminal-selection"]');
  await expect(sel).toBeVisible({ timeout: 15_000 });
  const opts = page.locator('[data-testid="terminal-selection-opt"]');
  await expect(opts).toHaveCount(3);
  await expect(opts.nth(0)).toContainText('Yes');
  await expect(opts.nth(1)).toContainText('No');

  // Control bar renders all keys.
  await expect(page.locator('[data-testid="terminal-control-bar"]')).toBeVisible();
  for (const id of ['ctl-enter', 'ctl-esc', 'ctl-ctrlc', 'ctl-mode', 'ctl-up', 'ctl-down']) {
    await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
  }

  // Tap option 2 (index 1). Cursor is at index 0 → Down once, then Enter.
  await opts.nth(1).click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent.at(-1)).toEqual(['Down', 'Enter']);

  // Control bar: each key POSTs its named key.
  sent.length = 0;
  await page.locator('[data-testid="ctl-esc"]').click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent.at(-1)).toEqual(['Escape']);

  sent.length = 0;
  await page.locator('[data-testid="ctl-ctrlc"]').click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent.at(-1)).toEqual(['C-c']);

  sent.length = 0;
  await page.locator('[data-testid="ctl-mode"]').click();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent.at(-1)).toEqual(['BTab']);

  await page.screenshot({ path: 'AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-selection-control.png' });
});
