import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const screenshotPath = path.join(outDir, 'F4-header-v1.png');
const domPath = path.join(outDir, 'F4-dom-aria-v1.json');
const origin = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';

const sessions = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'].map((name, idx) => ({
  session_name: name,
  panes: [{
    target: `t${idx + 1}`,
    command: 'bash',
    activity: 1787874000 - idx,
    busy: false,
    window: '0',
    pane: '0',
  }],
}));
const groupsBlob = {
  groups: [{ id: 'g1', name: 'group1', sessions: sessions.map(s => s.session_name) }],
  activeGroup: 'g1',
};

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(1500);
const consoleMessages = [];
const pageErrors = [];
page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
page.on('pageerror', error => pageErrors.push(String(error)));
const requestLog = [];
page.on('request', req => requestLog.push(req.url()));
const countSummaryFetches = () => requestLog.filter(u => /\/api\/summary-agents\/.*\/summaries/.test(u)).length;

await page.addInitScript((blob) => {
  window.Telegram = {
    WebApp: {
      initData: 'f4-ui-probe-v1',
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
await page.route('**/api/auth/telegram', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ token: 'f4-ui-probe-token', user: { id: 1, username: 'f4', role: 'owner' } }),
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
  body: JSON.stringify({ target: 't1', output: 'alpha ready\n$ ', lines: ['alpha ready', '$ '] }),
}));
await page.route('**/api/agent-reminders/active', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ reminders: [{ id: 'rem-1', cadence_minutes: 30 }] }),
}));
await page.route('**/api/agent-wakeups/pending', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ wakeups: [{ id: 'wake-1', pane_target: 't1', action: 'test', manual_fire_time: '2099-01-01T00:00:00.000Z' }] }),
}));
await page.route('**/api/summary-agents/*/summaries', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ summaries: [{ id: 5, endpoint_id: 'ep1', summary_text: 'Summary signal test', created_at: '2099-01-01T00:00:00.000Z' }] }),
}));
await page.route('**/api/summary-endpoints', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ endpoints: [{ id: 'ep1', name: 'ep-test', is_default: true }] }),
}));

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

async function snapshot(label) {
  const topbar = page.locator('[data-term-topbar]').first();
  const commandCenter = page.locator('[data-testid="command-center-header"]').first();
  return {
    label,
    selectorCounts: {
      commandCenterHeader: await count('command-center-header'),
      terminalHeaderV2: await count('terminal-header-v2'),
      tabsCollapse: await count('tabs-collapse'),
      controlsCollapse: await count('controls-collapse'),
      utilities: await count('utilities'),
      utilitiesCollapse: await count('utilities-collapse'),
      bellIndicator: await count('bell-indicator'),
      reminderChip: await count('reminder-chip'),
      wakeupChip: await count('wakeup-chip'),
      summaryChip: await count('summary-chip'),
      agentGroupSwitcher: await count('agent-group-switcher'),
      terminalHeaderTab: await count('terminal-header-tab'),
    },
    visibleCounts: {
      tabsCollapse: await visibleCount('tabs-collapse'),
      controlsCollapse: await visibleCount('controls-collapse'),
      utilities: await visibleCount('utilities'),
      utilitiesCollapse: await visibleCount('utilities-collapse'),
      bellIndicator: await visibleCount('bell-indicator'),
      reminderChip: await visibleCount('reminder-chip'),
      wakeupChip: await visibleCount('wakeup-chip'),
      summaryChip: await visibleCount('summary-chip'),
      agentGroupSwitcher: await visibleCount('agent-group-switcher'),
      terminalHeaderTab: await visibleCount('terminal-header-tab'),
      terminalFontDecrease: await visibleCount('terminal-font-decrease'),
      terminalMynav: await visibleCount('terminal-mynav'),
      summariesToggle: await visibleCount('summaries-toggle'),
      terminalMenu: await visibleCount('terminal-menu'),
    },
    text: {
      commandCenterHeader: await commandCenter.innerText({ timeout: 500 }).catch(() => ''),
      body: await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(error => String(error)),
    },
    headerRows: await commandCenter.evaluate((el) => {
      const visible = [...el.querySelectorAll('*')].filter(n => n.offsetParent !== null);
      const leaves = visible.filter(n => !visible.some(other => other !== n && n.contains(other)));
      const bands = [];
      for (const n of leaves) {
        const r = n.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const band = bands.find(b => Math.abs(b.top - r.top) <= 4);
        if (band) { band.members.push(n.getAttribute('data-testid') || n.className || n.tagName); band.bottom = Math.max(band.bottom, r.bottom); }
        else bands.push({ top: r.top, bottom: r.bottom, members: [n.getAttribute('data-testid') || n.className || n.tagName] });
      }
      bands.sort((a, b) => a.top - b.top);
      return { rowCount: bands.length, bands: bands.map(b => ({ top: Math.round(b.top), bottom: Math.round(b.bottom), members: b.members })) };
    }).catch(error => ({ error: String(error) })),
    rects: {
      topbar: await topbar.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      }).catch(error => ({ error: String(error) })),
      commandCenterHeader: await commandCenter.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      }).catch(error => ({ error: String(error) })),
      topbarChildren: await page.locator('.terminal-topbar-main > *').evaluateAll(nodes => nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return {
          testId: node.getAttribute('data-testid') || '',
          className: typeof node.className === 'string' ? node.className : '',
          text: node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 100) || '',
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      })).catch(error => [{ error: String(error) }]),
    },
  };
}

