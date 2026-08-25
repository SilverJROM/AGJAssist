import { expect, test } from '@playwright/test';

// Single-select prompts: the chat must show the QUESTION/context + per-option
// descriptions (so you don't have to read the terminal), must NOT be misread as
// multi-select (checkboxes) from a stray marker in scrollback, and a tap picks +
// submits (navigate + Enter), never Space-toggle.

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'SEL:0.0';

const OUTPUT = [
  '● earlier there was a [ ] checkbox in scrollback',   // stale multi marker — must be ignored
  '● Clear. Let me settle this before authoring.',
  'The project north-star says turn-based by design.',
  'Streaming transcription contradicts that directly.',
  '',
  '❯ 1. Override it — duplex is the direction now',
  '     Log the override and amend the north-star so it no longer conflicts.',
  '  2. Override for this effort only',
  '     Streaming ships but the default posture stays turn-based.',
  '  3. Type something.',
  '  4. Chat about this',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
  '▌ Type a message',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-selection',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {}, onEvent() {}, offEvent() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-selection-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'sel', username: 'e2e', role: 'owner' }));
  });
});

test('single-select shows the question + descriptions, is not multi, and taps to select', async ({ page }) => {
  test.setTimeout(60_000);
  const keys: string[][] = [];
  await page.route(/telegram-web-app\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'SEL', panes: [{ target: TARGET, command: 'claude' }] }] }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: OUTPUT, target: TARGET, lines: 200 }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/keys$/, async (route) => {
    try { keys.push((route.request().postDataJSON() as { keys: string[] }).keys); } catch {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"message":"ok"}' });
  });

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="terminal-selection"]')).toBeVisible();

  // (1) The QUESTION is shown in the chat, not just the options.
  const title = page.locator('[data-testid="terminal-selection-title"]');
  await expect(title).toContainText('north-star says turn-based');
  await expect(title).toContainText('contradicts that directly');

  // Per-option descriptions are shown.
  const opts = page.locator('[data-testid="terminal-selection-opt"]');
  await expect(opts.nth(0)).toContainText('amend the north-star');
  await expect(opts.nth(1)).toContainText('default posture stays turn-based');

  // (2) NOT misread as multi — no checkboxes, no Submit button.
  await expect(page.locator('.terminal-selection-check')).toHaveCount(0);
  await expect(page.locator('[data-testid="terminal-selection-submit"]')).toHaveCount(0);

  // (3) The "Type something" option carries the free-form-reply hint.
  await expect(page.locator('[data-testid="terminal-selection-typehint"]')).toBeVisible();

  // Tap picks + submits (navigate Down + Enter), never Space-toggle.
  keys.length = 0;
  await opts.nth(2).click(); // "Type something." (index 2, cursor is on 0)
  await page.waitForTimeout(300);
  const flat = keys.flat();
  expect(flat).toContain('Enter');
  expect(flat).not.toContain('Space');
});
