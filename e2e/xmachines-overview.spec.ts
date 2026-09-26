import { expect, test, type Browser, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// D2 drives the production read route. Expected card text is literal.
// The status-line role is deliberately not the machines.conf role, so a
// renderer that printed the unselected status tail would fail.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATION_DIR = path.join(REPO_ROOT, 'xmachines/projcore-run-2026-09-25/validation');
const RENDERER = path.join(REPO_ROOT, 'src/web/public/xmachines-cost-view.js');
const APP_JS = path.join(REPO_ROOT, 'src/web/public/app.js');
const OWNER_TOKEN = 'd2-overview-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';

const QUARTZ = 'd2-quartz';
const BASALT = 'd2-basalt';
const SLATE = 'd2-slate';
const ONYX = 'd2-onyx';
const CINDER = 'd2-cinder';

const BASE_NAMES = [QUARTZ, BASALT, SLATE, ONYX];
const STATUS_ROLE = {
  [QUARTZ]: 'status-line-role-quartz',
  [BASALT]: 'status-line-role-basalt',
  [SLATE]: 'status-line-role-slate',
  [ONYX]: 'status-line-role-onyx',
};
const CONF_HINT = {
  [QUARTZ]: 'conf-hint-ember',
  [BASALT]: 'conf-hint-media',
  [SLATE]: 'conf-hint-archive',
  [ONYX]: 'conf-hint-spare',
};
const CINDER_HINT = 'fifth-status-hint';

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

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function statusLines(withFifth: boolean): string {
  const rows = [
    `${QUARTZ}  192.0.2.40  UP  leases=()  ${STATUS_ROLE[QUARTZ]}`,
    `${BASALT}  192.0.2.41  UP  leases=()  ${STATUS_ROLE[BASALT]}`,
    `${SLATE}  192.0.2.42  DOWN  leases=()  ${STATUS_ROLE[SLATE]}`,
    `${ONYX}  192.0.2.43  DOWN  leases=()  ${STATUS_ROLE[ONYX]}`,
  ];
  if (withFifth) rows.push(`${CINDER}  192.0.2.44  UP  leases=()  ${CINDER_HINT}`);
  return `${rows.join('\n')}\n`;
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-overview-'));
  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statusPath, statusLines(false));
  fs.writeFileSync(confPath, [
    `${QUARTZ}|192.0.2.40|02:00:00:00:00:40|agjrom|${CONF_HINT[QUARTZ]}|true`,
    `${BASALT}|192.0.2.41|02:00:00:00:00:41|agjrom|${CONF_HINT[BASALT]}|true`,
    `${SLATE}|192.0.2.42|02:00:00:00:00:42|agjrom|${CONF_HINT[SLATE]}|true`,
    `${ONYX}|192.0.2.43|02:00:00:00:00:43|agjrom|${CONF_HINT[ONYX]}|true`,
    '',
  ].join('\n'));
  fs.writeFileSync(metricsPath, JSON.stringify({
    [QUARTZ]: {
      gpuTempsC: [61, 73], gpuPowerWatts: [120, 67], uptime: '9d 4h 12m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '41s', cpuTemp: 48,
    },
    [BASALT]: {
      gpuTempsC: [55], gpuPowerWatts: [96], uptime: '3d 1h 5m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '18s', cpuTemp: 44,
    },
    [SLATE]: {
      gpuTempsC: [61, 73], gpuPowerWatts: [120, 67], uptime: '9d 4h 12m',
      freshness: 'stale', sampleAge: '900s',
    },
    [ONYX]: {
      gpuTempsC: [70], gpuPowerWatts: [150], uptime: '1d 2h 3m',
      freshness: 'stale', sampleAge: '1200s',
    },
    [CINDER]: {
      gpuTempsC: [47], gpuPowerWatts: [31], uptime: '0d 0h 22m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '12s', cpuTemp: 39,
    },
  }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    D2_OWNER_TOKEN: OWNER_TOKEN,
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
const OWNER_TOKEN = process.env.D2_OWNER_TOKEN;
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
console.log('D2-SERVER-READY ' + app.server.address().port);
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
  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    const match = out.match(/D2-SERVER-READY (\d+)/);
    if (match) return { child, port: Number(match[1]), stderr: () => err.slice(-800) };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`overview server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
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

type Captured = {
  statuses: number[];
  payloads: Array<{ machines?: Array<Record<string, unknown>> }>;
  errors: string[];
};

async function openOverview(browser: Browser, base: string): Promise<{ page: Page; captured: Captured; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const captured: Captured = { statuses: [], payloads: [], errors: [] };
  page.on('pageerror', (error) => captured.errors.push(String(error)));
  page.on('response', async (response) => {
    if (!/\/api\/xmachines\/telemetry(?:\?|$)/.test(response.url())) return;
    captured.statuses.push(response.status());
    try { captured.payloads.push(await response.json()); } catch { /* non-json */ }
  });
  await page.route(/telegram-web-app\.js|cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: '',
  }));
  await page.addInitScript((token) => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'd2-overview',
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
  await page.goto(`${base}/index.html#/xmachines`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(CARD, { timeout: 20_000 });
  const payloadDeadline = Date.now() + 5_000;
  while (captured.payloads.length === 0 && Date.now() < payloadDeadline) {
    await page.waitForTimeout(50);
  }
  return { page, captured, close: () => context.close() };
}

async function cardSnapshot(page: Page) {
  return page.locator(CARD).evaluateAll((nodes) => nodes.map((el) => {
    const pick = (selector: string) => {
      const found = el.querySelector(selector);
      return found ? (found.textContent || '').trim() : null;
    };
    return {
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      tag: el.tagName,
      powerState: pick('[data-testid="xmachines-power-state"]'),
      gpuTemp: pick('[data-testid="xmachines-gpu-temp"]'),
      powerWatts: pick('[data-testid="xmachines-power-draw"]'),
      uptime: pick('[data-testid="xmachines-uptime"]'),
      roleHint: pick('[data-testid="xmachines-role-hint"]'),
      roleHintTag: el.querySelector('[data-testid="xmachines-role-hint"]')?.tagName || null,
      alerts: el.querySelectorAll('[role="alert"]').length,
    };
  }));
}

test.describe('D2 fleet overview', () => {
  test.describe.configure({ mode: 'serial', timeout: 150_000 });
  let scratch: Scratch;
  let server: Server;
  let proxy: { base: string; close: () => Promise<void> };

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    scratch = newScratch();
    server = await startServer(scratch);
    proxy = await startProxy(server.port);
  });

  test.afterAll(async () => {
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    if (scratch) fs.rmSync(scratch.dir, { recursive: true, force: true });
  });

  test('renders registry literals and a fifth status-only machine', async ({ browser }) => {
    const sourceBefore = { renderer: sha256(RENDERER), app: sha256(APP_JS) };
    const confBefore = sha256(scratch.confPath);
    const metricsBefore = sha256(scratch.metricsPath);
    const pidBefore = server.child.pid;

    const first = await openOverview(browser, proxy.base);
    const firstCards = await cardSnapshot(first.page);
    const firstPayload = first.captured.payloads.at(-1);
    fs.mkdirSync(VALIDATION_DIR, { recursive: true });
    await first.page.screenshot({ path: path.join(VALIDATION_DIR, 'D2-overview-a2.png'), fullPage: true });
    const firstDom = {
      hash: await first.page.evaluate(() => location.hash),
      heading: await first.page.locator('[data-testid="xmachines-fleet-overview"] h1').innerText(),
      overviewAria: await first.page.locator('[data-testid="xmachines-fleet-overview"]').getAttribute('aria-label'),
      cards: firstCards,
      telemetryStatus: first.captured.statuses,
      telemetryNames: (firstPayload?.machines || []).map((machine) => machine.name),
      pageErrors: first.captured.errors,
    };
    fs.writeFileSync(path.join(VALIDATION_DIR, 'D2-overview-dom-a2.json'), JSON.stringify(firstDom, null, 2));

    expect(first.captured.errors, server.stderr()).toEqual([]);
    expect(first.captured.statuses).toContain(200);
    expect(firstDom.hash).toBe('#/xmachines');
    expect(firstDom.heading).toBe('Fleet overview');
    expect(firstDom.overviewAria).toBe('Fleet overview');
    expect(firstDom.telemetryNames).toEqual(BASE_NAMES);
    expect(firstCards.map((card) => card.ariaLabel)).toEqual([
      `${QUARTZ} up`,
      `${BASALT} up`,
      `${SLATE} offline`,
      `${ONYX} offline`,
    ]);

    const byLabel = new Map(firstCards.map((card) => [card.ariaLabel, card]));
    const quartz = byLabel.get(`${QUARTZ} up`);
    const basalt = byLabel.get(`${BASALT} up`);
    const slate = byLabel.get(`${SLATE} offline`);
    const onyx = byLabel.get(`${ONYX} offline`);
    expect(quartz?.powerState).toBe('up');
    expect(quartz?.gpuTemp).toBe('73°C');
    expect(quartz?.powerWatts).toBe('187 W');
    expect(quartz?.uptime).toBe('9d 4h 12m');
    expect(quartz?.roleHint).toBe(CONF_HINT[QUARTZ]);
    expect(quartz?.roleHintTag).toBe('SPAN');
    expect(quartz?.ariaLabel).not.toContain(CONF_HINT[QUARTZ]);
    expect(quartz?.text).not.toContain(STATUS_ROLE[QUARTZ]);
    expect(basalt?.powerState).toBe('up');
    expect(basalt?.gpuTemp).toBe('55°C');
    expect(basalt?.powerWatts).toBe('96 W');
    expect(basalt?.uptime).toBe('3d 1h 5m');
    expect(basalt?.roleHint).toBe(CONF_HINT[BASALT]);
    expect(basalt?.text).not.toContain(STATUS_ROLE[BASALT]);
    expect(slate?.powerState).toBe('offline');
    expect(slate?.gpuTemp).toBeNull();
    expect(slate?.powerWatts).toBeNull();
    expect(slate?.uptime).toBeNull();
    expect(slate?.alerts).toBe(0);
    expect(slate?.text).toContain('offline');
    expect(slate?.text.toLowerCase()).not.toContain('error');
    expect(slate?.text).not.toContain('73°C');
    expect(slate?.text).not.toContain('9d 4h 12m');
    expect(slate?.roleHint).toBe(CONF_HINT[SLATE]);
    expect(slate?.ariaLabel).not.toContain(CONF_HINT[SLATE]);
    expect(onyx?.powerState).toBe('offline');
    expect(onyx?.gpuTemp).toBeNull();
    expect(onyx?.text).not.toContain('70°C');
    expect(onyx?.roleHint).toBe(CONF_HINT[ONYX]);
    for (const synthetic of ['gpu', 'hdd', 'gpu2', 'media']) {
      expect(firstDom.telemetryNames).not.toContain(synthetic);
      expect(firstCards.some((card) => card.ariaLabel?.startsWith(`${synthetic} `))).toBe(false);
    }
    await first.close();

    fs.writeFileSync(scratch.statusPath, statusLines(true));
    const second = await openOverview(browser, proxy.base);
    const secondCards = await cardSnapshot(second.page);
    const secondPayload = second.captured.payloads.at(-1);
    await second.page.screenshot({ path: path.join(VALIDATION_DIR, 'D2-fifth-a2.png'), fullPage: true });
    const secondDom = {
      cards: secondCards,
      telemetryStatus: second.captured.statuses,
      telemetryNames: (secondPayload?.machines || []).map((machine) => machine.name),
      pageErrors: second.captured.errors,
    };
    fs.writeFileSync(path.join(VALIDATION_DIR, 'D2-fifth-dom-a2.json'), JSON.stringify(secondDom, null, 2));

    const sourceAfter = { renderer: sha256(RENDERER), app: sha256(APP_JS) };
    const cinder = secondCards.find((card) => card.ariaLabel === `${CINDER} up`);
    expect(second.captured.errors, server.stderr()).toEqual([]);
    expect(secondDom.telemetryNames).toEqual([...BASE_NAMES, CINDER]);
    expect(secondCards).toHaveLength(5);
    expect(cinder?.powerState).toBe('up');
    expect(cinder?.gpuTemp).toBe('47°C');
    expect(cinder?.powerWatts).toBe('31 W');
    expect(cinder?.uptime).toBe('0d 0h 22m');
    expect(cinder?.roleHint).toBe(CINDER_HINT);
    expect(cinder?.ariaLabel).toBe(`${CINDER} up`);
    expect(cinder?.ariaLabel).not.toContain(CINDER_HINT);
    expect(sourceAfter).toEqual(sourceBefore);
    expect(sha256(scratch.confPath)).toBe(confBefore);
    expect(sha256(scratch.metricsPath)).toBe(metricsBefore);
    expect(server.child.pid).toBe(pidBefore);
    expect(server.child.exitCode).toBeNull();

    const report = [
      '# D2 mutation report (attempt 2)',
      '',
      'Author: e2e/xmachines-overview.spec.ts, from the live browser and GET /api/xmachines/telemetry.',
      'The production server process was not restarted. Renderer and app source were not edited between the two loads.',
      '',
      '## Fixture mutation',
      `- Only ${scratch.statusPath} was rewritten, appending the literal status line for ${CINDER}.`,
      `- machines.conf sha256 unchanged: ${confBefore}`,
      `- telemetry fixture sha256 unchanged: ${metricsBefore}`,
      `- ${CINDER} metrics were already in the telemetry fixture before the first load and did not appear until the status line was added.`,
      '',
      '## Source unchanged',
      `- src/web/public/xmachines-cost-view.js sha256 before=${sourceBefore.renderer} after=${sourceAfter.renderer}`,
      `- src/web/public/app.js sha256 before=${sourceBefore.app} after=${sourceAfter.app}`,
      `- server pid before=${pidBefore} after=${server.child.pid}`,
      '',
      '## Production read route',
      `- First GET /api/xmachines/telemetry HTTP ${firstDom.telemetryStatus.join(',')} names: ${JSON.stringify(firstDom.telemetryNames)}`,
      `- Second GET /api/xmachines/telemetry HTTP ${secondDom.telemetryStatus.join(',')} names: ${JSON.stringify(secondDom.telemetryNames)}`,
      '',
      '## Rendered cards',
      `- Before (${firstCards.length}): ${JSON.stringify(firstCards.map((card) => card.ariaLabel))}`,
      `- After (${secondCards.length}): ${JSON.stringify(secondCards.map((card) => card.ariaLabel))}`,
      `- Fifth card aria=${cinder?.ariaLabel} state=${cinder?.powerState} temp=${cinder?.gpuTemp} watts=${cinder?.powerWatts} uptime=${cinder?.uptime} hint=${cinder?.roleHint}`,
      `- Role text stayed on [data-testid="xmachines-role-hint"] and out of each card aria-label.`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(VALIDATION_DIR, 'D2-mutation-report-a2.md'), report);
    await second.close();
  });
});
