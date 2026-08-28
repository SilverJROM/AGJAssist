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

test('768px transcript/composer padding is 16px and control bar centered', async ({ page }) => {
  await openTerminal(page, 768);
  const transcriptPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  expect(transcriptPad).toBe('16px');
  const composerPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-chat-composer') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  expect(composerPad).toBe('16px');
  const controlPad = await page.evaluate(() => {
    const el = document.querySelector('.terminal-control-bar') as HTMLElement | null;
    return getComputedStyle(el!).paddingLeft;
  });
  expect(controlPad).toBe('10px');
  const justify = await page.evaluate(() => {
    const el = document.querySelector('.terminal-control-bar') as HTMLElement | null;
    return getComputedStyle(el!).justifyContent;
  });
  expect(justify).toBe('center');
  const btnStyle = await page.evaluate(() => {
    const btn = document.querySelector('.terminal-control-bar button') as HTMLElement | null;
    if (!btn) return null;
    const s = getComputedStyle(btn);
    return { flexGrow: s.flexGrow, flexBasis: s.flexBasis, maxWidth: s.maxWidth };
  });
  expect(btnStyle).not.toBeNull();
  expect(btnStyle!.flexGrow).toBe('0');
  expect(btnStyle!.flexBasis).toBe('72px');
  expect(btnStyle!.maxWidth).toBe('88px');
  const topbarMax = await page.evaluate(() => {
    const el = document.querySelector('.terminal-topbar-target') as HTMLElement | null;
    if (!el) return null;
    return getComputedStyle(el).maxWidth;
  });
  expect(topbarMax).toBe('220px');
});

test('1024px transcript/composer/control-bar padding matches 880px column and search offset moves', async ({ page }) => {
  await openTerminal(page, 1024);
  const desktopLayout = await page.evaluate(() => {
    const transcript = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
    const composer = document.querySelector('.terminal-chat-composer') as HTMLElement | null;
    const controlBar = document.querySelector('.terminal-control-bar') as HTMLElement | null;
    const searchToggle = document.querySelector('.terminal-search-toggle') as HTMLElement | null;
    if (!transcript || !composer || !controlBar || !searchToggle) throw new Error('desktop terminal controls missing');

    const paddingFor = (element: HTMLElement, minimum: number) =>
      Math.max(minimum, (element.parentElement!.getBoundingClientRect().width - 880) / 2);
    return {
      transcriptPadding: parseFloat(getComputedStyle(transcript).paddingLeft),
      composerPadding: parseFloat(getComputedStyle(composer).paddingLeft),
      controlPadding: parseFloat(getComputedStyle(controlBar).paddingLeft),
      searchRight: parseFloat(getComputedStyle(searchToggle).right),
      expectedTranscriptPadding: paddingFor(transcript, 24),
      expectedComposerPadding: paddingFor(composer, 24),
      expectedControlPadding: paddingFor(controlBar, 16),
      expectedSearchRight: paddingFor(searchToggle, 16),
    };
  });
  expect(desktopLayout.transcriptPadding).toBeCloseTo(desktopLayout.expectedTranscriptPadding, 2);
  expect(desktopLayout.composerPadding).toBeCloseTo(desktopLayout.expectedComposerPadding, 2);
  expect(desktopLayout.controlPadding).toBeCloseTo(desktopLayout.expectedControlPadding, 2);
  expect(desktopLayout.searchRight).toBeCloseTo(desktopLayout.expectedSearchRight, 2);
  const topbarMax = await page.evaluate(() => {
    const el = document.querySelector('.terminal-topbar-target') as HTMLElement | null;
    if (!el) return null;
    return getComputedStyle(el).maxWidth;
  });
  expect(topbarMax).toBe('260px');
  const btnStyle = await page.evaluate(() => {
    const btn = document.querySelector('.terminal-control-bar button') as HTMLElement | null;
    if (!btn) return null;
    const s = getComputedStyle(btn);
    return { flexGrow: s.flexGrow, flexBasis: s.flexBasis, maxWidth: s.maxWidth };
  });
  expect(btnStyle).not.toBeNull();
  expect(btnStyle!.flexGrow).toBe('0');
  expect(btnStyle!.flexBasis).toBe('72px');
  expect(btnStyle!.maxWidth).toBe('88px');
});

test('1440px caps the terminal chat column at the literal 880px desktop specimen', async ({ page }) => {
  await openTerminal(page, 1440);
  const wideLayout = await page.evaluate(() => {
    const transcript = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
    const composer = document.querySelector('.terminal-chat-composer') as HTMLElement | null;
    const controlBar = document.querySelector('.terminal-control-bar') as HTMLElement | null;
    const searchToggle = document.querySelector('.terminal-search-toggle') as HTMLElement | null;
    if (!transcript || !composer || !controlBar || !searchToggle) throw new Error('wide terminal controls missing');

    const paddingFor = (element: HTMLElement, minimum: number) =>
      Math.max(minimum, (element.parentElement!.getBoundingClientRect().width - 880) / 2);
    const transcriptStyle = getComputedStyle(transcript);
    const composerStyle = getComputedStyle(composer);
    const controlStyle = getComputedStyle(controlBar);
    const searchStyle = getComputedStyle(searchToggle);
    const transcriptContentWidth = transcript.getBoundingClientRect().width
      - parseFloat(transcriptStyle.paddingLeft) - parseFloat(transcriptStyle.paddingRight);

    return {
      transcriptPadding: parseFloat(transcriptStyle.paddingLeft),
      composerPadding: parseFloat(composerStyle.paddingLeft),
      controlPadding: parseFloat(controlStyle.paddingLeft),
      searchRight: parseFloat(searchStyle.right),
      expectedTranscriptPadding: paddingFor(transcript, 24),
      expectedComposerPadding: paddingFor(composer, 24),
      expectedControlPadding: paddingFor(controlBar, 16),
      expectedSearchRight: paddingFor(searchToggle, 16),
      transcriptContentWidth,
    };
  });

  expect(wideLayout.transcriptPadding).toBeGreaterThan(24);
  expect(wideLayout.composerPadding).toBeGreaterThan(24);
  expect(wideLayout.transcriptPadding).toBeCloseTo(wideLayout.expectedTranscriptPadding, 2);
  expect(wideLayout.composerPadding).toBeCloseTo(wideLayout.expectedComposerPadding, 2);
  expect(wideLayout.controlPadding).toBeCloseTo(wideLayout.expectedControlPadding, 2);
  expect(wideLayout.searchRight).toBeCloseTo(wideLayout.expectedSearchRight, 2);
  expect(wideLayout.transcriptContentWidth).toBeCloseTo(880, 2);
  expect(wideLayout.transcriptContentWidth).toBeLessThan(1000);
});
