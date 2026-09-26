import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// D11 focused gate. Drives the real machine-detail page on a scratch
// createApiServer. Expected kWh and PHP are literals of the seeded watts
// (400, 220, 180, and a skipped null) at 0.5 h: 0.4 kWh, PHP 0.4 at the
// placeholder tariff, PHP 2.9 at 7.25. Folding in the other machine's
// 9000 W rows would be 9.4 kWh. WoL timestamps are the xmac-log fixture,
// read back from the DOM. I5c (stale/never-verified Off challenge) belongs
// to D7, not this render row.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'd11-cost-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const VAULT = 'd11vault';
const DIM = 'd11dim';
const HUSK = 'd11husk';
const FLEET = [VAULT, DIM, HUSK] as const;
const OCTET: Record<string, string> = { [VAULT]: '221', [DIM]: '222', [HUSK]: '223' };
const ROLE: Record<string, string> = { [VAULT]: 'storage', [DIM]: 'storage', [HUSK]: 'compute' };

const VAULT_WATTS: Array<number | null> = [400, 220, 180, null];
const DIM_WATTS: Array<number | null> = [9000, 9000];
const CONFIGURED_TARIFF = 7.25;
const VAULT_KWH = 0.4;
const VAULT_PHP_PLACEHOLDER = 0.4;
const VAULT_PHP_CONFIGURED = 2.9;
const BLEED_KWH = 9.4;
const BURSTS_CAVEAT = 'bursts shorter than 30 minutes may be missed';
const WOL_UNVERIFIED_WARNING = 'Unverified machine may remain off';
const TARIFF_KEY = 'xm_cost_tariff_ph_p_per_kwh';

function stamp(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const VAULT_WAKE = stamp(50 * 60 * 1000);
const VAULT_UP = stamp(40 * 60 * 1000);
const HUSK_WAKE = stamp(35 * 60 * 1000);

type Scratch = { dir: string; env: NodeJS.ProcessEnv };
type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };
type Opened = {
  page: Page;
  payload: Record<string, unknown> | null;
  telemetry: string[];
  close: () => Promise<void>;
};

function installSpies(bin: string): void {
  const script = '#!/bin/bash\nexit 0\n';
  for (const name of ['ping', 'ssh', 'wakeonlan', 'xmac.sh', 'xmac']) {
    fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 });
  }
}

function sampleRows(): unknown[] {
  const nowMs = Date.now();
  const samples: unknown[] = [];
  const push = (machine: string, watts: ReadonlyArray<number | null>) => {
    watts.forEach((value, index) => {
      samples.push({
        machine,
        uuid: `GPU-D11-${machine.toUpperCase()}-1`,
        sampleTime: new Date(nowMs - (watts.length - index) * 30 * 60 * 1000).toISOString(),
        powerWatts: value,
      });
    });
  };
  push(VAULT, VAULT_WATTS);
  push(DIM, DIM_WATTS);
  return samples;
}

function newScratch(tariff: number | null): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd11-cost-wol-'));
  const bin = path.join(dir, 'bin');
  const stateDir = path.join(dir, 'xmac-state');
  fs.mkdirSync(bin);
  fs.mkdirSync(stateDir, { recursive: true });
  installSpies(bin);
  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const xmacLog = path.join(dir, 'xmac.log');
  const seedPath = path.join(dir, 'seed.json');
  fs.writeFileSync(statusPath, FLEET.map((name) => `${name}  192.0.2.${OCTET[name]}  UP  leases=()  ${ROLE[name]}`).join('\n') + '\n');
  fs.writeFileSync(confPath, FLEET.map((name) => `${name}|192.0.2.${OCTET[name]}|02:00:00:00:00:${OCTET[name]}|agjrom|${ROLE[name]}|true`).join('\n') + '\n');
  const metrics = (cpu: number) => ({
    gpuTempsC: [cpu],
    gpuPowerWatts: [11],
    uptime: '1h 0m',
    freshness: 'fresh',
    provenance: 'collector-cli',
    sampleAge: '10s',
    cpuTemp: cpu,
  });
  fs.writeFileSync(metricsPath, JSON.stringify({
    [VAULT]: metrics(41),
    [DIM]: metrics(42),
    [HUSK]: metrics(43),
  }));
  fs.writeFileSync(xmacLog, [
    `${VAULT_WAKE} WAKE ${VAULT} 1`,
    `${VAULT_UP} UP ${VAULT} 600s`,
    `${HUSK_WAKE} WAKE ${HUSK} 1`,
    '',
  ].join('\n'));
  fs.writeFileSync(seedPath, JSON.stringify({ samples: sampleRows() }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMACHINES_UP_SECONDS: String(6 * 3600),
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    XMAC_LOG: xmacLog,
    XMAC_USER: 'agjrom',
    D11_OWNER_TOKEN: OWNER_TOKEN,
    D11_SEED: seedPath,
    D11_TARIFF: tariff === null ? '' : String(tariff),
  };
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  return { dir, env };
}

