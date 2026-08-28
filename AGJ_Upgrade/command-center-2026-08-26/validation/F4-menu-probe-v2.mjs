import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('AGJ_Upgrade/command-center-2026-08-26/validation');
const screenshotPath = path.join(outDir, 'F4-menu-v2.png');
const domPath = path.join(outDir, 'F4-menu-probe-v2.json');
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
      initData: 'f4-ui-probe-v2',
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


const countReminderFetches = () => requestLog.filter(u => /\/api\/agent-reminders\/active/.test(u)).length;
const countWakeupFetches  = () => requestLog.filter(u => /\/api\/agent-wakeups\/pending/.test(u)).length;

await page.goto(`${origin}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="terminal-session-row"]', { timeout: 10000 });
await page.locator('[data-testid="terminal-session-row"][data-session-target="t1"]').click({ position: { x: 24, y: 18 } });
await page.waitForSelector('[data-testid="terminal-session-name"]', { timeout: 5000 });
await page.waitForTimeout(800);

const onMount = { reminders: countReminderFetches(), wakeups: countWakeupFetches() };

// Nothing else is open: click the gear directly.
const menuBtn = page.locator('[data-testid="terminal-menu"]');
const menuVisibleBeforeClick = await menuBtn.isVisible().catch(() => false);
let clickError = null;
try { await menuBtn.click({ timeout: 3000 }); } catch (e) { clickError = String(e).split('\n')[0]; }
await page.waitForTimeout(800);
const menuExpanded = await menuBtn.getAttribute('aria-expanded').catch(() => null);
const afterMenuOpen = { reminders: countReminderFetches(), wakeups: countWakeupFetches() };

await page.screenshot({ path: screenshotPath, fullPage: false });
fs.writeFileSync(domPath, JSON.stringify({
  viewport: page.viewportSize(),
  pageErrors,
  menuVisibleBeforeClick,
  clickError,
  menuExpanded,
  onMount,
  afterMenuOpen,
  refetchedOnMenuOpen: {
    reminders: afterMenuOpen.reminders > onMount.reminders,
    wakeups: afterMenuOpen.wakeups > onMount.wakeups,
  },
  reminderRequests: requestLog.filter(u => /agent-reminders|agent-wakeups/.test(u)),
}, null, 2));
console.log(JSON.stringify({ menuVisibleBeforeClick, clickError, menuExpanded, onMount, afterMenuOpen }));
await browser.close();
