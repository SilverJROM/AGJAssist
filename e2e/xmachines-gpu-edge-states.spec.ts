import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Drives the production read route. nvidia-smi is a PATH stand-in for the
// driver; the sampler writes xm_samples and the browser reads the route back.
// Expected strings below are literals, not values read out of the renderer.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'd13-edge-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const STALE_AT = '2020-01-01T00:00:00.000Z';

const ROWS_MACHINE = 'edge-rows';
const TIMEOUT_MACHINE = 'edge-timeout';
const NONE_MACHINE = 'edge-none';
const STALE_MACHINE = 'edge-stale';

const LIVE_UUID = 'GPU-EDGE-LIVE';
const LIVE_NAME = 'NVIDIA RTX 4090';
const NA_UUID = 'GPU-EDGE-NA';
const NA_NAME = 'NVIDIA RTX 4090';
const OTHER_UUID = 'GPU-EDGE-OTHER';
const OTHER_NAME = 'AMD Radeon PRO W6800';
const TIMEOUT_UUID = 'GPU-EDGE-TIMEOUT';
const TIMEOUT_NAME = 'NVIDIA RTX 3090';
const STALE_UUID = 'GPU-EDGE-STALE';
const STALE_NAME = 'NVIDIA RTX 3090';

const ROWS_CSV = [
  `${LIVE_UUID}, ${LIVE_NAME}, 41, 2048, 24576, 67, 220, 55`,
  `${NA_UUID}, ${NA_NAME}, 37, 2048, 24576, 60, [N/A], 45`,
  `${OTHER_UUID}, ${OTHER_NAME}, 1, 2, 3, 4, 5, 6`,
].join('\n');
const TIMEOUT_CSV = `${TIMEOUT_UUID}, ${TIMEOUT_NAME}, 12, 2048, 24576, 71, 180.5, 40\n`;
const STALE_CSV = `${STALE_UUID}, ${STALE_NAME}, 10, 1024, 24576, 44, 95.2, 30\n`;

const MACHINES = [ROWS_MACHINE, TIMEOUT_MACHINE, NONE_MACHINE, STALE_MACHINE];

type Scratch = { dir: string; env: NodeJS.ProcessEnv };
type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };
type GpuPayload = {
  gpuRows?: Array<Record<string, string>>;
  gpuChip?: string;
  gpuState?: string;
};

function statusText(names: string[]): string {
  return names.map((name, index) => `${name}  192.0.2.${20 + index}  UP  leases=()  compute`).join('\n') + '\n';
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd13-gpu-edge-'));
  const bin = path.join(dir, 'bin');
  const stateDir = path.join(dir, 'xmac-state');
  fs.mkdirSync(bin);
  fs.mkdirSync(stateDir, { recursive: true });
  const modePath = path.join(dir, 'gpu-mode');
  const stdoutPath = path.join(dir, 'gpu-stdout');
  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const rowsPath = path.join(dir, 'rows.csv');
  const timeoutPath = path.join(dir, 'timeout.csv');
  const stalePath = path.join(dir, 'stale.csv');
  const dbPath = path.join(dir, 'edge.sqlite');
  fs.writeFileSync(modePath, 'live');
  fs.writeFileSync(stdoutPath, '');
  fs.writeFileSync(rowsPath, ROWS_CSV);
  fs.writeFileSync(timeoutPath, TIMEOUT_CSV);
  fs.writeFileSync(stalePath, STALE_CSV);
  fs.writeFileSync(statusPath, statusText(MACHINES));
  fs.writeFileSync(confPath, MACHINES.map((name, index) => (
    `${name}|192.0.2.${20 + index}|02:00:00:00:00:${(index + 1).toString(16).padStart(2, '0')}|agjrom|compute|true`
  )).join('\n') + '\n');
  fs.writeFileSync(metricsPath, JSON.stringify(Object.fromEntries(MACHINES.map((name) => [name, {
    gpuTempsC: [30],
    gpuPowerWatts: [5],
    uptime: '1h 0m',
    freshness: 'fresh',
    provenance: 'collector-cli',
    sampleAge: '10s',
    cpuTemp: 30,
  }]))));
  for (const name of ['ping', 'wakeonlan', 'xmac.sh', 'xmac', 'ssh']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  }
  const nvidia = `#!/bin/bash
MODE=$(cat ${JSON.stringify(modePath)})
if [ "$MODE" = "timeout" ]; then
  kill -TERM $$
fi
if [ "$MODE" = "none" ]; then
  echo "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running." >&2
  exit 1
fi
cat ${JSON.stringify(stdoutPath)}
exit 0
`;
  fs.writeFileSync(path.join(bin, 'nvidia-smi'), nvidia, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    D13_OWNER_TOKEN: OWNER_TOKEN,
    D13_DB_PATH: dbPath,
    D13_STATUS_PATH: statusPath,
    D13_GPU_MODE: modePath,
    D13_GPU_STDOUT: stdoutPath,
    D13_ROWS_CSV: rowsPath,
    D13_TIMEOUT_CSV: timeoutPath,
    D13_STALE_CSV: stalePath,
    D13_STALE_AT: STALE_AT,
    D13_ROWS_MACHINE: ROWS_MACHINE,
    D13_TIMEOUT_MACHINE: TIMEOUT_MACHINE,
    D13_NONE_MACHINE: NONE_MACHINE,
    D13_STALE_MACHINE: STALE_MACHINE,
  };
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  return { dir, env };
}