const SERVER_CHILD = `
import fs from 'node:fs';
import { createApiServer } from '__SRC__/api/server.js';
import { DatabaseService } from '__SRC__/db/database.js';
const OWNER_TOKEN = process.env.D11_OWNER_TOKEN;
const db = new DatabaseService(':memory:');
const raw = db.raw;
const seed = JSON.parse(fs.readFileSync(process.env.D11_SEED, 'utf8'));
const insertDevice = raw.prepare(
  'INSERT INTO xm_devices (machine_name, gpu_uuid, gpu_name, status, ordinal, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insertSample = raw.prepare(
  'INSERT INTO xm_samples (machine_name, gpu_uuid, sample_time, temperature, power_watts, utilization_gpu, utilization_mem, fan_speed, vram_mb, vram_total_mb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const seenDevice = new Set();
for (const row of seed.samples) {
  if (!seenDevice.has(row.machine + row.uuid)) {
    seenDevice.add(row.machine + row.uuid);
    insertDevice.run(row.machine, row.uuid, 'D11 FIXTURE DEVICE', 'active', 0, row.sampleTime, row.sampleTime);
  }
  insertSample.run(row.machine, row.uuid, row.sampleTime, 55, row.powerWatts, 10, null, 30, 1024, 8192);
}
if (process.env.D11_TARIFF) {
  raw.prepare('INSERT INTO xm_config (key, value) VALUES (?, ?)').run(${JSON.stringify(TARIFF_KEY)}, process.env.D11_TARIFF);
}
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
  db,
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
console.log('D11-SERVER-READY ' + app.server.address().port);
`;

async function startServer(scratch: Scratch): Promise<Server> {
  const script = path.join(scratch.dir, 'server.mts');
  fs.writeFileSync(script, SERVER_CHILD.replaceAll('__SRC__', path.join(REPO_ROOT, 'src')));
  const child = spawn('npx', ['tsx', script], { cwd: REPO_ROOT, env: scratch.env }) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });
  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    const match = out.match(/D11-SERVER-READY (\d+)/);
    if (match) return { child, port: Number(match[1]), stderr: () => err.slice(-800) };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`cost server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
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

async function openHash(browser: Browser, base: string, hash: string, machine: string | null): Promise<Opened> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let payload: Record<string, unknown> | null = null;
  const telemetry: string[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/xmachines/telemetry')) {
      try { telemetry.push(await response.text()); } catch { /* body already consumed */ }
    }
    if (!machine) return;
    if (!new RegExp(`/api/xmachines/machines/${machine}(?:\\?|$)`).test(url)) return;
    try { payload = await response.json(); } catch { /* non-json */ }
  });
  await page.route(/telegram-web-app\.js|cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: '',
  }));
  await page.addInitScript((token) => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'd11-cost',
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
  await page.goto(`${base}/index.html#${hash}`, { waitUntil: 'domcontentloaded' });
  return { page, get payload() { return payload; }, telemetry, close: () => context.close() } as Opened;
}

async function settledPayload(opened: Opened): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000;
  while (opened.payload === null && Date.now() < deadline) {
    await opened.page.waitForTimeout(50);
  }
  if (!opened.payload) throw new Error('detail payload was not observed');
  return opened.payload;
}

function costOf(payload: Record<string, unknown> | null): Record<string, unknown> {
  const cost = payload?.cost;
  if (!cost || typeof cost !== 'object') throw new Error(`detail payload has no cost object: ${JSON.stringify(payload)?.slice(0, 400)}`);
  return cost as Record<string, unknown>;
}

function wolOf(payload: Record<string, unknown> | null): Record<string, unknown> {
  const wol = payload?.wolSafety;
  if (!wol || typeof wol !== 'object') throw new Error(`detail payload has no wolSafety object: ${JSON.stringify(payload)?.slice(0, 400)}`);
  return wol as Record<string, unknown>;
}

