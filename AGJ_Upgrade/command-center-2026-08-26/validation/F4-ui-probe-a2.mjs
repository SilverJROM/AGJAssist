import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const screenshotPath = path.join(outDir, 'F4-header-a2.png');
const domPath = path.join(outDir, 'F4-dom-aria-a2.json');
const origin = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';

const sessions = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map((name, idx) => ({
  session_name: name,
  panes: [{
    target: `${idx + 1}`,
    command: 'bash',
    activity: 1787873000 - idx,
    busy: false,
    window: '0',
    pane: '0',
  }],
}));
const groupsBlob = {
  groups: [{ id: 'literal-f4-group', name: 'Literal F4 Group', sessions: sessions.map(s => s.session_name) }],
  activeGroup: 'literal-f4-group',
};

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const consoleMessages = [];
const pageErrors = [];
page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
page.on('pageerror', error => pageErrors.push(String(error)));
await page.addInitScript((blob) => {
  window.Telegram = {
    WebApp: {
      initData: 'f4-ui-probe-a2',
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
await page.route('**/api/terminal/groups', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(groupsBlob),
}));
await page.route('**/api/tmux/panes/*/output**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ target: '1', output: 'alpha ready\n$ ', lines: ['alpha ready', '$ '] }),
}));
await page.route('**/api/agent-reminders/active', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ reminders: [{ id: 'literal-reminder-42', cadence_minutes: 42 }] }),
}));
await page.route('**/api/agent-wakeups/pending', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ wakeups: [{ id: 'literal-wakeup-7', pane_target: '1', agent_name: 'alpha', manual_fire_time: '2099-01-01T00:00:00.000Z', action: 'literal wake' }] }),
}));
await page.route('**/api/summary-endpoints', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ endpoints: [{ id: 9, name: 'literal-endpoint', base_url: 'https://example.invalid', model: 'literal-model', is_default: true }] }),
}));
await page.route('**/api/summary-agents/*/summaries', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ summaries: [{ id: 5, endpoint_id: 9, summary_text: 'literal summary text for f4', created_at: '2099-01-01T00:00:00.000Z' }] }),
}));

await page.goto(`${origin}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 10000 });
await page.locator('[data-testid="terminal-session-row"]').first().click({ position: { x: 24, y: 18 } });
await page.waitForSelector('[data-testid="terminal-session-name"]', { timeout: 10000 }).catch(async (error) => {
  await page.screenshot({ path: screenshotPath, fullPage: true });
  fs.writeFileSync(domPath, JSON.stringify({
    error: String(error),
    viewport: page.viewportSize(),
    url: page.url(),
    consoleMessages,
    pageErrors,
    bodyText: (await page.locator('body').innerText()).slice(0, 2000),
    rowCount: await page.locator('[data-testid="terminal-session-row"]').count(),
    rowText: await page.locator('[data-testid="terminal-session-row"]').evaluateAll(nodes => nodes.map(n => n.textContent?.trim() || '')),
  }, null, 2));
  throw error;
});
await page.waitForTimeout(800);

async function count(id) {
  return page.locator(`[data-testid="${id}"]`).count();
}

async function visibleCount(id) {
  const locator = page.locator(`[data-testid="${id}"]`);
  const total = await locator.count();
  let visible = 0;
  for (let i = 0; i < total; i += 1) {
    if (await locator.nth(i).isVisible().catch(() => false)) visible += 1;
  }
  return visible;
}

async function rects(id) {
  return page.locator(`[data-testid="${id}"]`).evaluateAll(nodes => nodes.map((node) => {
    const r = node.getBoundingClientRect();
    return {
      text: node.textContent?.trim() || '',
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
      visible: !!(r.width || r.height),
    };
  }));
}

async function snapshot(label) {
  const topbar = page.locator('[data-term-topbar]').first();
  return {
    label,
    selectorCounts: {
      commandCenterHeader: await count('command-center-header'),
      terminalHeaderV2: await count('terminal-header-v2'),
      tabsCollapse: await count('tabs-collapse'),
      utilities: await count('utilities'),
      utilitiesCollapse: await count('utilities-collapse'),
      controlsCollapse: await count('controls-collapse'),
      bellIndicator: await count('bell-indicator'),
      reminderChip: await count('reminder-chip'),
      wakeupChip: await count('wakeup-chip'),
      summaryChip: await count('summary-chip'),
      agentGroupSwitcher: await count('agent-group-switcher'),
      terminalHeaderTab: await count('terminal-header-tab'),
    },
    visibleCounts: {
      tabsCollapse: await visibleCount('tabs-collapse'),
      utilities: await visibleCount('utilities'),
      utilitiesCollapse: await visibleCount('utilities-collapse'),
      controlsCollapse: await visibleCount('controls-collapse'),
      bellIndicator: await visibleCount('bell-indicator'),
      reminderChip: await visibleCount('reminder-chip'),
      wakeupChip: await visibleCount('wakeup-chip'),
      summaryChip: await visibleCount('summary-chip'),
      terminalHeaderTab: await visibleCount('terminal-header-tab'),
      terminalFont: await visibleCount('terminal-font-decrease'),
      myNav: await visibleCount('terminal-mynav'),
      summariesToggle: await visibleCount('summaries-toggle'),
      settings: await visibleCount('terminal-menu'),
    },
    rects: {
      topbar: await topbar.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      }),
      commandCenterHeader: await rects('command-center-header'),
      terminalHeaderV2: await rects('terminal-header-v2'),
      utilities: await rects('utilities'),
      bellIndicator: await rects('bell-indicator'),
      topbarChildren: await page.locator('.terminal-topbar-main > *').evaluateAll(nodes => nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          testId: node.getAttribute('data-testid') || '',
          className: typeof node.className === 'string' ? node.className : '',
          text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || '',
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      })),
    },
    bodyText: (await page.locator('body').innerText()).slice(0, 2000),
  };
}

const before = await snapshot('default');
await page.locator('[data-testid="utilities-collapse"]').click().catch(() => {});
await page.waitForTimeout(200);
const afterUtilitiesCollapse = await snapshot('after-utilities-collapse');
await page.locator('[data-testid="tabs-collapse"]').click().catch(() => {});
await page.waitForTimeout(200);
const afterTabsExpand = await snapshot('after-tabs-expand');

await page.screenshot({ path: screenshotPath, fullPage: true });
fs.writeFileSync(domPath, JSON.stringify({
  viewport: page.viewportSize(),
  url: page.url(),
  consoleMessages,
  pageErrors,
  snapshots: [before, afterUtilitiesCollapse, afterTabsExpand],
  ariaSnapshot: await page.locator('body').ariaSnapshot().catch(error => String(error)),
}, null, 2));

await browser.close();
