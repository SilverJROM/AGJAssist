import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const port = 3212;
const baseURL = `http://localhost:${port}`;
const screenshotPath = 'AGJ_Upgrade/command-center-2026-08-26/validation/D5-ui-a3.png';
const domPath = 'AGJ_Upgrade/command-center-2026-08-26/validation/D5-dom-aria-a3.txt';

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

const endpoints = [
  { id: 1, name: '140', base_url: 'http://192.168.254.140:1234/v1', model: 'llama3', is_default: true },
  { id: 2, name: 'test-ep', base_url: 'https://api.test/v1', model: 'gpt-4', is_default: false }
];
const calls = [];

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'd5-ui-probe-a3-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'd5-probe', role: 'owner' }));
  });
  await page.route('**/api/auth/me', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1, role: 'owner' } }) });
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
  await page.route('**/api/summary-endpoints**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    calls.push(`${method} ${url.pathname}`);
    if (method === 'PATCH') {
      const body = await req.postDataJSON();
      if (url.pathname !== '/api/summary-endpoints/2') throw new Error(`wrong PATCH path ${url.pathname}`);
      if (body.name !== 'test-ep-edited' || body.base_url !== 'https://api.edited/v1' || body.model !== 'gpt-4-edited') {
        throw new Error(`wrong PATCH payload ${JSON.stringify(body)}`);
      }
      endpoints[1] = { ...endpoints[1], ...body };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoint: endpoints[1] }) });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/summary-endpoints/2/default') {
      endpoints.forEach(ep => { ep.is_default = ep.id === 2; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoint: endpoints[1] }) });
      return;
    }
    if (method === 'DELETE') {
      if (url.pathname !== '/api/summary-endpoints/2') throw new Error(`wrong DELETE path ${url.pathname}`);
      endpoints.splice(1, 1);
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === 'POST') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Owner role required for summary endpoints' })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoints }) });
  });

  await page.goto(`${baseURL}/index.html#/terminals`);
  await page.locator('[data-testid="terminal-session-row"]').first().click();
  await page.locator('[data-testid="terminal-menu"]').click();
  await page.locator('[data-testid="endpoint-edit"]').nth(1).click();
  await page.locator('[data-testid="endpoint-name-input"]').fill('test-ep-edited');
  await page.locator('[data-testid="endpoint-baseurl-input"]').fill('https://api.edited/v1');
  await page.locator('[data-testid="endpoint-model-input"]').fill('gpt-4-edited');
  await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/api/summary-endpoints/2') && resp.request().method() === 'PATCH'),
    page.locator('[data-testid="endpoint-save"]').click()
  ]);
  await page.waitForFunction(() => document.body.innerText.includes('test-ep-edited'));

  await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/api/summary-endpoints/2/default') && resp.request().method() === 'POST'),
    page.locator('[data-testid="endpoint-default-radio"]').nth(1).click()
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="endpoint-default-radio"]')[1]?.checked === true);

  await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/api/summary-endpoints/2') && resp.request().method() === 'DELETE'),
    page.locator('[data-testid="endpoint-delete"]').nth(1).click()
  ]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="endpoint-row"]').length === 1);

  await page.locator('[data-testid="endpoint-name-input"]').fill('bad');
  await page.locator('[data-testid="endpoint-baseurl-input"]').fill('https://bad/v1');
  await page.locator('[data-testid="endpoint-model-input"]').fill('bad-model');
  await page.locator('[data-testid="endpoint-save"]').click();
  await page.waitForSelector('[data-testid="endpoint-error"]');

  const bodyText = await page.locator('body').innerText();
  let aria = '';
  const bodyLocator = page.locator('body');
  if (typeof bodyLocator.ariaSnapshot === 'function') {
    aria = await bodyLocator.ariaSnapshot();
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(domPath, [
    'D5 UI probe a3',
    `URL: ${page.url()}`,
    `CALLS: ${calls.join(' | ')}`,
    '',
    'BODY TEXT:',
    bodyText,
    '',
    'ARIA SNAPSHOT:',
    aria
  ].join('\n'));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
