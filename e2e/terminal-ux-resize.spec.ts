import { expect, test } from '@playwright/test';

// Draggable composer resize: drag the grip up to grow the input; the height
// persists across reload; double-tap resets to auto.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'RESIZE:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-resize',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-resize-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'rz', username: 'e2e', role: 'owner' }));
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'RESIZE', panes: [{ target: TARGET, command: 'claude' }] }] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi\n▌ Type a message', target: TARGET, lines: 200 }) });
  });
}

async function openTarget(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('drag the grip to resize the composer; height persists; double-tap resets', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await openTarget(page);

  const field = page.locator('[data-testid="terminal-composer-input"]');
  const before = (await field.boundingBox())!.height;

  const grip = page.locator('[data-testid="terminal-composer-grip"]');
  const gb = (await grip.boundingBox())!;
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, gb.y - 150, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = (await field.boundingBox())!.height;
  expect(after).toBeGreaterThan(before + 80);

  // Persist across reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  if (!(await page.locator('.terminal-chat-view').isVisible().catch(() => false))) {
    await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
    await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  }
  const persisted = (await page.locator('[data-testid="terminal-composer-input"]').boundingBox())!.height;
  expect(persisted).toBeGreaterThan(before + 80);

  // Double-tap the grip resets to auto.
  await page.locator('[data-testid="terminal-composer-grip"]').dblclick();
  await page.waitForTimeout(300);
  const reset = (await page.locator('[data-testid="terminal-composer-input"]').boundingBox())!.height;
  expect(reset).toBeLessThan(before + 30);
});
