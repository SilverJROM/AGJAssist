import { expect, test } from '@playwright/test';

// Recent-message memory: the app stores the last exchanges in localStorage and
// seeds them back into the chat on open, surviving an app reopen. Proof: after
// a reload the pane shows UNRELATED output, yet the prior exchange still renders
// — so it was restored from memory, not scraped from the live pane.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'GATE-TERM:0.0';

const YOU_MSG = 'remember this exact question for later backtracking';
const REPLY = 'MEMORY-REPLY-LINE distinct enough to detect';

const PRIOR = [
  '● earlier reply that predates the send',
  '─────────────────────────────',
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
].join('\n');

const AFTER_SEND = [
  '● earlier reply that predates the send',
  `❯ ${YOU_MSG}`,
  `● ${REPLY}`,
  'second line of the reply',
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
].join('\n');

// After reopen the pane has moved on to something with NO trace of the exchange.
const UNRELATED = [
  '❯ a completely different later command',
  '● unrelated output with nothing from before',
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
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
        initData: 'terminal-ux-memory',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-memory-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'memory', username: 'e2e', role: 'owner' }));
  });
});

async function installTransport(page: import('@playwright/test').Page, getOutput: () => string, onSend?: () => void) {
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: tailLines(getOutput(), requested), target: TARGET, lines: requested }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    onSend?.();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
}

async function openFriendly(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 800, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  // On reopen the app may auto-resume the last active pane straight into the chat.
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

test('a sent exchange is restored from memory after an app reopen', async ({ page }) => {
  test.setTimeout(60_000);
  let output = PRIOR;
  await installTransport(page, () => output, () => { output = AFTER_SEND; });
  await openFriendly(page);

  // Send a message; the pane echoes it with a reply.
  await page.locator('[data-testid="terminal-composer-input"]').first().fill(YOU_MSG);
  await page.locator('[data-testid="terminal-send-command"]').first().click();

  await expect(page.locator('[data-testid="terminal-turn-user"]').last()).toContainText(YOU_MSG);
  await expect(page.locator('[data-testid="terminal-turn-agent"]').last()).toContainText(REPLY, { timeout: 15_000 });

  // Reopen the app: the live pane no longer has any trace of the exchange.
  output = UNRELATED;
  await openFriendly(page);

  // The exchange is still present — restored from localStorage memory.
  await expect(page.locator('[data-testid="terminal-turn-user"]', { hasText: YOU_MSG })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-turn-agent"]', { hasText: REPLY })).toBeVisible({ timeout: 15_000 });
});
