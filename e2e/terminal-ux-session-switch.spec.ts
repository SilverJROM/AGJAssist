import { expect, test } from '@playwright/test';

// Independent validation of the terminal list -> chat navigation model. Tapping
// a session row calls switchActiveTarget -> setActiveTarget and remounts the chat
// on that target; the chat back button returns to the list.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;

const SESS_A = { name: 'SESS-A', target: 'SESS-A:0.0' };
const SESS_B = { name: 'SESS-B', target: 'SESS-B:0.0' };

const OUTPUT_BY_TARGET: Record<string, string> = {
  [SESS_A.target]: ['SESS-A baseline output.', '▌ Type a message'].join('\n'),
  [SESS_B.target]: ['SESS-B baseline output.', '▌ Type a message'].join('\n'),
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-session-switch',
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-session-switch-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'terminal-ux-session-switch', username: 'e2e', role: 'owner' }));
  });

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }),
    });
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
          { session_name: SESS_A.name, panes: [{ target: SESS_A.target, command: 'codex' }] },
          { session_name: SESS_B.name, panes: [{ target: SESS_B.target, command: 'claude' }] },
        ],
      }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/([^/]+)\/output(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const target = decodeURIComponent(url.pathname.match(/\/panes\/([^/]+)\/output/)![1]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: OUTPUT_BY_TARGET[target] || `unknown target ${target}` }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/send$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
});

async function openTerminalOnSessA(page: import('@playwright/test').Page, viewport: { width: number; height: number }) {
  // Session tree / mobile picker is desktop-only, so select the initial pane at a
  // wide width first, then shrink to the target viewport (same pattern as the
  // layout + conversation specs).
  await page.setViewportSize({ width: Math.max(viewport.width, 800), height: Math.max(viewport.height, 844) });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });
  const row = page.locator(`[data-testid="terminal-session-row"][data-session-target="${SESS_A.target}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await page.setViewportSize(viewport);
  const conversation = page.locator('[data-testid="terminal-conversation"]');
  if (!(await conversation.isVisible().catch(() => false))) {
    const friendly = page.getByRole('button', { name: /^Friendly$/ }).first();
    if (await friendly.isVisible().catch(() => false)) await friendly.click();
  }
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  // Confirm we're actually connected to SESS-A before exercising list navigation.
  await expect(page.locator('[data-testid="terminal-session-name"]')).toContainText(SESS_A.name, { timeout: 15_000 });
}

const VIEWPORTS = [
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
  test(`Session list opens and switches sessions at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }, testInfo) => {
    await openTerminalOnSessA(page, viewport);

    const back = page.locator('[data-testid="terminal-back-list"]');
    await expect(back).toBeVisible();
    await back.click();

    const rows = page.locator('[data-testid="terminal-session-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: SESS_A.name })).toBeVisible();
    await expect(rows.filter({ hasText: SESS_B.name })).toBeVisible();
    await expect(page.locator('[data-testid="terminal-tabstrip"]')).toHaveCount(0);

    // --- Selecting SESS-B actually switches the active target end-to-end ---
    // Watch for the poll/reconnect request to SESS-B's output endpoint, which only
    // fires if setActiveTarget really changed React state (TerminalView is keyed by
    // activeTarget, so a real switch remounts it and re-issues the initial fetch).
    const sessBRequest = page.waitForRequest((req) =>
      /\/api\/tmux\/panes\/SESS-B(%3A|:)0\.0\/output/.test(req.url())
    , { timeout: 10_000 });

    const sessBRow = page.locator(`[data-testid="terminal-session-row"][data-session-target="${SESS_B.target}"]`);
    await expect(sessBRow).toBeVisible();
    await sessBRow.click();

    await sessBRequest;

    // Topbar name now reflects SESS-B, not SESS-A.
    const sessionName = page.locator('[data-testid="terminal-session-name"]');
    await expect(sessionName).toContainText(SESS_B.name, { timeout: 10_000 });
    await expect(sessionName).not.toContainText(SESS_A.name);

    // The transcript now shows SESS-B's identifiable output, not SESS-A's.
    const conversation = page.locator('[data-testid="terminal-conversation"]');
    await expect(conversation).toContainText('SESS-B baseline output', { timeout: 10_000 });

    if (viewport.width <= 390) {
      await back.click();
      await expect(page.locator('[data-testid="terminal-session-list"]')).toBeVisible();
      await page.screenshot({
        path: '/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/terminal-ux-2026-08-15/mockups/screenshots/LIVE-session-list.png',
      });
    }
    void testInfo;
  });
}
