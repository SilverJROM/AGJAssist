import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const screenshotPath = path.join(outDir, 'F4-header-a1.png');
const domPath = path.join(outDir, 'F4-dom-aria-a1.txt');
const origin = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';

const sessions = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map((name, idx) => ({
  session_name: name,
  panes: [{ target: `${idx + 1}`, command: 'bash', activity: 1787870000 - idx, busy: false, window: '0', pane: '0' }],
}));
const groupsBlob = {
  groups: [{ id: 'g-redteam', name: 'Redteam Literal Group', sessions: sessions.map(s => s.session_name) }],
  activeGroup: 'g-redteam',
};

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript((blob) => {
  window.Telegram = {
    WebApp: {
      initData: 'f4-ui-probe',
      ready() {},
      expand() {},
      disableVerticalSwipes() {},
      themeParams: {},
      onEvent() {},
      offEvent() {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { selectionChanged() {} },
    },
  };
  localStorage.setItem('agj_token', 'f4-ui-probe-token');
  localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'f4', username: 'f4', role: 'owner' }));
  localStorage.setItem('agj_terminal_groups', JSON.stringify(blob.groups));
  localStorage.setItem('agj_terminal_active_group', blob.activeGroup);
}, groupsBlob);

await page.route(/telegram-web-app\.js/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.route('**/api/auth/me', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ id: 1, username: 'f4', display_name: 'f4', role: 'owner', totp_enabled: false }),
}));
await page.route('**/api/tmux/sessions', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ sessions }),
}));
await page.route('**/api/terminal/groups', route => {
  if (route.request().method() === 'PUT') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groupsBlob) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groupsBlob) });
});
await page.route('**/api/tmux/panes/*/output**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ target: '1', output: 'alpha ready\n$ ', lines: ['alpha ready', '$ '] }),
}));
await page.route('**/api/agent-reminders/active', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ reminders: [{ id: 'literal-reminder', cadence_minutes: 42 }] }),
}));
await page.route('**/api/agent-wakeups/pending', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ wakeups: [{ id: 7, agent_name: 'alpha', manual_fire_time: '2099-01-01T00:00:00.000Z', action: 'literal wake' }] }),
}));
await page.route('**/api/summary-endpoints', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ endpoints: [{ id: 9, name: 'literal-endpoint', base_url: 'https://example.invalid', model: 'literal-model', is_default: true }] }),
}));

await page.goto(`${origin}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="terminal-session-name"], [data-testid="terminal-session-row"]', { timeout: 10000 });
const firstRow = page.locator('[data-testid="terminal-session-row"]').first();
if (await firstRow.count()) {
  await firstRow.click();
  await page.waitForSelector('[data-testid="terminal-session-name"]', { timeout: 10000 });
}
await page.waitForTimeout(500);

const selectors = [
  'terminal-header-v2',
  'command-center-header',
  'tabs-collapse',
  'agent-group-switcher',
  'terminal-header-tab',
  'reminder-chip',
  'wakeup-chip',
  'summaries-toggle',
];

const selectorCounts = {};
for (const id of selectors) {
  selectorCounts[id] = await page.locator(`[data-testid="${id}"]`).count();
}

const topbar = page.locator('[data-term-topbar]').first();
const body = page.locator('body');
const ariaText = await body.ariaSnapshot().catch(async () => {
  const buttons = await page.locator('button').evaluateAll(nodes => nodes.map(node => ({
    text: node.textContent?.trim() || '',
    ariaLabel: node.getAttribute('aria-label') || '',
    testId: node.getAttribute('data-testid') || '',
  })));
  return JSON.stringify({ buttons }, null, 2);
});
const metrics = {
  viewport: page.viewportSize(),
  url: page.url(),
  selectorCounts,
  topbarRect: await topbar.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }).catch(error => ({ error: String(error) })),
  bodyText: (await body.innerText()).slice(0, 2000),
  topbarHtml: await topbar.evaluate(el => el.outerHTML).catch(error => String(error)),
  ariaSnapshot: ariaText,
};

await page.screenshot({ path: screenshotPath, fullPage: true });
fs.writeFileSync(domPath, JSON.stringify(metrics, null, 2));

await browser.close();
