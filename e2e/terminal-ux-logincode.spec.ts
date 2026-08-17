import { expect, test } from '@playwright/test';

// Login-code send: a long, space-free OAuth code triggers clear_first so the
// claude "Paste code here" input is cleared (Ctrl-U) before the code — fixing
// the case where a rejected code + retry leaves residual content that made the
// next paste "not go inside". A normal message does NOT set clear_first.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'LC:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-logincode',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-logincode-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'lc', username: 'e2e', role: 'owner' }));
  });
});

async function installTransport(page: import('@playwright/test').Page, getOutput: () => string, onSend: (b: unknown) => void) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'LC', panes: [{ target: TARGET, command: 'claude' }] }] }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: getOutput(), target: TARGET, lines: 200 }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => { try { onSend(route.request().postDataJSON()); } catch {} await route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' }); });
}

async function open(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="terminal-session-switcher"]').click();
  await page.locator('[data-testid="terminal-session-option"]').filter({ hasText: 'LC' }).first().click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
}

test('a long OAuth code sends with clear_first; a normal message does not', async ({ page }) => {
  test.setTimeout(60_000);
  let sent: any = null;
  // Start on a NORMAL prompt (no OAuth text).
  let output = '● hello there\n▌ Type a message';
  await installTransport(page, () => output, (b) => { sent = b; });
  await open(page);

  // (1) Long, space-free code on a normal prompt → clear_first true (by shape).
  const CODE = 'FRME4KGiXvtH0kL3RiALB14AlNx1VOKT4wmrplAiUqefsyxq#pQnDedJdusA7z';
  await page.locator('[data-testid="terminal-composer-input"]').fill(CODE);
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent.command).toBe(CODE);
  expect(sent.clear_first).toBe(true);

  // (2) Normal message with spaces on a normal prompt → clear_first false.
  sent = null;
  await page.locator('[data-testid="terminal-composer-input"]').fill('hello there agent');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent.command).toBe('hello there agent');
  expect(sent.clear_first).toBe(false);

  // (3) A short message AT the OAuth prompt → clear_first true (by prompt).
  sent = null;
  output = '● Please paste code here if prompted:\n▌ Type';
  await page.waitForTimeout(1200); // let the poll pick up the new snapshot
  await page.locator('[data-testid="terminal-composer-input"]').fill('yes');
  await page.locator('[data-testid="terminal-send-command"]').click();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent.command).toBe('yes');
  expect(sent.clear_first).toBe(true);
});
