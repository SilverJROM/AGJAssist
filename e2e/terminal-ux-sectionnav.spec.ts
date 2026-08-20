import { expect, test } from '@playwright/test';

// On the Terminal tab (Telegram), the bottom nav is hidden and a section-nav
// (▦) in the header lets JROM jump to other sections — reclaiming chat space.
// Other sections keep the bottom nav.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'SN:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-sectionnav',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-sectionnav-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'sn', username: 'e2e', role: 'owner' }));
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'SN', panes: [{ target: TARGET, command: 'claude' }] }] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi\n▌ Type a message', target: TARGET, lines: 200 }) });
  });
  // catch-all for other sections we may navigate to
  await page.route(/\/api\/(notes|tasks|projects|reminders|overmind|conversations|settings)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('terminal hides the bottom nav and offers a header section-nav; other sections keep it', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // Bottom nav hidden on the terminal list; section-nav present.
  await expect(page.locator('.tg-tab-bar')).toBeHidden();
  const sn = page.locator('[data-testid="terminal-sectionnav"]');
  await expect(sn).toBeVisible();
  await sn.click();
  await expect(page.locator('[data-testid="terminal-sectionnav-menu"]')).toBeVisible();
  const items = page.locator('.terminal-sectionnav-item');
  expect(await items.count()).toBeGreaterThan(1);

  // Navigate to another section → bottom nav returns there.
  await items.filter({ hasText: 'Notes' }).first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain('/notes');
  await expect(page.locator('.tg-tab-bar')).toBeVisible({ timeout: 10_000 });
});
