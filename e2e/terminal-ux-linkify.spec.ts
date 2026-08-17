import { expect, test } from '@playwright/test';

// URLs in agent replies (e.g. a /login auth link) render as tappable links so
// JROM can open them from chat, then paste the code back and submit.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'LOGIN:0.0';
const LOGIN_URL = 'https://claude.ai/oauth/authorize?code=ABC123&scope=all';

const OUTPUT = [
  '❯ /login',
  '● Please visit the following URL to log in:',
  `  ${LOGIN_URL}`,
  'After authorizing, paste the code here.',
  '▌ Type a message',
].join('\n');

function tailLines(text: string, n: number) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  return lines.slice(-Math.max(1, n)).join('\n');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-linkify',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-linkify-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'lk', username: 'e2e', role: 'owner' }));
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'LOGIN', panes: [{ target: TARGET, command: 'claude' }] }] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const requested = Number(new URL(route.request().url()).searchParams.get('lines') || '25');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: tailLines(OUTPUT, requested), target: TARGET, lines: requested }) });
  });
}

async function openFriendly(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="terminal-session-switcher"]').click();
  await page.locator('[data-testid="terminal-session-option"]').filter({ hasText: 'LOGIN' }).first().click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('a URL in an agent reply becomes a safe, tappable link', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await openFriendly(page);

  const link = page.locator('a.terminal-chat-link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", LOGIN_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toContainText('claude.ai/oauth/authorize');
  // Surrounding text stays intact.
  await expect(page.locator('[data-testid="terminal-turn-agent"]').last()).toContainText('paste the code here');
});
