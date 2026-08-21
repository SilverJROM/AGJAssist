import { expect, test } from '@playwright/test';

// The chat header shows quick-switch tabs for the OTHER live sessions in the
// current session's group, filling the header whitespace beside the name.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TA = 'SA:0.0';
const TB = 'SB:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-header-tabs',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {}, onEvent() {}, offEvent() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-header-tabs-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'ht', username: 'e2e', role: 'owner' }));
  });
});

test('chat header shows group siblings as quick-switch tabs and switches on tap', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route(/telegram-web-app\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  // Two live sessions, SA + SB.
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [
    { session_name: 'SA', panes: [{ target: TA, command: 'claude' }] },
    { session_name: 'SB', panes: [{ target: TB, command: 'claude' }] },
  ] }) }));
  // A group containing both.
  await page.route(/\/api\/terminal\/groups(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ id: 'g1', name: 'Mine', sessions: ['SA', 'SB'] }], activeGroup: 'g1' }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi\n▌ Type', target: TA, lines: 200 }) }));

  await page.setViewportSize({ width: 640, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TA}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });

  // The header shows a tab for the OTHER group member (SB), not for SA itself.
  const tabs = page.locator('[data-testid="terminal-header-tab"]');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveText('SB');
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText('SA');

  // Tapping it switches the active session to SB.
  await tabs.first().click();
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText('SB');
  // Now the header tab points back to SA.
  await expect(page.locator('[data-testid="terminal-header-tab"]')).toHaveText('SA');
});
