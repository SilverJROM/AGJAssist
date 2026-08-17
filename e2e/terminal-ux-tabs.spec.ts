import { expect, test } from '@playwright/test';

// Multi-session tabs: selecting a session opens a tab; the + opens a picker to
// open another; tapping a tab switches; ✕ closes; open tabs persist across reload.

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

async function pickFromSwitcher(page: import('@playwright/test').Page, name: string) {
  await page.locator('[data-testid="terminal-session-switcher"]').click();
  await page.locator('[data-testid="terminal-session-option"]').filter({ hasText: name }).first().click();
}

test('open, switch, close and persist session tabs', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await pickFromSwitcher(page, 'TABA');
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(1);

  // Open a second tab via the + picker.
  await page.locator('[data-testid="terminal-tab-add"]').click();
  await expect(page.locator('[data-testid="terminal-tab-picker"]')).toBeVisible();
  await page.locator('[data-testid="terminal-tab-picker-item"]').filter({ hasText: 'TABB' }).first().click();
  await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(2);
  await expect(page.locator('.terminal-tab.active')).toContainText('TABB');

  // Switch back to TABA.
  await page.locator('[data-testid="terminal-tab"]').filter({ hasText: 'TABA' }).first().click();
  await expect(page.locator('.terminal-tab.active')).toContainText('TABA');

  // Persist across reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(2);

  // Close TABB.
  await page.locator('[data-testid="terminal-tab"]').filter({ hasText: 'TABB' })
    .locator('[data-testid="terminal-tab-close"]').first().click();
  await expect(page.locator('[data-testid="terminal-tab"]')).toHaveCount(1);
});
