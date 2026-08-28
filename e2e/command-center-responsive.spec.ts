import { test, expect } from '@playwright/test';

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
const SESSION_NAMES = ['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima'];

const targetFor = (name: string) => `${name}:0.0`;

async function stubCommandCenter(page) {
  await page.addInitScript(({ sessions }) => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'command-center-responsive',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {}, onEvent() {}, offEvent() {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    localStorage.setItem('agj_token', 'command-center-responsive-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'e2e', username: 'e2e', role: 'owner' }));
    localStorage.setItem('agj_terminal_groups', JSON.stringify([{ id: 'g1', name: 'Group1', sessions }]));
    localStorage.setItem('agj_terminal_active_group', 'g1');
  }, { sessions: SESSION_NAMES });

  await page.route(/telegram-web-app\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
  await page.route('**/api/auth/telegram', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'command-center-responsive-token', user: { id: 1, username: 'e2e', displayName: 'e2e', role: 'owner' } }) }));
  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
  await page.route(/\/api\/terminal\/groups(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ id: 'g1', name: 'Group1', sessions: SESSION_NAMES }], activeGroup: 'g1' }) }));
  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: SESSION_NAMES.map((name, index) => ({ session_name: name, panes: [{ target: targetFor(name), command: 'claude', activity: 100 - index, busy: name === 'alpha' }] })) }) }));
  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (route) => {
    const url = route.request().url();
    const target = decodeURIComponent(url.split('/panes/')[1]?.split('/output')[0] || '');
    const name = target.split(':')[0] || 'unknown';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: `* ${name} ready`, target, lines: 200 }) });
  });
  await page.route('**/api/agent-reminders/active', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"reminders":[]}' }));
  await page.route('**/api/agent-wakeups/pending', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"wakeups":[]}' }));
}

async function openTerminal(page, width: number) {
  await page.setViewportSize({ width, height: 820 });
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="terminal-session-row"]', { state: 'visible' }).catch(() => {});
  const firstRow = page.locator('[data-testid="terminal-session-row"]').first();
  if (await firstRow.count()) {
    await firstRow.click({ position: { x: 24, y: 18 } }).catch(() => {});
  }
  await page.waitForSelector('.terminal-shell', { state: 'visible' }).catch(() => {});
  await page.waitForTimeout(500);
}

test.beforeEach(async ({ page }) => {
  await stubCommandCenter(page);
});

test('390px transcript padding stays phone value', async ({ page }) => {
  await openTerminal(page, 390);
  const padLeft = await page.evaluate(() => {
    const el = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
    if (!el) throw new Error('transcript missing');
    return getComputedStyle(el).paddingLeft;
  });
  expect(padLeft).toBe('12px');
});

test('768px transcript/composer padding is 24px and control bar centered', async ({ page }) => {
  await openTerminal(page, 768);
  const transcriptPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  // At 768px the tablet column should expand beyond phone 12px
  expect(transcriptPad).not.toBe('12px');
  const composerPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-chat-composer') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  expect(composerPad).not.toBe('12px');
  const justify = await page.evaluate(() => {
    const el = document.querySelector('.terminal-control-bar') as HTMLElement | null;
    return getComputedStyle(el!).justifyContent;
  });
  expect(justify).toBe('center');
});

test('1024px transcript/composer/control-bar padding matches 880px column and search offset moves', async ({ page }) => {
  await openTerminal(page, 1024);
  const transcriptPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  // Desktop column should be wider than tablet/phone
  expect(transcriptPad).not.toBe('12px');
  const composerPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-chat-composer') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  expect(composerPad).not.toBe('12px');
  const controlPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-control-bar') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  expect(controlPad).not.toBe('10px');
  const searchRight = await page.evaluate(() => {
    const el = document.querySelector('.terminal-search-toggle') as HTMLElement | null;
    if (!el) return null;
    return getComputedStyle(el).right;
  });
  expect(searchRight).not.toBe('12px');
  const topbarMax = await page.evaluate(() => {
    const el = document.querySelector('.terminal-topbar-target') as HTMLElement | null;
    if (!el) return null;
    return getComputedStyle(el).maxWidth;
  });
  expect(topbarMax).toBe('260px');
});

