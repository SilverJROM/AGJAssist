import { expect, test } from '@playwright/test';

// A message that fails to send is NOT silently lost: the YOU bubble is marked
// "Not sent" with a one-tap Resend, it persists across a reload (so leaving the
// session doesn't lose it), and resending clears the failed state on success.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'FT:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-failsend',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-failsend-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'ft', username: 'e2e', role: 'owner' }));
  });
});

async function open(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

test('a failed message is preserved, persists across reload, and can be resent', async ({ page }) => {
  test.setTimeout(60_000);
  let failSend = true;

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'FT', panes: [{ target: TARGET, command: 'claude' }] }] }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi there\n▌ Type', target: TARGET, lines: 200 }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    if (failSend) await route.abort('failed');
    else await route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' });
  });

  await open(page);

  // Send a message that fails.
  await page.locator('[data-testid="terminal-composer-input"]').fill('this message will fail to send');
  await page.locator('[data-testid="terminal-send-command"]').click();

  // The YOU bubble stays, marked "Not sent" with a Resend button.
  const you = page.locator('[data-testid="terminal-turn-user"]').last();
  await expect(you).toContainText('this message will fail to send');
  await expect(page.locator('[data-testid="terminal-turn-failed"]')).toContainText(/Not sent/);
  await expect(page.locator('[data-testid="terminal-resend"]')).toBeVisible();

  // Persists across a reload (leaving/returning doesn't lose it).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (!(await page.locator('.terminal-chat-view').isVisible().catch(() => false))) {
    await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
    await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.locator('[data-testid="terminal-turn-user"]').last()).toContainText('this message will fail to send');
  await expect(page.locator('[data-testid="terminal-resend"]')).toBeVisible();

  // Resend (now succeeds) → failed state clears.
  failSend = false;
  await page.locator('[data-testid="terminal-resend"]').click();
  await expect(page.locator('[data-testid="terminal-resend"]')).toHaveCount(0, { timeout: 10_000 });
});
