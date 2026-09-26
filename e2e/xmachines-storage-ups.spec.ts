import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// D10 drives GET /api/xmachines/machines/:name. Expected panel text is literal
// fixture text. The telemetry fixture deliberately has no disks or ups keys.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'd10-storage-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const SHELF = 'd10shelf';
const VOID = 'd10void';

const SHELF_DEVICE = '/dev/sdz';
const SHELF_HEALTH = 'PASSED';
const SHELF_TEMP = '41 C';
const BARE_DEVICE = '/dev/sdy';
const UNAVAILABLE = 'unavailable';
const MOUNT = '/mnt/d10-fixture';
const FS_TOTAL = '9000111222333';
const FS_USED = '200000000100';
const FS_AVAILABLE = '8800111222333';
const BATTERY = '73';
const RUNTIME = '1547s';
const LOAD = '19';

const SMART_TEXT = `=== /dev/sdz ===
SMART overall-health self-assessment test result: PASSED
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
194 Temperature_Celsius     0x0022   100   100   000    Old_age   Always       -       41
=== /dev/sdy ===
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
5 Reallocated_Sector_Ct     0x0033   100   100   000    Pre-fail  Always       -       0
`;

const DF_TEXT = `Filesystem     1B-blocks         Used    Available Use% Mounted on
/dev/sdz1      ${FS_TOTAL}     ${FS_USED}    ${FS_AVAILABLE}  3% ${MOUNT}
`;

const UPS_TEXT = `battery.voltage: 27
battery.charge.low: 20
battery.charge: 73
battery.runtime: 1547
ups.load: 19
input.voltage: 230
ups.status: OL
`;

type Scratch = { dir: string; env: NodeJS.ProcessEnv };
type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };

function logPrelude(name: string, log: string): string {
  return `#!/bin/bash\nset -u\n{\n  printf '%s' ${JSON.stringify(name)}\n  for arg in "$@"; do printf '\\t%s' "$arg"; done\n  printf '\\n'\n} >> ${JSON.stringify(log)}\n`;
}

function installSpies(bin: string, log: string, answerDir: string): void {
  for (const name of ['ping', 'wakeonlan', 'xmac.sh', 'xmac']) {
    fs.writeFileSync(path.join(bin, name), `${logPrelude(name, log)}exit 0\n`, { mode: 0o755 });
  }
  const ssh = `${logPrelude('ssh', log)}
DIR=${JSON.stringify(answerDir)}
ARGS="$*"
M=""
for token in "$@"; do
  candidate="\${token##*@}"
  if [ -f "$DIR/$candidate.host" ]; then M="$candidate"; fi
done
case "$ARGS" in
  *upsc*)
    if [ -f "$DIR/$M.ups-timeout" ]; then sleep 3; exit 0; fi
    cat "$DIR/$M.ups" 2>/dev/null || true
    ;;
  *'===DF==='*)
    cat "$DIR/$M.smart" 2>/dev/null || true
    printf '===DF===\\n'
    cat "$DIR/$M.df" 2>/dev/null || true
    ;;
esac
exit 0
`;
  fs.writeFileSync(path.join(bin, 'ssh'), ssh, { mode: 0o755 });
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd10-storage-'));
  const bin = path.join(dir, 'bin');
  const answerDir = path.join(dir, 'answers');
  const stateDir = path.join(dir, 'xmac-state');
  fs.mkdirSync(bin);
  fs.mkdirSync(answerDir);
  fs.mkdirSync(stateDir, { recursive: true });
  const log = path.join(dir, 'argv.log');
  installSpies(bin, log, answerDir);
  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const xmacLog = path.join(dir, 'xmac.log');
  fs.writeFileSync(statusPath, [
    `${SHELF}  192.0.2.231  UP  leases=()  storage`,
    `${VOID}  192.0.2.232  UP  leases=()  storage`,
    '',
  ].join('\n'));
  fs.writeFileSync(confPath, [
    `${SHELF}|192.0.2.231|02:00:00:00:00:e7|agjrom|storage|true`,
    `${VOID}|192.0.2.232|02:00:00:00:00:e8|agjrom|storage|true`,
    '',
  ].join('\n'));
  const metrics = (cpu: number) => ({
    gpuTempsC: [cpu],
    gpuPowerWatts: [5],
    uptime: '1h 0m',
    freshness: 'fresh',
    provenance: 'collector-cli',
    sampleAge: '10s',
    cpuTemp: cpu,
  });
  fs.writeFileSync(metricsPath, JSON.stringify({
    [SHELF]: metrics(30),
    [VOID]: metrics(31),
  }));
  fs.writeFileSync(xmacLog, '');
  fs.writeFileSync(path.join(answerDir, `${SHELF}.host`), `${SHELF}\n`);
  fs.writeFileSync(path.join(answerDir, `${VOID}.host`), `${VOID}\n`);
  fs.writeFileSync(path.join(answerDir, `${SHELF}.smart`), SMART_TEXT);
  fs.writeFileSync(path.join(answerDir, `${SHELF}.df`), DF_TEXT);
  fs.writeFileSync(path.join(answerDir, `${SHELF}.ups`), UPS_TEXT);
  fs.writeFileSync(path.join(answerDir, `${VOID}.smart`), '');
  fs.writeFileSync(path.join(answerDir, `${VOID}.df`), '');
  fs.writeFileSync(path.join(answerDir, `${VOID}.ups`), '');
  fs.writeFileSync(path.join(answerDir, `${VOID}.ups-timeout`), '1\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    XMAC_LOG: xmacLog,
    D10_OWNER_TOKEN: OWNER_TOKEN,
  };
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  return { dir, env };
}

