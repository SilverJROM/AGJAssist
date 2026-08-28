import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const port = 3211;
const baseURL = `http://localhost:${port}`;
const screenshotPath = 'AGJ_Upgrade/command-center-2026-08-26/validation/D5-owner-error-a1.png';
const domPath = 'AGJ_Upgrade/command-center-2026-08-26/validation/D5-dom-aria-a1.txt';

const server = spawn(process.execPath, ['e2e/static-server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, B4_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/index.html`);
      if (res.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`static server did not start: ${serverOutput}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'd5-owner-error-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 2, name: 'd5-member', role: 'member' }));
  });
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: 2, name: 'd5-member', role: 'member' } })
    });
  });
  await page.route('**/api/tmux/sessions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ session_name: 'probe', panes: [{ target: '1', command: 'bash', activity: 1, busy: false }] }] })
    });
  });
  await page.route('**/api/agent-reminders/active', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reminders: [] }) });
  });
  await page.route('**/api/summary-endpoints', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Owner role required for summary endpoints' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ endpoints: [{ id: 1, name: '140', base_url: 'http://192.168.254.140:1234/v1', model: 'llama3', is_default: true }] })
    });
  });

  await page.goto(`${baseURL}/index.html#/terminals`);
  await page.locator('[data-testid="terminal-session-row"]').first().click();
  await page.locator('[data-testid="terminal-menu"]').click();
  await page.locator('[data-testid="endpoint-name-input"]').fill('blocked-member-endpoint');
  await page.locator('[data-testid="endpoint-baseurl-input"]').fill('https://blocked.example/v1');
  await page.locator('[data-testid="endpoint-model-input"]').fill('blocked-model');
  await page.locator('[data-testid="endpoint-save"]').click();
  await page.waitForTimeout(500);

  const bodyText = await page.locator('body').innerText();
  let aria = '';
  const bodyLocator = page.locator('body');
  if (typeof bodyLocator.ariaSnapshot === 'function') {
    try {
      aria = await bodyLocator.ariaSnapshot();
    } catch (error) {
      aria = `ariaSnapshot failed: ${error.message}`;
    }
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(domPath, [
    'D5 owner-only error probe',
    `URL: ${page.url()}`,
    '',
    'BODY TEXT:',
    bodyText,
    '',
    'ARIA SNAPSHOT:',
    aria || '<not available>'
  ].join('\n'));

  if (!/(owner|permission|forbidden|denied|required)/i.test(bodyText)) {
    throw new Error('No visible owner/permission error after POST /api/summary-endpoints returned 403');
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
