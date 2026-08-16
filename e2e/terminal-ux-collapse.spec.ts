import { expect, test } from '@playwright/test';

// On-open windowing proof: a long agent reply is collapsed to its recent tail
// (BUBBLE_VISIBLE_TAIL = 80 lines) with a "show earlier" control that reveals
// more on top (BUBBLE_EXPAND_TAIL = 480, then all). The newest line stays
// pinned at the bottom; older lines are hidden above until requested.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;
const TARGET = 'GATE-TERM:0.0';

const REPLY_COUNT = 220;
const REPLY_LINES = Array.from({ length: REPLY_COUNT }, (_, i) => `reply-line-${String(i + 1).padStart(3, '0')}`);
const NEWEST = REPLY_LINES[REPLY_COUNT - 1]; // reply-line-220 (bottom)
const EARLY = REPLY_LINES[9];               // reply-line-010 (hidden until expanded)

// Structure mirrors a live claude pane: an OLD reply, the newest ❯ user run,
// then a long ● reply below it, then chrome. The anchor cuts below the ❯ run,
// so the OLD reply is excluded (dedup) and the long reply is the agent body.
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
  const picker = page.locator('.terminal-mobile-picker select');
  if (await picker.isVisible().catch(() => false)) {
    await picker.selectOption(TARGET);
  } else {
    const pane = page.locator('.session-tree .tree-item', { hasText: TARGET });
    await expect(pane).toBeVisible({ timeout: 15_000 });
    await pane.click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
}

test('long reply opens collapsed to the recent tail with a working show-earlier control', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await openFriendly(page);

  const agent = page.locator('[data-testid="terminal-turn-agent"]').last();
  await expect(agent).toBeVisible({ timeout: 15_000 });

  // Dedup on open: the OLD reply above the ❯ run is excluded.
  await expect(agent).not.toContainText('OLD-REPLY-ABOVE');

  // Default: newest line shown, an early line hidden, show-earlier offered.
  const showEarlier = page.locator('[data-testid="terminal-show-earlier"]');
  await expect(showEarlier).toBeVisible();
  await expect(showEarlier).toContainText(/Show earlier lines/);
  await expect(agent).toContainText(NEWEST);
  await expect(agent).not.toContainText(EARLY);

  await page.screenshot({ path: 'AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-collapse-default.png' });

  // Scroll the transcript to the top so the show-earlier control is in view, and
  // capture it (it sits above the visible tail on open).
  await page.locator('[data-testid="terminal-conversation"]').evaluate((el) => { el.scrollTop = 0; });
  await expect(showEarlier).toBeInViewport({ timeout: 5_000 });
  await page.screenshot({ path: 'AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-collapse-button.png' });

  // Expand: the early line becomes visible (revealed on top).
  await showEarlier.click();
  await expect(agent).toContainText(EARLY, { timeout: 10_000 });
  await expect(agent).toContainText(NEWEST);

  await page.screenshot({ path: 'AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-collapse-expanded.png' });
});