const SERVER_CHILD = `
import { createApiServer } from '__SRC__/api/server.js';
import { DatabaseService } from '__SRC__/db/database.js';
const OWNER_TOKEN = process.env.D10_OWNER_TOKEN;
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
console.log('D10-SERVER-READY ' + app.server.address().port);
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
    const match = out.match(/D10-SERVER-READY (\d+)/);
    if (match) return { child, port: Number(match[1]), stderr: () => err.slice(-800) };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`storage server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
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

async function openDetail(browser: Browser, base: string, machine: string): Promise<{ page: Page; payload: Record<string, unknown> | null; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let payload: Record<string, unknown> | null = null;
  page.on('response', async (response) => {
    if (!new RegExp(`/api/xmachines/machines/${machine}(?:\\?|$)`).test(response.url())) return;
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
        initData: 'd10-storage',
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

test.describe('D10 storage and UPS detail', () => {
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

  test('renders SMART health, disk temperature, free space, and NUT charge runtime load', async ({ browser }) => {
    const opened = await openDetail(browser, proxy.base, SHELF);
    try {
      expect(opened.payload, server.stderr()).toMatchObject({
        disks: [
          { device: SHELF_DEVICE, health: SHELF_HEALTH, temperatureC: SHELF_TEMP },
          { device: BARE_DEVICE, health: UNAVAILABLE, temperatureC: UNAVAILABLE },
        ],
        filesystems: [{ mount: MOUNT, total: FS_TOTAL, used: FS_USED, available: FS_AVAILABLE }],
        ups: { availability: 'ok', batteryChargePct: 73, runtimeSeconds: 1547, loadPct: 19 },
      });
      const shelf = opened.page.locator(`.disk-row[data-disk="${SHELF_DEVICE}"]`);
      await expect(shelf.locator('.smart-health')).toHaveText(SHELF_HEALTH);
      await expect(shelf.locator('.disk-temp')).toHaveText(SHELF_TEMP);
      const bare = opened.page.locator(`.disk-row[data-disk="${BARE_DEVICE}"]`);
      await expect(bare.locator('.smart-health')).toHaveText(UNAVAILABLE);
      await expect(bare.locator('.disk-temp')).toHaveText(UNAVAILABLE);
      const fsRow = opened.page.locator(`.fs-row[data-mount="${MOUNT}"]`);
      await expect(fsRow.locator('.fs-mount')).toHaveText(MOUNT);
      await expect(fsRow.locator('.fs-total')).toHaveText(FS_TOTAL);
      await expect(fsRow.locator('.fs-used')).toHaveText(FS_USED);
      await expect(fsRow.locator('.fs-available')).toHaveText(FS_AVAILABLE);
      const ups = opened.page.locator('.ups-panel');
      await expect(ups.locator('.ups-battery')).toHaveText(BATTERY);
      await expect(ups.locator('.ups-runtime')).toHaveText(RUNTIME);
      await expect(ups.locator('.ups-load')).toHaveText(LOAD);
    } finally {
      await opened.close();
    }
  });

  test('renders an explicit unavailable UPS when the NUT probe times out', async ({ browser }) => {
    const opened = await openDetail(browser, proxy.base, VOID);
    try {
      expect(opened.payload, server.stderr()).toMatchObject({
        disks: [],
        filesystems: [],
        ups: {
          availability: 'unavailable',
          freshness: 'stale',
          batteryChargePct: null,
          runtimeSeconds: null,
          loadPct: null,
        },
      });
      await expect(opened.page.locator('.disk-row')).toHaveCount(0);
      await expect(opened.page.locator('.fs-row')).toHaveCount(0);
      const ups = opened.page.locator('.ups-panel');
      await expect(ups.locator('.ups-battery')).toHaveText(UNAVAILABLE);
      await expect(ups.locator('.ups-runtime')).toHaveText(UNAVAILABLE);
      await expect(ups.locator('.ups-load')).toHaveText(UNAVAILABLE);
      await expect(ups).not.toContainText(BATTERY);
      await expect(ups).not.toContainText('1547');
      await expect(ups).not.toContainText(LOAD);
    } finally {
      await opened.close();
    }
  });
});
