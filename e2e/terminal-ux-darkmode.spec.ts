import { expect, test } from '@playwright/test';

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const TERMINAL_PATH = `${APP_ORIGIN}/index.html#/terminals`;

const NOW = Math.floor(Date.now() / 1000);
const NEWEST = { name: 'CHAT-NEW', target: 'CHAT-NEW:0.0', activity: NOW, busy: true };
const OLDER = { name: 'CHAT-OLD', target: 'CHAT-OLD:0.0', activity: NOW - 3600, busy: false };

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) throw new Error(`expected rgb(a) color, got ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function channelLum(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'terminal-ux-darkmode',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {
          bg_color: '#0d1117',
          secondary_bg_color: '#161b22',
          text_color: '#e6edf3',
          hint_color: '#8b949e',
          button_color: '#58a6ff',
          button_text_color: '#ffffff',
          section_bg_color: '#161b22',
          section_separator_color: '#30363d',
          accent_text_color: '#58a6ff',
        },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'terminal-ux-darkmode-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'dark', username: 'e2e', role: 'owner' }));
  });

  await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) });
  });
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ patterns: [] }) });
  });
  await page.route(/\/api\/terminal\/groups(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [], activeGroup: 'all' }) });
  });
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          { session_name: OLDER.name, panes: [{ target: OLDER.target, window: '0', pane: '0', command: 'claude', activity: OLDER.activity, busy: OLDER.busy }] },
          { session_name: NEWEST.name, panes: [{ target: NEWEST.target, window: '0', pane: '0', command: 'codex', activity: NEWEST.activity, busy: NEWEST.busy }] },
        ],
      }),
    });
  });
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, async (route) => {
    const target = decodeURIComponent(new URL(route.request().url()).pathname.split('/panes/')[1].split('/')[0]);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: `● hello from ${target}\n▌ Type a message`, target, lines: 25 }) });
  });
});

test('dark TG session list has dark row, light name, real contrast, no overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(TERMINAL_PATH, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="terminal-session-list"]')).toBeVisible({ timeout: 15_000 });
  const bodyClass = await page.locator('body').getAttribute('class');
  expect(bodyClass || '').toContain('tg-miniapp');
  expect(bodyClass || '').not.toContain('tg-light');

  const row = page.locator('[data-testid="terminal-session-row"]').first();
  await expect(row).toBeVisible();
  const name = row.locator('.terminal-list-name');
  await expect(name).toBeVisible();

  const rowBg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  const nameColor = await name.evaluate((el) => getComputedStyle(el).color);
  const bg = parseRgb(rowBg);
  const fg = parseRgb(nameColor);
  const bgLum = luminance(bg);
  const fgLum = luminance(fg);
  expect(bgLum, `row bg should be dark, got ${rowBg} lum=${bgLum}`).toBeLessThan(0.25);
  expect(fgLum, `name color should be light, got ${nameColor} lum=${fgLum}`).toBeGreaterThan(0.55);
  expect(contrastRatio(bg, fg), `name vs row contrast, bg=${rowBg} fg=${nameColor}`).toBeGreaterThanOrEqual(4.5);

  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});
