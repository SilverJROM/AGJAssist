import { expect, test } from '@playwright/test';

// Small/large input toggle beside "Send raw keys": one tap enlarges the composer
// input, another shrinks it back; the choice persists per-device.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'ST:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-sizetoggle',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-sizetoggle-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'st', username: 'e2e', role: 'owner' }));
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'ST', panes: [{ target: TARGET, command: 'claude' }] }] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi\n▌ Type a message', target: TARGET, lines: 200 }) });
  });
}

async function open(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="terminal-session-switcher"]').click();
  await page.locator('[data-testid="terminal-session-option"]').filter({ hasText: 'ST' }).first().click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('small/large input toggle enlarges and shrinks the composer', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await open(page);

  const field = page.locator('[data-testid="terminal-composer-input"]');
  const small = (await field.boundingBox())!.height;

  const toggle = page.locator('[data-testid="terminal-size-toggle"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText(/Large input/);

  await toggle.click();
  await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(small + 80);
  await expect(toggle).toContainText(/Small input/);

  // Persist across reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  if (!(await page.locator('.terminal-chat-view').isVisible().catch(() => false))) {
    await page.locator('[data-testid="terminal-session-switcher"]').click();
    await page.locator('[data-testid="terminal-session-option"]').filter({ hasText: 'ST' }).first().click();
    await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  }
  const persisted = (await page.locator('[data-testid="terminal-composer-input"]').boundingBox())!.height;
  expect(persisted).toBeGreaterThan(small + 80);

  // Toggle back to small.
  await page.locator('[data-testid="terminal-size-toggle"]').click();
  await expect.poll(async () => (await page.locator('[data-testid="terminal-composer-input"]').boundingBox())!.height).toBeLessThan(small + 20);
});
