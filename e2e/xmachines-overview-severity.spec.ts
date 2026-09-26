import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// D3 drives the production overview. Expected chip text is a literal.
// 90 -> 88 must stay critical; 88 -> 86 must leave critical.
// 70 -> 80 must stay normal; the second 80 must read warning.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATION_DIR = path.join(REPO_ROOT, 'xmachines/projcore-run-2026-09-25/validation');
const OWNER_TOKEN = 'd3-severity-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const PROVENANCE = 'collector-cli';

const WARN = 'd3-warn';
const HOLD = 'd3-hold';
const CPUW = 'd3-cpuw';
const CPUC = 'd3-cpuc';
const CREEP = 'd3-creep';
const EST = 'd3-est';
const AGED = 'd3-aged';
const FLEET = [WARN, HOLD, CPUW, CPUC, CREEP, EST, AGED];
const AGE: Record<string, string> = {
  [WARN]: '30s',
  [HOLD]: '25s',
  [CPUW]: '20s',
  [CPUC]: '15s',
  [CREEP]: '12s',
  [EST]: '18s',
  [AGED]: '900s',
};
const OCTET: Record<string, string> = {
  [WARN]: '70',
  [HOLD]: '71',
  [CPUW]: '72',
  [CPUC]: '73',
  [CREEP]: '74',
  [EST]: '75',
  [AGED]: '76',
};

const CARD = '[data-testid="xmachines-fleet-card"]';

type Scratch = {
  dir: string;
  statusPath: string;
  confPath: string;
  metricsPath: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
};

type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };

function metricsJson(holdTemp: number, creepTemp: number): string {
  return JSON.stringify({
    [WARN]: {
      gpuTempsC: [80], gpuPowerWatts: [150], uptime: '5d 0h 1m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: AGE[WARN], cpuTemp: 45,
    },
    [HOLD]: {
      gpuTempsC: [holdTemp], gpuPowerWatts: [200], uptime: '2d 3h 4m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: AGE[HOLD], cpuTemp: 46,
    },
    [CPUW]: {
      gpuTempsC: [50], gpuPowerWatts: [40], uptime: '1d 0h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: AGE[CPUW], cpuTemp: 85,
    },
    [CPUC]: {
      gpuTempsC: [52], gpuPowerWatts: [45], uptime: '0d 6h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: AGE[CPUC], cpuTemp: 95,
    },
    [CREEP]: {
      gpuTempsC: [creepTemp], gpuPowerWatts: [60], uptime: '4d 2h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: AGE[CREEP], cpuTemp: 40,
    },
    [EST]: {
      gpuTempsC: [48], uptime: '3d 0h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: AGE[EST], cpuTemp: 39,
    },
    [AGED]: {
      gpuTempsC: [40], gpuPowerWatts: [111], uptime: '9d 0h 0m',
      freshness: 'stale', provenance: PROVENANCE, sampleAge: AGE[AGED], cpuTemp: 44,
    },
  });
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd3-severity-'));
  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statusPath, `${FLEET.map((name) => `${name}  192.0.2.${OCTET[name]}  UP  leases=()  compute`).join('\n')}\n`);
  fs.writeFileSync(confPath, `${FLEET.map((name) => `${name}|192.0.2.${OCTET[name]}|02:00:00:00:00:${OCTET[name]}|agjrom|compute|true`).join('\n')}\n`);
  fs.writeFileSync(metricsPath, metricsJson(90, 70));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    D3_OWNER_TOKEN: OWNER_TOKEN,
  };
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMAC_LOG;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  delete env.XMACHINES_USE_REGISTRY;
  return { dir, statusPath, confPath, metricsPath, stateDir, env };
}

const SERVER_CHILD = `
import { createApiServer } from '__SRC__/api/server.js';
import { DatabaseService } from '__SRC__/db/database.js';
const OWNER_TOKEN = process.env.D3_OWNER_TOKEN;
const config = {
  telegram: { botToken: '123:ABC', authorizedUserId: 1, authorizedChatIds: [1], testMode: true, updateMode: 'polling', webhookUrl: null, webhookPath: '/api/telegram/webhook', webhookSecretToken: 's' },
  runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
  api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
  db: { path: ':memory:' },
  projects: { root: '/tmp' },
  tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
  overmind: { token: 't' },
};
const services = {
  authService: {
    verifyToken: (token) => (token === OWNER_TOKEN ? { id: 1, role: 'owner', username: 'owner' } : null),
    is2FAEnabled: () => false,
  },
  projectService: {}, safetyService: {}, auditService: {}, tmuxService: {}, tmuxStreamManager: {},
  db: new DatabaseService(':memory:'),
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
console.log('D3-SERVER-READY ' + app.server.address().port);
`;

