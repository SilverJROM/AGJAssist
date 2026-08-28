import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const port = 3215;
const baseURL = `http://localhost:${port}`;
const screenshotPath = 'AGJ_Upgrade/command-center-2026-08-26/validation/D6-ui-a2.png';
const emptyShotPath = 'AGJ_Upgrade/command-center-2026-08-26/validation/D6-ui-empty-a2.png';
const domPath = 'AGJ_Upgrade/command-center-2026-08-26/validation/D6-dom-aria-a2.txt';
const findings = [];
const summaryGets = [];

const server = spawn(process.execPath, ['e2e/static-server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, B4_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/index.html`);
      if (res.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('static server did not start');
}

function byAgent(pathname) {
  const m = pathname.match(/\/api\/summary-agents\/([^/]+)\/summaries$/);
  return m ? decodeURIComponent(m[1]) : null;
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'd6-ui-probe-a2-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'd6-probe-a2', role: 'owner' }));
  });
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 1, role: 'owner' } })
  }));
  await page.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessions: [
        { session_name: 'agent-a', panes: [{ target: 'sessA:0.0', command: 'bash', activity: 1, busy: false }] },
        { session_name: 'agent-b', panes: [{ target: 'sessB:0.0', command: 'bash', activity: 1, busy: false }] }
      ]
    })
  }));
  await page.route('**/api/agent-reminders/active', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reminders: [] })
  }));
  await page.route('**/api/summary-endpoints', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      endpoints: [
        { id: 1, name: '140', base_url: 'http://192.168.254.140:1234/v1', model: 'llama3', is_default: true },
        { id: 2, name: 'test-ep', base_url: 'https://api.test/v1', model: 'gpt-4', is_default: false }
      ]
    })
  }));
  await page.route('**/api/summary-agents/**', async route => {
    const url = new URL(route.request().url());
    const agent = byAgent(url.pathname);
    summaryGets.push(url.pathname);
    const rows = agent === 'sessB:0.0' || agent === 'agent-b'
      ? [{ id: 9, agent_name: 'agent-b', endpoint_id: 1, summary_text: 'B-only summary', created_at: '2026-08-27T12:00:00Z' }]
      : [
          { id: 1, agent_name: 'agent-a', endpoint_id: 1, summary_text: 'First summary <b>RAW</b>', created_at: '2026-08-27T09:00:00Z' },
          { id: 2, agent_name: 'agent-a', endpoint_id: 2, summary_text: 'Second summary', created_at: '2026-08-27T10:00:00Z' }
        ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summaries: rows })
    });
  });

  await page.goto(`${baseURL}/index.html#/terminals`);
  const rows = page.locator('[data-testid="terminal-session-row"]');
  await rows.first().waitFor({ state: 'visible' });
  await rows.filter({ hasText: 'agent-a' }).click();
  await page.waitForSelector('[data-testid="summaries-toggle"]', { state: 'visible' });
  await page.locator('[data-testid="summaries-toggle"]').click();
  const dropdown = page.locator('[data-testid="agent-summaries-dropdown"]');
  await dropdown.waitFor({ state: 'visible' });
  await page.waitForSelector('[data-testid="summary-card"]');

  const cards = page.locator('[data-testid="summary-card"]');
  const cardCount = await cards.count();
  const card0 = (await cards.nth(0).innerText()).replace(/\s+/g, ' ').trim();
  const card1 = cardCount > 1 ? (await cards.nth(1).innerText()).replace(/\s+/g, ' ').trim() : '';
  const html0 = await cards.nth(0).innerHTML();
  const styles = await dropdown.evaluate(el => {
    const cs = getComputedStyle(el);
    return { overflow: cs.overflow, overflowY: cs.overflowY, maxHeight: cs.maxHeight, width: cs.width };
  });
  const browserStamps = await page.evaluate(() => ({
    newest: new Date('2026-08-27T10:00:00Z').toLocaleString(),
    oldest: new Date('2026-08-27T09:00:00Z').toLocaleString()
  }));
  const nodeStamps = {
    newest: new Date('2026-08-27T10:00:00Z').toLocaleString(),
    oldest: new Date('2026-08-27T09:00:00Z').toLocaleString()
  };
  const aria = await dropdown.evaluate(el => ({
    testid: el.getAttribute('data-testid'),
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    text: el.innerText.slice(0, 2000)
  }));

  if (cardCount !== 2) findings.push(`card count ${cardCount} != 2`);
  if (!card0.includes('via test-ep')) findings.push(`card0 missing via test-ep: ${card0}`);
  if (!card1.includes('via 140')) findings.push(`card1 missing via 140: ${card1}`);
  const newestFirst = card0.includes('Second summary') && card1.includes('First summary');
  if (!newestFirst) findings.push(`NOT newest-first. card0=${card0} card1=${card1}`);
  if (!card0.includes(browserStamps.newest)) findings.push(`card0 missing browser newest stamp ${browserStamps.newest}`);
  if (!card1.includes(browserStamps.oldest)) findings.push(`card1 missing browser oldest stamp ${browserStamps.oldest}`);
  if (html0.includes('<b>RAW</b>')) findings.push('summary_text HTML not escaped');
  if (styles.maxHeight !== '400px') findings.push(`maxHeight=${styles.maxHeight}`);
  if (styles.overflow !== 'auto' && styles.overflowY !== 'auto') findings.push(`overflow=${styles.overflow}/${styles.overflowY}`);
  if (!summaryGets.some(p => p.includes('/api/summary-agents/sessA%3A0.0/summaries'))) {
    findings.push(`missing sessA GET: ${JSON.stringify(summaryGets)}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.locator('[data-testid="terminal-back-list"]').click();
  await rows.filter({ hasText: 'agent-b' }).click();
  await page.waitForSelector('[data-testid="summaries-toggle"]', { state: 'visible' });
  if (await dropdown.count() === 0) {
    await page.locator('[data-testid="summaries-toggle"]').click();
    await dropdown.waitFor({ state: 'visible' });
  }
  await page.waitForTimeout(400);
  const bText = (await dropdown.innerText()).replace(/\s+/g, ' ');
  const isolated = bText.includes('B-only summary') && !bText.includes('Second summary');
  if (!isolated) findings.push(`per-agent isolation failed. dropdown=${bText} gets=${JSON.stringify(summaryGets)}`);

  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page2.addInitScript(() => {
    localStorage.setItem('agj_token', 'd6-ui-probe-a2-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'd6-probe-a2', role: 'owner' }));
  });
  await page2.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } })
  }));
  await page2.route('**/api/tmux/sessions', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sessions: [{ session_name: 'empty-agent', panes: [{ target: 'empty:0.0', command: 'bash', activity: 1, busy: false }] }] })
  }));
  await page2.route('**/api/summary-endpoints', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ endpoints: [] })
  }));
  await page2.route('**/api/summary-agents/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ summaries: [] })
  }));
  await page2.goto(`${baseURL}/index.html#/terminals`);
  await page2.locator('[data-testid="terminal-session-row"]').first().click();
  await page2.locator('[data-testid="summaries-toggle"]').click();
  await page2.waitForSelector('[data-testid="summaries-empty"]');
  const emptyText = await page2.locator('[data-testid="summaries-empty"]').innerText();
  if (!emptyText.includes('No summaries yet')) findings.push(`empty text=${emptyText}`);
  await page2.screenshot({ path: emptyShotPath, fullPage: true });

  const domDump = [
    'D6 independent UI probe a2',
    `summaryGets=${JSON.stringify(summaryGets)}`,
    `cardCount=${cardCount}`,
    `newestFirst=${newestFirst}`,
    `card0=${card0}`,
    `card1=${card1}`,
    `styles=${JSON.stringify(styles)}`,
    `aria=${JSON.stringify(aria)}`,
    `browserStamps=${JSON.stringify(browserStamps)}`,
    `nodeStamps=${JSON.stringify(nodeStamps)}`,
    `stampsMatch=${browserStamps.newest === nodeStamps.newest && browserStamps.oldest === nodeStamps.oldest}`,
    `isolated=${isolated}`,
    `bText=${bText}`,
    `emptyText=${emptyText}`,
    `html0_has_raw_b=${html0.includes('<b>RAW</b>')}`,
    `findings=${JSON.stringify(findings)}`
  ].join('\n');
  await writeFile(domPath, domDump);

  if (findings.length) {
    console.error('PROBE_FAIL ' + findings.join(' | '));
    process.exitCode = 1;
  } else {
    console.log('PROBE_PASS newestFirst=' + newestFirst + ' isolated=' + isolated);
  }
} catch (err) {
  console.error('PROBE_ERROR ' + (err && err.stack || err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