const SERVER_CHILD = `
import fs from 'node:fs';
import { createApiServer } from '__SRC__/api/server.js';
import { DatabaseService } from '__SRC__/db/database.js';
import { sampleFleet } from '__SRC__/services/xmachines/sampler.js';
import { loadGpuTelemetryRows } from '__SRC__/services/xmachines/gpu-edge-states.js';
import { resolveXmachinesRuntime } from '__SRC__/services/xmachines/runtime.js';

const OWNER_TOKEN = process.env.D13_OWNER_TOKEN;
const statusPath = process.env.D13_STATUS_PATH;
const modePath = process.env.D13_GPU_MODE;
const stdoutPath = process.env.D13_GPU_STDOUT;
const machines = {
  rows: process.env.D13_ROWS_MACHINE,
  timeout: process.env.D13_TIMEOUT_MACHINE,
  none: process.env.D13_NONE_MACHINE,
  stale: process.env.D13_STALE_MACHINE,
};
const ips = {
  [machines.rows]: '192.0.2.20',
  [machines.timeout]: '192.0.2.21',
  [machines.none]: '192.0.2.22',
  [machines.stale]: '192.0.2.23',
};

function writeStatus(names) {
  const text = names.map((name) => name + '  ' + ips[name] + '  UP  leases=()  compute').join('\\n') + '\\n';
  fs.writeFileSync(statusPath, text);
}
function writeMode(mode) { fs.writeFileSync(modePath, mode); }
function writeStdout(file) { fs.copyFileSync(file, stdoutPath); }

const db = new DatabaseService(process.env.D13_DB_PATH);
const runtime = resolveXmachinesRuntime(process.env);
runtime.telemetry.useReaderStore(db.raw);

writeStatus([machines.rows]);
writeMode('live');
writeStdout(process.env.D13_ROWS_CSV);
sampleFleet(process.env, runtime);

writeStatus([machines.timeout]);
writeMode('live');
writeStdout(process.env.D13_TIMEOUT_CSV);
sampleFleet(process.env, runtime);
writeMode('timeout');
sampleFleet(process.env, runtime);

writeStatus([machines.none]);
writeMode('none');
sampleFleet(process.env, runtime);

writeMode('live');
writeStdout(process.env.D13_STALE_CSV);
loadGpuTelemetryRows(db.raw, {
  machine: machines.stale,
  roleHint: 'compute',
  nowIso: process.env.D13_STALE_AT,
  refresh: true,
});

writeStatus([machines.rows, machines.timeout, machines.none, machines.stale]);

const config = {
  telegram: { botToken: '123:ABC', authorizedUserId: 1, authorizedChatIds: [1], testMode: true, updateMode: 'polling', webhookUrl: null, webhookPath: '/api/telegram/webhook', webhookSecretToken: 's' },
  runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
  api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
  db: { path: process.env.D13_DB_PATH },
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
console.log('D13-SERVER-READY ' + app.server.address().port);
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
    const match = out.match(/D13-SERVER-READY (\d+)/);
    if (match) return { child, port: Number(match[1]), stderr: () => err.slice(-1200) };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`gpu edge server never became ready (exit=${child.exitCode}) ${err.slice(-800)} ${out.slice(-400)}`);
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

async function openDetail(browser: Browser, base: string, machine: string): Promise<{ page: Page; payload: GpuPayload | null; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let payload: GpuPayload | null = null;
  page.on('response', async (response) => {
    if (!new RegExp(`/api/xmachines/machines/${machine}(?:\\?|$)`).test(response.url())) return;
    try { payload = await response.json() as GpuPayload; } catch { /* non-json */ }
  });
  await page.route(/telegram-web-app\.js|cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: '',
  }));
  await page.addInitScript((token) => {
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: 'd13-gpu-edge',
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
  await page.goto(`${base}/index.html#/xmachines/${machine}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="xmachines-machine-detail"]').waitFor({ timeout: 20_000 });
  const deadline = Date.now() + 5_000;
  while (payload === null && Date.now() < deadline) {
    await page.waitForTimeout(50);
  }
  return { page, payload, close: () => context.close() };
}