async function startServer(scratch: Scratch): Promise<Server> {
  const script = path.join(scratch.dir, 'server.mts');
  fs.writeFileSync(script, SERVER_CHILD.replaceAll('__SRC__', path.join(REPO_ROOT, 'src')));
  const child = spawn('npx', ['tsx', script], {
    cwd: REPO_ROOT,
    env: scratch.env,
  }) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const match = out.match(/D3-SERVER-READY (\d+)/);
    if (match) return { child, port: Number(match[1]), stderr: () => err.slice(-800) };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`severity server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
}

async function startProxy(targetPort: number): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    headers.host = `127.0.0.1:${targetPort}`;
    headers['x-forwarded-host'] = CANONICAL_HOST;
    headers['x-forwarded-proto'] = 'https';
    if (headers.origin) headers.origin = `https://${CANONICAL_HOST}`;
    const upstream = http.request(
      { host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy error: ${error.message}`);
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type Captured = { statuses: number[]; errors: string[] };

async function openOverview(browser: Browser, base: string): Promise<{ page: Page; captured: Captured; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const captured: Captured = { statuses: [], errors: [] };
  page.on('pageerror', (error) => captured.errors.push(String(error)));
  page.on('response', (response) => {
    if (!/\/api\/xmachines\/telemetry(?:\?|$)/.test(response.url())) return;
    captured.statuses.push(response.status());
  });
  await page.route(/telegram-web-app\.js|cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: '',
  }));
  await page.addInitScript((token) => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'd3-severity',
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
    localStorage.setItem('agj_token', token as string);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'owner', username: 'owner', role: 'owner' }));
  }, OWNER_TOKEN);
  return { page, captured, close: () => context.close() };
}

async function readFleet(page: Page, base: string, captured: Captured, reload: boolean): Promise<number> {
  const before = captured.statuses.length;
  if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
  else await page.goto(`${base}/index.html#/xmachines`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(CARD, { timeout: 20_000 });
  const deadline = Date.now() + 8_000;
  while (captured.statuses.length === before && Date.now() < deadline) {
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(200);
  return captured.statuses.length - before;
}

function card(page: Page, name: string) {
  return page.locator(`${CARD}[aria-label="${name} up"]`);
}

test.describe('D3 overview severity', () => {
  test.describe.configure({ mode: 'serial', timeout: 140_000 });
  let scratch: Scratch;
  let server: Server;
  let proxy: { base: string; close: () => Promise<void> };

  test.beforeAll(async () => {
    test.setTimeout(70_000);
    scratch = newScratch();
    server = await startServer(scratch);
    proxy = await startProxy(server.port);
  });

  test.afterAll(async () => {
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    if (scratch) fs.rmSync(scratch.dir, { recursive: true, force: true });
  });

  test('holds the 3C band and waits for two samples before a GPU severity rise', async ({ browser }) => {
    const session = await openOverview(browser, proxy.base);
    const { page, captured } = session;
    const observed: string[] = [];
    const note = async (label: string) => {
      const hold = await card(page, HOLD).locator('[data-testid="xmachines-severity"]').getAttribute('data-severity');
      const holdTemp = await card(page, HOLD).locator('[data-testid="xmachines-gpu-temp"]').innerText();
      const creep = await card(page, CREEP).locator('[data-testid="xmachines-severity"]').getAttribute('data-severity');
      const creepTemp = await card(page, CREEP).locator('[data-testid="xmachines-gpu-temp"]').innerText();
      observed.push(`${label}: ${HOLD} ${holdTemp} chip=${hold}; ${CREEP} ${creepTemp} chip=${creep}`);
    };

    expect(await readFleet(page, proxy.base, captured, false), server.stderr()).toBe(1);
    expect(await readFleet(page, proxy.base, captured, true), server.stderr()).toBe(1);
    expect(captured.errors, server.stderr()).toEqual([]);
    expect(captured.statuses.every((status) => status === 200)).toBe(true);

    await expect(card(page, WARN).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'warning');
    await expect(card(page, WARN).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('80°C');
    await expect(card(page, HOLD).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'critical');
    await expect(card(page, HOLD).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('90°C');
    await expect(card(page, CREEP).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'normal');
    await expect(card(page, CREEP).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('70°C');
    await expect(card(page, CPUW).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'warning');
    await expect(card(page, CPUW).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('50°C');
    await expect(card(page, CPUC).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'critical');
    await expect(card(page, CPUC).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('52°C');
    await expect(card(page, WARN).locator('[data-testid="xmachines-power-draw"]')).toHaveText('150 W');
    await expect(card(page, WARN).locator('[data-testid="xmachines-measurement"]')).toHaveText('measured');
    await expect(card(page, WARN).locator('[data-testid="xmachines-measurement"]')).toHaveAttribute('data-measurement', 'measured');
    await expect(card(page, EST).locator('[data-testid="xmachines-measurement"]')).toHaveText('approx');
    await expect(card(page, EST).locator('[data-testid="xmachines-measurement"]')).toHaveAttribute('data-measurement', 'estimated');
    for (const name of [WARN, HOLD, CPUW, CPUC, CREEP, EST]) {
      await expect(card(page, name).locator('[data-testid="xmachines-sample-age"]')).toHaveText(AGE[name]);
      await expect(card(page, name).locator('[data-testid="xmachines-provenance"]').first()).toHaveText(PROVENANCE);
    }
    await expect(card(page, AGED).locator('[data-testid="xmachines-freshness"]')).toHaveText('stale');
    await expect(card(page, AGED).locator('[data-testid="xmachines-sample-age"]')).toHaveText('900s');
    await expect(card(page, AGED).locator('[data-testid="xmachines-gpu-temp"]')).toHaveAttribute('style', /opacity/);
    fs.mkdirSync(VALIDATION_DIR, { recursive: true });
    await page.screenshot({ path: path.join(VALIDATION_DIR, 'D3-steady-a2.png'), fullPage: true });
    await note('after two samples at 90C and 70C');

    fs.writeFileSync(scratch.metricsPath, metricsJson(88, 80));
    expect(await readFleet(page, proxy.base, captured, true)).toBe(1);
    await expect(card(page, HOLD).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('88°C');
    await expect(card(page, HOLD).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'critical');
    await expect(card(page, CREEP).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('80°C');
    await expect(card(page, CREEP).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'normal');
    await page.screenshot({ path: path.join(VALIDATION_DIR, 'D3-hysteresis-hold-a2.png'), fullPage: true });
    await note('88C still critical; first 80C still normal');

    expect(await readFleet(page, proxy.base, captured, true)).toBe(1);
    await expect(card(page, HOLD).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'critical');
    await expect(card(page, CREEP).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'warning');
    await page.screenshot({ path: path.join(VALIDATION_DIR, 'D3-persistence-a2.png'), fullPage: true });
    await note('second 80C is warning; 88C still critical');

    fs.writeFileSync(scratch.metricsPath, metricsJson(86, 80));
    expect(await readFleet(page, proxy.base, captured, true)).toBe(1);
    await expect(card(page, HOLD).locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('86°C');
    await expect(card(page, HOLD).locator('[data-testid="xmachines-severity"]')).toHaveAttribute('data-severity', 'warning');
    await page.screenshot({ path: path.join(VALIDATION_DIR, 'D3-hysteresis-clear-a2.png'), fullPage: true });
    await note('86C left critical for warning');

    const report = [
      '# D3 mutation report (attempt 2)',
      '',
      'Author: the browser DOM read by e2e/xmachines-overview-severity.spec.ts from the production overview.',
      'The production server process was not restarted. Each reload is one GET /api/xmachines/telemetry.',
      '',
      '## Fixture sequence',
      `- ${HOLD} GPU temperature literals: 90, then 88, then 86.`,
      `- ${CREEP} GPU temperature literals: 70, then 80, then 80.`,
      '',
      '## Chips read back from the page',
      ...observed.map((line) => `- ${line}`),
      '',
      `Telemetry HTTP statuses: ${captured.statuses.join(',')}`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(VALIDATION_DIR, 'D3-mutation-report-a2.md'), report);
    await session.close();
  });
});