const steps = [];
await page.goto(`${origin}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 10000 });
steps.push(await snapshot('list'));

await page.locator('[data-testid="terminal-session-row"][data-session-target="t1"]').click({ position: { x: 24, y: 18 } });
await page.waitForSelector('[data-testid="terminal-session-name"]', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
steps.push(await snapshot('detail-default'));

await page.locator('[data-testid="utilities-collapse"]').click().catch(() => {});
await page.waitForTimeout(200);
steps.push(await snapshot('after-utilities-collapse'));

await page.locator('[data-testid="bell-indicator"]').click().catch(() => {});
await page.waitForTimeout(200);
steps.push(await snapshot('after-bell-restore'));

await page.locator('[data-testid="tabs-collapse"]').click().catch(() => {});
await page.waitForTimeout(200);
steps.push(await snapshot('after-tabs-expand'));

await page.locator('[data-testid="tabs-collapse"]').click().catch(() => {});
await page.locator('[data-testid="utilities-collapse"]').click().catch(() => {});
await page.locator('[data-testid="controls-collapse"]').click().catch(() => {});
await page.waitForTimeout(200);
steps.push(await snapshot('fully-collapsed'));

await page.screenshot({ path: path.join(outDir, 'F4-header-v1-fully-collapsed.png') });

// Summaries freshness probe: does opening the summaries dropdown refetch?
const beforeOpen = countSummaryFetches();
await page.locator('[data-testid="controls-collapse"]').click().catch(() => {});
await page.waitForTimeout(150);
await page.locator('[data-testid="summaries-toggle"]').click().catch(() => {});
await page.waitForTimeout(600);
const afterOpen = countSummaryFetches();
const summariesFreshness = { beforeOpen, afterOpen, refetchedOnOpen: afterOpen > beforeOpen };
await page.locator('[data-testid="summaries-toggle"]').click().catch(() => {});
await page.waitForTimeout(200);

await page.locator('[data-testid="bell-indicator"]').click().catch(() => {});
await page.waitForTimeout(200);
steps.push(await snapshot('restored-default'));
await page.screenshot({ path: screenshotPath, fullPage: true });
fs.writeFileSync(domPath, JSON.stringify({
  viewport: page.viewportSize(),
  url: page.url(),
  consoleMessages,
  pageErrors,
  steps,
  summariesFreshness,
  ariaSnapshot: await page.locator('body').ariaSnapshot({ timeout: 1000 }).catch(error => String(error)),
}, null, 2));

await browser.close();
