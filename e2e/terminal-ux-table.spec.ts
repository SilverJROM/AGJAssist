import { expect, test } from '@playwright/test';

// A box-drawing table in an agent reply is no longer stripped as chrome, and is
// rendered in an aligned monospace <pre> (columns line up like the terminal).

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TARGET = 'TBL:0.0';

const OUTPUT = [
  '❯ show me the proof',
  '● Done — Option A applied. Here is the proof:',
  '',
  '┌───────────────────┬──────────────┬──────────────┐',
  '│                   │   Before     │    After     │',
  '├───────────────────┼──────────────┼──────────────┤',
  '│ Tree hash         │ 6ae244fc5    │ 6ae244fc5    │',
  '│ HEAD              │ ce1bed554    │ ce1bed554    │',
  '│ Tracked files     │ 21,168       │ 21,168       │',
  '│ QA detector       │ PASS, 0 mism │ PASS, 0 mism │',
  '└───────────────────┴──────────────┴──────────────┘',
  '',
  'The tree hash is the decisive one.',
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
        initData: 'terminal-ux-table',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-table-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'tbl', username: 'e2e', role: 'owner' }));
  });
});

async function installTransport(page: import('@playwright/test').Page) {
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [{ session_name: 'TBL', panes: [{ target: TARGET, command: 'claude' }] }] }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (r) => {
    const requested = Number(new URL(r.request().url()).searchParams.get('lines') || '25');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: tailLines(OUTPUT, requested), target: TARGET, lines: requested }) });
  });
}

async function open(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator(`[data-testid="terminal-session-row"][data-session-target="${TARGET}"]`).click();
  await expect(page.locator('.terminal-chat-view')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
}

test('a box-drawing table survives and renders in an aligned monospace block', async ({ page }) => {
  test.setTimeout(60_000);
  await installTransport(page);
  await open(page);

  const agent = page.locator('[data-testid="terminal-turn-agent"]').last();
  // Data rows + header survive (were stripped as chrome before).
  await expect(agent).toContainText('Tree hash');
  await expect(agent).toContainText('6ae244fc5');
  await expect(agent).toContainText('Tracked files');
  await expect(agent).toContainText('QA detector');
  await expect(agent).toContainText('Before');
  await expect(agent).toContainText('After');
  // Prose around the table is preserved.
  await expect(agent).toContainText('Done — Option A applied');
  await expect(agent).toContainText('The tree hash is the decisive one');

  // Rendered in a monospace <pre> (aligned, horizontally scrollable).
  const pre = page.locator('pre.terminal-chat-table');
  await expect(pre).toHaveCount(1);
  await expect(pre).toContainText('Tree hash');
  const ws = await pre.evaluate((el) => getComputedStyle(el).whiteSpace);
  expect(ws).toBe('pre');
});
