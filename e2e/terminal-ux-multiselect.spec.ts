import { expect, test } from '@playwright/test';

// Multi-select prompts: tapping an option TOGGLES it (Space) and keeps the card
// open so several can be toggled; a Submit button (and Enter in an empty
// composer) submits them all (Enter). Single-select is unchanged.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'MS:0.0';

const OUTPUT = [
  '❯ set up the assistant',
  'What should the assistant be able to DO? (pick all that apply)',
  '  1. [✓] Machine ops',
  '  2. [ ] Agent fleet',
  '  3. [ ] Personal assistant',
  '  4. [ ] Local docs',
  'Multi-select — use Space to toggle, then Enter',
  '▌ Type a message',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-multiselect',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-multiselect-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'ms', username: 'e2e', role: 'owner' }));
  });
});

async function install(page: import('@playwright/test').Page, keys: string[][]) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'MS', panes: [{ target: TARGET, command: 'claude' }] }] }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: OUTPUT, target: TARGET, lines: 200 }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/keys$/, async (route) => {
    try { keys.push((route.request().postDataJSON() as { keys: string[] }).keys); } catch {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' });
  });
}

async function open(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="terminal-session-switcher"]').click();
  await page.locator('[data-testid="terminal-session-option"]').filter({ hasText: 'MS' }).first().click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

test('multi-select toggles options (Space) and submits via button + Enter', async ({ page }) => {
  test.setTimeout(60_000);
  const keys: string[][] = [];
  await install(page, keys);
  await open(page);

  const card = page.locator('[data-testid="terminal-selection"]');
  await expect(card).toBeVisible();
  await expect(page.locator('.terminal-selection-check')).toHaveCount(4);
  await expect(page.locator('[data-testid="terminal-selection-submit"]')).toBeVisible();

  // Tap option 3 → toggles (nav + Space, NO Enter), card stays open.
  keys.length = 0;
  await page.locator('[data-testid="terminal-selection-opt"]').nth(2).click();
  await expect.poll(() => keys.length).toBeGreaterThan(0);
  const seq = keys.at(-1)!;
  expect(seq.at(-1)).toBe('Space');
  expect(seq).not.toContain('Enter');
  await expect(card).toBeVisible(); // not dismissed

  // Submit → Enter.
  keys.length = 0;
  await page.locator('[data-testid="terminal-selection-submit"]').click();
  await expect.poll(() => keys.at(-1)).toEqual(['Enter']);
});
