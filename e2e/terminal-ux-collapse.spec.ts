import { expect, test } from '@playwright/test';

// Minimize proof: agent replies compact to the most recent N lines (default 50),
// tail pinned to the bottom, with a per-reply expand/minimize toggle. The ☰ menu
// reply-length picker (10 / 50 / Full) changes N. User messages never compact.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'GATE-TERM:0.0';

const REPLY_COUNT = 220;
const REPLY_LINES = Array.from({ length: REPLY_COUNT }, (_, i) => `reply-line-${String(i + 1).padStart(3, '0')}`);
const NEWEST = REPLY_LINES[REPLY_COUNT - 1]; // reply-line-220 (bottom, always shown)
const AT_170 = REPLY_LINES[169];             // reply-line-170 (hidden at 50, shown when expanded)
const AT_205 = REPLY_LINES[204];             // reply-line-205 (shown at 50, hidden at 10)

const OUTPUT = [
  '● OLD-REPLY-ABOVE should never appear in the current turn',
  '─────────────────────────────────────────',
  '❯ walk me through the whole deploy pipeline in detail',
  `● ${REPLY_LINES[0]}`,
  ...REPLY_LINES.slice(1),
  '⏵⏵ bypass permissions on · ctrl+t',
  '▌ Type a message',
].join('\n');

function tailLines(text: string, n: number) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const safe = Math.max(1, Number.isFinite(n) ? n : 25);
  return lines.slice(-safe).join('\n');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-collapse',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-collapse-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'collapse', username: 'e2e', role: 'owner' }));
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'GATE-TERM', panes: [{ target: TARGET, command: 'claude' }] }] }) });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const requested = Number(new URL(route.request().url()).searchParams.get('lines') || '25');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: tailLines(OUTPUT, requested), target: TARGET, lines: requested }) });
  });
}

async function openFriendly(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 800, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  const row = page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('agent reply minimizes to the recent tail, expands/collapses, and the picker changes N', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await openFriendly(page);

  const agent = page.locator('[data-testid="terminal-turn-agent"]').last();
  await expect(agent).toBeVisible({ timeout: 15_000 });
  await expect(agent).not.toContainText('OLD-REPLY-ABOVE'); // dedup on open

  // Default limit 50: last 50 shown (newest present, line 170 hidden), expand offered.
  const expandBtn = page.locator('[data-testid="terminal-reply-expand"]');
  await expect(expandBtn).toBeVisible();
  await expect(expandBtn).toContainText(/Show full reply/);
  await expect(agent).toContainText(NEWEST);
  await expect(agent).toContainText(AT_205);
  await expect(agent).not.toContainText(AT_170);
  await page.screenshot({ path: 'AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-minimize-50.png' });

  // Expand → full reply (line 170 now visible), toggle flips to Minimize.
  await expandBtn.click();
  await expect(agent).toContainText(AT_170);
  const minimizeBtn = page.locator('[data-testid="terminal-reply-minimize"]');
  await expect(minimizeBtn).toBeVisible();
  await expect(minimizeBtn).toContainText(/Minimize to 50/);

  // Minimize → back to compact.
  await minimizeBtn.click();
  await expect(agent).not.toContainText(AT_170);
  await expect(page.locator('[data-testid="terminal-reply-expand"]')).toBeVisible();

  // ☰ menu → set reply length to 10: now last 10 only (line 205 hidden).
  await page.locator('[data-testid="terminal-menu"]').click();
  const seg = page.locator('[data-testid="terminal-reply-limit"]');
  await expect(seg).toBeVisible();
  await seg.getByRole('button', { name: '10', exact: true }).click();
  // Close the settings sheet via its Done button (reliable dismiss).
  await page.locator('[data-testid="terminal-menu-done"]').click();
  await expect(page.locator('.terminal-menu-overlay')).toBeHidden();
  await expect(page.locator('[data-testid="terminal-reply-expand"]')).toContainText(/210 earlier lines/);
  await expect(agent).toContainText(NEWEST);
  await expect(agent).not.toContainText(AT_205);
});
