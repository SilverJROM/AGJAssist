import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const repo = process.cwd();
const validationDir = path.join(repo, 'AGJ_Upgrade/command-center-2026-08-26/validation');
const port = 3294;
const origin = `http://127.0.0.1:${port}`;
const screenshotPath = path.join(validationDir, 'F4-header-drv21-a1.png');
const domPath = path.join(validationDir, 'F4-dom-aria-drv21-a1.json');
const serverLogPath = path.join(validationDir, 'F4-ui-server-drv21-a1.log');

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/index.html`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError || new Error('server did not become ready');
}

async function isVisible(locator) {
  if (await locator.count() === 0) return false;
  return locator.evaluate((el) => {
    const node = el;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  });
}

async function main() {
  await fs.mkdir(validationDir, { recursive: true });
  await fs.writeFile(serverLogPath, '');
  const serverLog = await fs.open(serverLogPath, 'a');
  const server = spawn(process.execPath, ['e2e/static-server.mjs'], {
    cwd: repo,
    env: { ...process.env, B4_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => serverLog.appendFile(chunk));
  server.stderr.on('data', chunk => serverLog.appendFile(chunk));

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.Telegram = {
        WebApp: {
          initData: 'command-center-header-drv21',
          ready() {}, expand() {}, disableVerticalSwipes() {},
          themeParams: {}, onEvent() {}, offEvent() {},
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { selectionChanged() {} },
        },
      };
      localStorage.setItem('agj_token', 'command-center-header-drv21-token');
      localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'e2e', username: 'e2e', role: 'owner' }));
      localStorage.setItem('agj_terminal_groups', JSON.stringify([{ id: 'g1', name: 'group1', sessions: ['alpha','bravo','charlie','delta','echo','foxtrot'] }]));
      localStorage.setItem('agj_terminal_active_group', 'g1');
    });
    await page.route(/telegram-web-app\.js/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route(/\/api\/auth\/me(?:\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
    await page.route('**/api/auth/telegram', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'command-center-header-drv21-token', user: { id: 1, username: 'e2e', displayName: 'e2e', role: 'owner' } }) }));
    await page.route('**/api/tmux/sessions', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          { session_name: 'alpha', panes: [{ target: 't1', command: 'bash', activity: 1, busy: false }] },
          { session_name: 'bravo', panes: [{ target: 't2', command: 'bash', activity: 2, busy: false }] },
          { session_name: 'charlie', panes: [{ target: 't3', command: 'bash', activity: 3, busy: false }] },
          { session_name: 'delta', panes: [{ target: 't4', command: 'bash', activity: 4, busy: false }] },
          { session_name: 'echo', panes: [{ target: 't5', command: 'bash', activity: 5, busy: false }] },
          { session_name: 'foxtrot', panes: [{ target: 't6', command: 'bash', activity: 6, busy: false }] },
        ],
      }),
    }));
    await page.route('**/api/agent-reminders/active', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reminders: [{ id: 'drv21-reminder', cadence_minutes: 30 }] }) }));
    await page.route('**/api/agent-wakeups/pending', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wakeups: [{ id: 'drv21-wakeup', action: 'test' }] }) }));
    await page.route('**/api/summary-agents/*/summaries', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summaries: [{ summary_text: 'DRV21 summary signal' }] }) }));
    await page.route('**/api/summary-endpoints', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoints: [{ id: 'ep1', name: 'ep-test', is_default: true }] }) }));

    await page.goto(`${origin}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="terminal-session-row"]', { state: 'visible' });
    await page.locator('[data-testid="terminal-session-row"][data-session-target="t1"]').click({ position: { x: 24, y: 18 } });
    await page.waitForSelector('[data-testid="terminal-header-v2"]', { state: 'visible' });
    if (pageErrors.length) fail('page errors while opening terminal chat', { pageErrors });

    const tabsCollapse = page.locator('[data-testid="tabs-collapse"]');
    const switcher = page.locator('[data-testid="agent-group-switcher"]').first();
    const utilities = page.locator('[data-testid="utilities"]');
    const bell = page.locator('[data-testid="bell-indicator"]');
    const controlsCollapse = page.locator('[data-testid="controls-collapse"]');

    const defaultState = {
      tabsToggle: await tabsCollapse.textContent(),
      tabsSwitcherVisible: await isVisible(switcher),
      visibleTabCount: await page.locator('[data-testid="terminal-header-tab"]').evaluateAll(elements => elements.filter(element => element.offsetParent !== null).length),
      utilitiesVisible: await isVisible(utilities),
      bellCount: await bell.count(),
      bellVisible: await bell.count() ? await isVisible(bell) : false,
      reminderChip: await page.locator('[data-testid="reminder-chip"]').textContent(),
      wakeupChip: await page.locator('[data-testid="wakeup-chip"]').textContent(),
      summaryChip: await page.locator('[data-testid="summary-chip"]').textContent(),
    };
    if (!String(defaultState.tabsToggle).includes('Tabs')) fail('tabs collapse control missing label', defaultState);
    if (defaultState.tabsSwitcherVisible) fail('tabs were not collapsed by default', defaultState);
    if (defaultState.visibleTabCount !== 0) fail('tab buttons visible while tabs are collapsed', defaultState);
    if (!defaultState.utilitiesVisible) fail('utilities were not expanded by default', defaultState);
    if (defaultState.bellVisible) fail('bell visible before utilities are collapsed', defaultState);
    if (!String(defaultState.reminderChip).includes('drv21-reminder')) fail('reminder chip did not show mocked reminder', defaultState);
    if (!String(defaultState.wakeupChip).includes('drv21-wakeup')) fail('wakeup chip did not show mocked wakeup', defaultState);
    if (!String(defaultState.summaryChip).includes('DRV21 summary signal')) fail('summary chip did not show mocked summary', defaultState);

    await page.locator('[data-testid="utilities-collapse"]').click();
    if (await isVisible(utilities)) fail('utilities still visible after collapse');
    if (!(await isVisible(bell))) fail('bell not visible after utilities collapse');
    if (!(await isVisible(page.locator('.cc-util-icon-dot')))) fail('bell pending dot not visible with active reminder');
    const bellCountText = await page.locator('.cc-util-icon-count').textContent();
    if (bellCountText !== '1') fail('bell wakeup count did not expose pending count', { bellCountText });
    await bell.click();
    if (!(await isVisible(utilities))) fail('bell did not restore utilities');
    if (await isVisible(bell)) fail('bell still visible after utilities restore');

    await page.locator('[data-testid="utilities-collapse"]').click();
    if (!(await isVisible(controlsCollapse))) fail('controls tuck handle missing in utilities-collapsed state');
    await controlsCollapse.click();
    if (await isVisible(page.locator('[data-testid="terminal-font-decrease"]'))) fail('font controls still visible after tuck');
    if (await isVisible(page.locator('[data-testid="terminal-mynav"]'))) fail('ME navigation still visible after tuck');

    const topbarGeometry = await page.locator('[data-term-topbar]').evaluate((topbar) => {
      const main = topbar.querySelector('.terminal-topbar-main');
      if (!main) throw new Error('terminal topbar main row missing');
      const topRect = topbar.getBoundingClientRect();
      const children = [...main.children].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const bands = [];
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        const top = Math.round(rect.top);
        if (!bands.some(existing => Math.abs(existing - top) <= 4)) bands.push(top);
      }
      return {
        headerHeight: Math.round(topRect.height),
        bands,
        children: children.map(child => {
          const rect = child.getBoundingClientRect();
          return {
            testid: child.getAttribute('data-testid') || '',
            className: child.className,
            text: child.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
            ariaLabel: child.getAttribute('aria-label') || '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
          };
        }),
      };
    });
    if (topbarGeometry.bands.length !== 1) fail('fully collapsed header used more than one topbar row', topbarGeometry);
    if (topbarGeometry.headerHeight > 60) fail('fully collapsed header too tall', topbarGeometry);
    for (const child of topbarGeometry.children) {
      if (child.left < -1 || child.right > 391) fail('collapsed header child overflowed viewport', { child, topbarGeometry });
    }

    const domEvidence = {
      contract: ['H1', 'H2'],
      mechanism: 'mock non-empty reminder/wakeup/summary, collapse utilities, tuck controls, assert visible state and topbar bands',
      defaultState,
      collapsedState: {
        bellVisible: await isVisible(bell),
        bellAriaLabel: await bell.getAttribute('aria-label'),
        dotVisible: await isVisible(page.locator('.cc-util-icon-dot')),
        countText: await page.locator('.cc-util-icon-count').textContent(),
        controlsToggleText: await controlsCollapse.textContent(),
        fontDecreaseVisible: await isVisible(page.locator('[data-testid="terminal-font-decrease"]')),
        myNavVisible: await isVisible(page.locator('[data-testid="terminal-mynav"]')),
        topbarGeometry,
      },
      accessibleButtons: await page.locator('[data-term-topbar] button').evaluateAll(buttons => buttons.map(button => ({
        testid: button.getAttribute('data-testid') || '',
        ariaLabel: button.getAttribute('aria-label') || '',
        title: button.getAttribute('title') || '',
        text: button.textContent.trim().replace(/\s+/g, ' '),
        visible: button.offsetParent !== null,
      }))),
    };
    await page.locator('[data-term-topbar]').screenshot({ path: screenshotPath });
    await fs.writeFile(domPath, JSON.stringify(domEvidence, null, 2) + '\n');
    console.log(`PASS screenshot=${path.relative(repo, screenshotPath)} dom=${path.relative(repo, domPath)}`);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    await serverLog.close();
  }
}

main().catch(error => {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
});