test.describe('D11 detail cost and WoL safety', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
  let placeholderScratch: Scratch;
  let configuredScratch: Scratch;
  let placeholderServer: Server;
  let configuredServer: Server;
  let placeholderProxy: { base: string; close: () => Promise<void> };
  let configuredProxy: { base: string; close: () => Promise<void> };

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    placeholderScratch = newScratch(null);
    configuredScratch = newScratch(CONFIGURED_TARIFF);
    [placeholderServer, configuredServer] = await Promise.all([
      startServer(placeholderScratch),
      startServer(configuredScratch),
    ]);
    [placeholderProxy, configuredProxy] = await Promise.all([
      startProxy(placeholderServer.port),
      startProxy(configuredServer.port),
    ]);
  });

  test.afterAll(async () => {
    if (placeholderProxy) await placeholderProxy.close();
    if (configuredProxy) await configuredProxy.close();
    if (placeholderServer) placeholderServer.child.kill('SIGTERM');
    if (configuredServer) configuredServer.child.kill('SIGTERM');
    if (placeholderScratch) fs.rmSync(placeholderScratch.dir, { recursive: true, force: true });
    if (configuredScratch) fs.rmSync(configuredScratch.dir, { recursive: true, force: true });
  });

  test('I4a-I4d I5a placeholder detail shows own kWh, PHP, caveat, and verified WoL', async ({ browser }) => {
    const opened = await openHash(browser, placeholderProxy.base, `/xmachines/${VAULT}`, VAULT);
    try {
      await opened.page.locator('[data-testid="xmachines-machine-detail"]').waitFor({ timeout: 20_000 });
      const detail = opened.page.locator('[data-testid="xmachines-machine-detail"]');
      const payload = await settledPayload(opened);
      const cost = costOf(payload);
      const wol = wolOf(payload);
      expect(cost.kwh, placeholderServer.stderr()).toBe(VAULT_KWH);
      expect(cost.kwh).not.toBe(BLEED_KWH);
      expect(cost.costPhp).toBe(VAULT_PHP_PLACEHOLDER);
      expect(cost.isPlaceholder).toBe(true);
      expect(cost.currency).toBe('PHP');
      expect(cost.caveat).toBe(BURSTS_CAVEAT);
      await expect(detail.locator('[data-testid="xmachines-cost-kwh"]')).toHaveText(`${cost.kwh} kWh`);
      await expect(detail.locator('[data-testid="xmachines-cost-php"]')).toHaveText(`PHP ${cost.costPhp}`);
      await expect(detail.locator('[data-testid="xmachines-tariff-flag"]')).toHaveText('placeholder tariff');
      await expect(detail.locator('[data-testid="xmachines-cost-caveat"]')).toHaveText(BURSTS_CAVEAT);
      expect(wol.status).toBe('verified');
      expect(wol.lastWake).toBe(VAULT_WAKE);
      expect(wol.verifiedUp).toBe(VAULT_UP);
      expect(wol.warning).toBeNull();
      await expect(detail.locator('[data-testid="xmachines-wol-status"]')).toHaveText('verified');
      await expect(detail.locator('[data-testid="xmachines-wol-last-wake"]')).toHaveText(String(wol.lastWake));
      await expect(detail.locator('[data-testid="xmachines-wol-verified-up"]')).toHaveText(String(wol.verifiedUp));
      await expect(detail.locator('[data-testid="xmachines-wol-safety"]')).not.toContainText(WOL_UNVERIFIED_WARNING);
    } finally {
      await opened.close();
    }
  });

  test('I4b-I4c configured tariff changes PHP and clears the placeholder flag', async ({ browser }) => {
    const opened = await openHash(browser, configuredProxy.base, `/xmachines/${VAULT}`, VAULT);
    try {
      await opened.page.locator('[data-testid="xmachines-machine-detail"]').waitFor({ timeout: 20_000 });
      const detail = opened.page.locator('[data-testid="xmachines-machine-detail"]');
      const cost = costOf(await settledPayload(opened));
      expect(cost.kwh, configuredServer.stderr()).toBe(VAULT_KWH);
      expect(cost.costPhp).toBe(VAULT_PHP_CONFIGURED);
      expect(cost.costPhp).not.toBe(VAULT_PHP_PLACEHOLDER);
      expect(cost.isPlaceholder).toBe(false);
      expect(cost.tariffPhpPerKwh).toBe(CONFIGURED_TARIFF);
      await expect(detail.locator('[data-testid="xmachines-cost-kwh"]')).toHaveText(`${cost.kwh} kWh`);
      await expect(detail.locator('[data-testid="xmachines-cost-php"]')).toHaveText(`PHP ${cost.costPhp}`);
      await expect(detail.locator('[data-testid="xmachines-tariff-flag"]')).toHaveText('configured tariff');
      await expect(detail.locator('[data-testid="xmachines-cost-caveat"]')).toHaveText(BURSTS_CAVEAT);
    } finally {
      await opened.close();
    }
  });

  test('I5b-I5d never-verified and stale are distinct and warn; verified does not', async ({ browser }) => {
    const dim = await openHash(browser, placeholderProxy.base, `/xmachines/${DIM}`, DIM);
    const husk = await openHash(browser, placeholderProxy.base, `/xmachines/${HUSK}`, HUSK);
    try {
      await dim.page.locator('[data-testid="xmachines-machine-detail"]').waitFor({ timeout: 20_000 });
      await husk.page.locator('[data-testid="xmachines-machine-detail"]').waitFor({ timeout: 20_000 });
      const dimWol = wolOf(await settledPayload(dim));
      const huskWol = wolOf(await settledPayload(husk));
      expect(dimWol.status, placeholderServer.stderr()).toBe('never-verified');
      expect(dimWol.warning).toBe(WOL_UNVERIFIED_WARNING);
      expect(huskWol.status).toBe('stale');
      expect(huskWol.lastWake).toBe(HUSK_WAKE);
      expect(huskWol.verifiedUp).toBeNull();
      expect(huskWol.warning).toBe(WOL_UNVERIFIED_WARNING);
      await expect(dim.page.locator('[data-testid="xmachines-wol-status"]')).toHaveText('never verified');
      await expect(husk.page.locator('[data-testid="xmachines-wol-status"]')).toHaveText('stale');
      await expect(dim.page.locator('[data-testid="xmachines-wol-warning"]')).toHaveText(WOL_UNVERIFIED_WARNING);
      await expect(husk.page.locator('[data-testid="xmachines-wol-warning"]')).toHaveText(WOL_UNVERIFIED_WARNING);
      const labels = [
        await dim.page.locator('[data-testid="xmachines-wol-status"]').innerText(),
        await husk.page.locator('[data-testid="xmachines-wol-status"]').innerText(),
        'verified',
      ];
      expect(new Set(labels).size).toBe(3);
    } finally {
      await dim.close();
      await husk.close();
    }
  });

  test('I4e fleet overview renders no PHP, kWh, tariff flag, or cost caveat', async ({ browser }) => {
    const detail = await openHash(browser, placeholderProxy.base, `/xmachines/${VAULT}`, VAULT);
    const overview = await openHash(browser, placeholderProxy.base, '/xmachines', null);
    try {
      await detail.page.locator('[data-testid="xmachines-cost-php"]').waitFor({ timeout: 20_000 });
      await expect(detail.page.locator('[data-testid="xmachines-cost-php"]')).toHaveText(`PHP ${VAULT_PHP_PLACEHOLDER}`);
      await overview.page.locator('[data-testid="xmachines-fleet-overview"]').waitFor({ timeout: 20_000 });
      const deadline = Date.now() + 5_000;
      while (overview.telemetry.length === 0 && Date.now() < deadline) {
        await overview.page.waitForTimeout(50);
      }
      const text = await overview.page.locator('[data-testid="xmachines-fleet-overview"]').innerText();
      expect(text, placeholderServer.stderr()).not.toMatch(/\bPHP\b/);
      expect(text).not.toMatch(/₱/);
      expect(text).not.toMatch(/kWh/i);
      expect(text).not.toMatch(/placeholder tariff/i);
      expect(text).not.toMatch(/configured tariff/i);
      expect(text).not.toContain(BURSTS_CAVEAT);
      expect(overview.telemetry.length).toBeGreaterThan(0);
      const telemetry = overview.telemetry.join('\n');
      for (const key of ['costPhp', '"cost"', 'tariffPhpPerKwh', '"kwh"']) {
        expect(telemetry, key).not.toContain(key);
      }
    } finally {
      await detail.close();
      await overview.close();
    }
  });
});
