import { expect, test } from '@playwright/test';

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;

const NOW = Math.floor(Date.now() / 1000);
const NEWEST = { name: 'CHAT-NEW', target: 'CHAT-NEW:0.0', activity: NOW, busy: true };
const OLDER = { name: 'CHAT-OLD', target: 'CHAT-OLD:0.0', activity: NOW - 3600, busy: false };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-list',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-list-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'list', username: 'e2e', role: 'owner' }));
  });

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) });
  });
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ patterns: [] }) });
  });
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          { session_name: OLDER.name, panes: [{ target: OLDER.target, window: '0', pane: '0', command: 'claude', activity: OLDER.activity, busy: OLDER.busy }] },
          { session_name: NEWEST.name, panes: [
            { target: NEWEST.target, window: '0', pane: '0', command: 'codex', activity: NEWEST.activity, busy: NEWEST.busy },
            { target: 'CHAT-NEW:0.1', window: '0', pane: '1', command: 'bash', activity: NOW - 10, busy: false },
          ] },
        ],
      }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const target = decodeURIComponent(new URL(route.request().url()).pathname.split('/panes/')[1].split('/')[0]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: `● hello from ${target}\n▌ Type a message`, target, lines: 25 }) });
  });
});

test('terminal list is sorted by activity, opens chat, returns via back, and has no tab strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="terminal-list-title"]')).toContainText('Terminals');
  const rows = page.locator('[data-testid="terminal-session-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(NEWEST.name);
  await expect(rows.nth(1)).toContainText(OLDER.name);
  await expect(rows.nth(0).locator('.terminal-list-dot.busy')).toBeVisible();
  await expect(rows.nth(0)).toContainText('working');
  await expect(page.locator('[data-testid="terminal-tabstrip"]')).toHaveCount(0);

  const outputRequest = page.waitForRequest((req) =>
    /\/api\/tmux\/panes\/CHAT-NEW(%3A|:)0\.0\/output/.test(req.url())
  );
  await rows.nth(0).click();
  await outputRequest;

  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText(NEWEST.name);
  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText(`hello from ${NEWEST.target}`, { timeout: 10_000 });
  await expect(page.locator('[data-testid="terminal-tabstrip"]')).toHaveCount(0);

  await page.locator('[data-testid="terminal-back-list"]').click();
  await expect(page.locator('[data-testid="terminal-session-list"]')).toBeVisible();
  await expect(page.locator('.terminal-chat-view')).toHaveCount(0);
});
