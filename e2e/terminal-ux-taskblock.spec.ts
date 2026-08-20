import { expect, test } from '@playwright/test';

// The agent's live task panel (⎿ ◻/✔ … lines) is collapsed inside the bubble to
// a "📋 N tasks · X done / Y open" pill by default, and expands to the checklist
// on tap — so it stops eating chat space. The surrounding reply text is intact.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'TASK-TERM:0.0';

const OUTPUT = [
  '❯ show me the task status',
  '● Working on it now.',
  '  ⎿  ◻ Multi-session tabs at the top of the terminal',
  '     ✔ Fix selection-card false positive (prose triggers it)',
  '     ✔ Attachment -> minimal icon, no composer shrink',
  '     ✔ Compact Telegram layout + fix top cutoff',
  '▌ Type a message',
].join('\n');

function tailLines(text: string, n: number) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  return lines.slice(-Math.max(1, n)).join('\n');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-taskblock',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-taskblock-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'tb', username: 'e2e', role: 'owner' }));
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'TASK-TERM', panes: [{ target: TARGET, command: 'claude' }] }] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const requested = Number(new URL(route.request().url()).searchParams.get('lines') || '25');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: tailLines(OUTPUT, requested), target: TARGET, lines: requested }) });
  });
}

async function openFriendly(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 800, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('.terminal-chat-view').isVisible().catch(() => false)) return;
  await page.setViewportSize({ width: 800, height: 844 });
  const row = page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('agent task panel collapses to a pill and expands the checklist on tap', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await openFriendly(page);

  const toggle = page.locator('[data-testid="terminal-taskblock-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await expect(toggle).toContainText('4 tasks');
  await expect(toggle).toContainText('3 done / 1 open');

  // The reply text stays; the checklist is hidden until expanded.
  await expect(page.locator('[data-testid="terminal-turn-agent"]').last()).toContainText('Working on it now');
  await expect(page.locator('.terminal-taskblock-items')).toHaveCount(0);

  await toggle.click();
  await expect(page.locator('.terminal-taskblock-items')).toBeVisible();
  await expect(page.locator('.terminal-taskblock-item')).toHaveCount(4);
  await expect(page.locator('.terminal-taskblock-item').first()).toContainText('Multi-session tabs');

  // Collapse again.
  await toggle.click();
  await expect(page.locator('.terminal-taskblock-items')).toHaveCount(0);
});