test.describe('D13 GPU edge states from the production read route', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });
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

  test('renders one row per GPU UUID, unavailable power, and a non-NVIDIA device', async ({ browser }) => {
    const opened = await openDetail(browser, proxy.base, ROWS_MACHINE);
    try {
      expect(opened.payload, server.stderr()).toMatchObject({ gpuState: 'live' });
      const rows = opened.payload?.gpuRows ?? [];
      expect(rows).toHaveLength(3);
      const byUuid = Object.fromEntries(rows.map((row) => [row.uuid, row]));
      expect(byUuid[LIVE_UUID]).toEqual({
        uuid: LIVE_UUID,
        name: LIVE_NAME,
        chip: '',
        power: '220 W',
        temperature: '67 C',
        memory: '2048/24576 MiB',
        utilization: '41%',
        fan: '55%',
      });
      expect(byUuid[NA_UUID]).toEqual({
        uuid: NA_UUID,
        name: NA_NAME,
        chip: '',
        power: 'unavailable',
        temperature: '60 C',
        memory: '2048/24576 MiB',
        utilization: '37%',
        fan: '45%',
      });
      expect(byUuid[OTHER_UUID]).toEqual({
        uuid: OTHER_UUID,
        name: OTHER_NAME,
        chip: 'non-nvidia',
        power: 'not-applicable',
        temperature: 'not-applicable',
        memory: 'not-applicable',
        utilization: 'not-applicable',
        fan: 'not-applicable',
      });

      await expect(opened.page.locator('[data-testid="xmachines-gpu-row"]')).toHaveCount(3);
      const live = opened.page.locator(`[data-testid="xmachines-gpu-row"][data-gpu-uuid="${LIVE_UUID}"]`);
      await expect(live.locator('[data-testid="xmachines-gpu-name"]')).toHaveText(LIVE_NAME);
      await expect(live.locator('[data-testid="xmachines-gpu-chip"]')).toHaveText('');
      await expect(live.locator('[data-testid="xmachines-gpu-power"]')).toHaveText('220 W');
      await expect(live.locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('67 C');
      await expect(live.locator('[data-testid="xmachines-gpu-vram"]')).toHaveText('2048/24576 MiB');
      await expect(live.locator('[data-testid="xmachines-gpu-util"]')).toHaveText('41%');
      await expect(live.locator('[data-testid="xmachines-gpu-fan"]')).toHaveText('55%');

      const unavailable = opened.page.locator(`[data-testid="xmachines-gpu-row"][data-gpu-uuid="${NA_UUID}"]`);
      await expect(unavailable.locator('[data-testid="xmachines-gpu-power"]')).toHaveText('unavailable');
      await expect(unavailable.locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('60 C');
      await expect(unavailable.locator('[data-testid="xmachines-gpu-power"]')).not.toHaveText('0 W');

      const other = opened.page.locator(`[data-testid="xmachines-gpu-row"][data-gpu-uuid="${OTHER_UUID}"]`);
      await expect(other.locator('[data-testid="xmachines-gpu-name"]')).toHaveText(OTHER_NAME);
      await expect(other.locator('[data-testid="xmachines-gpu-chip"]')).toHaveText('non-nvidia');
      await expect(other.locator('[data-testid="xmachines-gpu-power"]')).toHaveText('not-applicable');
      await expect(other.locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('not-applicable');
      await expect(other.locator('[data-testid="xmachines-gpu-vram"]')).toHaveText('not-applicable');
      await expect(other.locator('[data-testid="xmachines-gpu-util"]')).toHaveText('not-applicable');
      await expect(other.locator('[data-testid="xmachines-gpu-fan"]')).toHaveText('not-applicable');
    } finally {
      await opened.close();
    }
  });

  test('renders last-good metrics with a driver-timeout chip', async ({ browser }) => {
    const opened = await openDetail(browser, proxy.base, TIMEOUT_MACHINE);
    try {
      expect(opened.payload, server.stderr()).toMatchObject({
        gpuState: 'driver-timeout',
        gpuChip: 'error-timeout',
      });
      expect(opened.payload?.gpuRows).toEqual([{
        uuid: TIMEOUT_UUID,
        name: TIMEOUT_NAME,
        chip: 'error-timeout',
        power: '180.5 W',
        temperature: '71 C',
        memory: '2048/24576 MiB',
        utilization: '12%',
        fan: '40%',
      }]);
      const row = opened.page.locator(`[data-testid="xmachines-gpu-row"][data-gpu-uuid="${TIMEOUT_UUID}"]`);
      await expect(row.locator('[data-testid="xmachines-gpu-name"]')).toHaveText(TIMEOUT_NAME);
      await expect(row.locator('[data-testid="xmachines-gpu-chip"]')).toHaveText('error-timeout');
      await expect(row.locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('71 C');
      await expect(row.locator('[data-testid="xmachines-gpu-power"]')).toHaveText('180.5 W');
      await expect(row.locator('[data-testid="xmachines-gpu-vram"]')).toHaveText('2048/24576 MiB');
      await expect(opened.page.locator('[data-testid="xmachines-machine-detail"]')).not.toContainText('no-NVIDIA');
    } finally {
      await opened.close();
    }
  });

  test('renders a no-NVIDIA banner and no GPU rows', async ({ browser }) => {
    const opened = await openDetail(browser, proxy.base, NONE_MACHINE);
    try {
      expect(opened.payload, server.stderr()).toMatchObject({
        gpuState: 'no-nvidia',
        gpuChip: 'no-NVIDIA',
        gpuRows: [],
      });
      await expect(opened.page.locator('[data-testid="xmachines-gpu-row"]')).toHaveCount(0);
      await expect(opened.page.locator('[data-testid="xmachines-gpu-chip"]')).toHaveText('no-NVIDIA');
      const detail = opened.page.locator('[data-testid="xmachines-machine-detail"]');
      await expect(detail).not.toContainText('no GPUs');
      await expect(detail).not.toContainText('error-timeout');
    } finally {
      await opened.close();
    }
  });

  test('renders a stale row from a stored sample without polling again', async ({ browser }) => {
    const opened = await openDetail(browser, proxy.base, STALE_MACHINE);
    try {
      expect(opened.payload, server.stderr()).toMatchObject({
        gpuState: 'stale',
        gpuChip: 'stale',
      });
      expect(opened.payload?.gpuRows).toEqual([{
        uuid: STALE_UUID,
        name: STALE_NAME,
        chip: 'stale',
        power: '95.2 W',
        temperature: '44 C',
        memory: '1024/24576 MiB',
        utilization: '10%',
        fan: '30%',
      }]);
      const row = opened.page.locator(`[data-testid="xmachines-gpu-row"][data-gpu-uuid="${STALE_UUID}"]`);
      await expect(row.locator('[data-testid="xmachines-gpu-chip"]')).toHaveText('stale');
      await expect(row.locator('[data-testid="xmachines-gpu-name"]')).toHaveText(STALE_NAME);
      await expect(row.locator('[data-testid="xmachines-gpu-temp"]')).toHaveText('44 C');
      await expect(row.locator('[data-testid="xmachines-gpu-power"]')).toHaveText('95.2 W');
      await expect(row.locator('[data-testid="xmachines-gpu-chip"]')).not.toHaveText('error-timeout');
    } finally {
      await opened.close();
    }
  });
});
