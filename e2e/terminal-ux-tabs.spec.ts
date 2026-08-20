import { expect, test } from '@playwright/test';

// The old multi-session tab strip has been removed. Session navigation is via the
// list -> chat -> back flow.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const A = 'TABA:0.0';
const B = 'TABB:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-tabs',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-tabs-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'tabs', username: 'e2e', role: 'owner' }));
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [
      { session_name: 'TABA', panes: [{ target: A, command: 'bash' }] },
      { session_name: 'TABB', panes: [{ target: B, command: 'bash' }] },
    ] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const target = decodeURIComponent(new URL(route.request().url()).pathname.split('/panes/')[1].split('/')[0]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: `● hello from ${target}\n▌ Type a message`, target, lines: 200 }) });
  });
}

test('session tabs are removed; list rows open chats instead', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${A}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-tabstrip"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(0);

  await page.locator('[data-testid="terminal-back-list"]').click();
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${B}"]`).click();
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText('TABB', { timeout: 10_000 });
  await expect(page.locator('[data-testid="terminal-tabstrip"]')).toHaveCount(0);
});
