import { expect, test } from '@playwright/test';

// A newly-created tmux session appears in the switcher dropdown WITHOUT reopening
// the chat: the list refreshes when the dropdown opens and via a background poll.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-dynsessions',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-dynsessions-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'ds', username: 'e2e', role: 'owner' }));
  });
});

test('a new session shows in the dropdown without reopening the chat', async ({ page }) => {
  test.setTimeout(60_000);
  // Mutable session list — a second session is "created" mid-session.
  let sessions: unknown[] = [{ session_name: 'SESA', panes: [{ target: 'SESA:0.0', command: 'claude' }] }];

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi\n▌ Type', target: 'x', lines: 200 }) }));

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.locator('[data-testid="terminal-session-switcher"]').click();
  await page.locator('[data-testid="terminal-session-option"]').filter({ hasText: 'SESA' }).first().click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });

  // A new session is created externally (chat stays open).
  sessions = [
    { session_name: 'SESA', panes: [{ target: 'SESA:0.0', command: 'claude' }] },
    { session_name: 'SESB-NEW', panes: [{ target: 'SESB-NEW:0.0', command: 'claude' }] },
  ];

  // Opening the dropdown refreshes → the new session is there without reopening.
  await page.locator('[data-testid="terminal-session-switcher"]').click();
  await expect(page.locator('[data-testid="terminal-session-option"]').filter({ hasText: 'SESB-NEW' })).toBeVisible({ timeout: 5_000 });
});
