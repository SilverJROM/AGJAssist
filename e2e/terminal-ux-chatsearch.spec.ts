import { expect, test } from '@playwright/test';

// Chat search + jump-between-my-messages. Both are additive, read-only over the
// rendered turns; they must not disturb send/sync/failed-message behaviour.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'CS:0.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-chatsearch',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-chatsearch-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'cs', username: 'e2e', role: 'owner' }));
  });
});

async function setup(page: import('@playwright/test').Page) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'CS', panes: [{ target: TARGET, command: 'claude' }] }] }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● agent baseline reply\n▌ Type', target: TARGET, lines: 200 }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' }));

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

async function sendMessage(page: import('@playwright/test').Page, text: string) {
  await page.locator('[data-testid="terminal-composer-input"]').fill(text);
  await page.locator('[data-testid="terminal-send-command"]').click();
  await page.waitForTimeout(400);
}

test('chat search finds matches, navigates prev/next, and closes', async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  await sendMessage(page, 'alpha lorem ipsum');
  await sendMessage(page, 'beta lorem dolor');
  await sendMessage(page, 'gamma sit amet');
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(3);

  // Open search
  await page.locator('[data-testid="terminal-search-toggle"]').click();
  await expect(page.locator('[data-testid="terminal-search-bar"]')).toBeVisible();

  // "lorem" is in the first two of my messages -> 2 matches
  await page.locator('[data-testid="terminal-search-input"]').fill('lorem');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="terminal-search-count"]')).toHaveText('1/2');
  await expect(page.locator('.terminal-chat-hit')).toHaveCount(2);
  await expect(page.locator('.terminal-chat-hit-current')).toHaveCount(1);

  // Next / prev move the current match (wrap-around)
  await page.locator('[data-testid="terminal-search-next"]').click();
  await expect(page.locator('[data-testid="terminal-search-count"]')).toHaveText('2/2');
  await page.locator('[data-testid="terminal-search-next"]').click();
  await expect(page.locator('[data-testid="terminal-search-count"]')).toHaveText('1/2'); // wrapped
  await page.locator('[data-testid="terminal-search-prev"]').click();
  await expect(page.locator('[data-testid="terminal-search-count"]')).toHaveText('2/2');

  // No matches -> 0/0
  await page.locator('[data-testid="terminal-search-input"]').fill('zzznotfound');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="terminal-search-count"]')).toHaveText('0/0');
  await expect(page.locator('.terminal-chat-hit')).toHaveCount(0);

  // Close clears everything
  await page.locator('[data-testid="terminal-search-close"]').click();
  await expect(page.locator('[data-testid="terminal-search-bar"]')).toHaveCount(0);
  await expect(page.locator('.terminal-chat-hit')).toHaveCount(0);
  await expect(page.locator('[data-testid="terminal-search-toggle"]')).toBeVisible();
});

test('jump-between-my-messages nav steps through YOU turns with boundary handling', async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  await sendMessage(page, 'my first message');
  await sendMessage(page, 'my second message');
  await sendMessage(page, 'my third message');
  await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(3);

  // Control shows with >= 2 user turns
  await expect(page.locator('[data-testid="terminal-mynav"]')).toBeVisible();
  const up = page.locator('[data-testid="terminal-mynav-up"]');
  const down = page.locator('[data-testid="terminal-mynav-down"]');

  // From the start, down steps to each next YOU turn; at the last one it disables.
  await down.click(); // -> 1st
  await down.click(); // -> 2nd
  await expect(down).toBeEnabled();
  await down.click(); // -> 3rd (last)
  await expect(down).toBeDisabled();

  // Up steps back and re-enables down.
  await up.click(); // -> 2nd
  await expect(down).toBeEnabled();
  await up.click(); // -> 1st
  await expect(up).toBeDisabled();
});
