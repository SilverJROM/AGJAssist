import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// D7's own focused gate (projcore-run-2026-09-25, row D7).
//
// SCOPE: render normal ON and Off controls through production routes with
// in-progress state, exact guard refusals, stale/never-verified challenge
// routing and recovery warning. Never claims D1b or D2a — those belong to a
// different row.
//
// This is NOT a fence journey (no shared FENCE-ACCEPT/REJECT protocol): D7 is
// this file's sole owner, so plain Playwright assertions are used directly.
// The broader multi-contributor acceptance matrix for this same surface is
// already authored at e2e/xmachines-fence-D14... / xmachines-normal-power-
// safety.journey.spec.ts (fence E4) and xmachines-power-concurrency.journey.
// spec.ts (fence E10); this file is deliberately smaller and exists to gate
// D7 in isolation before those broader fences run.
//
// THE FAKE FLEET IS THIS FILE'S OWN SERVER, NOT THE DEPLOYED APP. It spawns
// the real `createApiServer` in a child process with an xmac `status`
// fixture, a `machines.conf` fixture and an `XMAC_LOG` WoL fixture, plus a
// PATH gateway-spy that IS the fake host: the spy records every argv AND
// mutates the status fixture, so a rendered "up"/"down" state change is an
// observed host-state transition, not a claim about a mock. Every fixture
// address is in TEST-NET-1 (192.0.2.0/24); no real box can be addressed.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_HOST = 'agjasst.silverjrom.app';

const OWNER = { token: 'd7-fence-owner-1', id: 1 };

// The fake fleet. Names are deliberately unlike the real registry so no
// assertion here can be aimed at, or accidentally satisfied by, a real box.
const WAKER = 'pc-d7-waker';     // DOWN, verified WoL   -> the ON specimen
const IDLER = 'pc-d7-idler';     // UP,   verified WoL   -> the clean Off specimen
const LEASED = 'pc-d7-leased';   // UP,   active lease   -> the guard-refusal specimen
const DRIFTER = 'pc-d7-drifter'; // UP,   never-verified -> challenge routing + recovery warning
const RACER = 'pc-d7-racer';     // UP,   verified WoL   -> the On-during-Off race specimen (own machine: IDLER is consumed by another test)

const LEASE_HOLDER = 'xmac-claim-d7-power-controls';

type Row = { name: string; ip: string; state: 'UP' | 'DOWN'; role: string };
const FLEET: Row[] = [
  { name: WAKER, ip: '192.0.2.80', state: 'DOWN', role: 'compute' },
  { name: IDLER, ip: '192.0.2.81', state: 'UP', role: 'compute' },
  { name: LEASED, ip: '192.0.2.82', state: 'UP', role: 'compute' },
  { name: DRIFTER, ip: '192.0.2.83', state: 'UP', role: 'compute' },
  { name: RACER, ip: '192.0.2.84', state: 'UP', role: 'compute' },
];

// The exact refusal string the route produces for an active lease
// (ActionCoordinator.handle: `active lease: ${leaseNames.join(', ')}`). The
// test never invents this copy — it is compared against the SAME string in
// the SAME exchange, this literal exists only to name what is being read.
const EXACT_LEASE_REFUSAL = `active lease: ${LEASE_HOLDER}`;
const WOL_UNVERIFIED_WARNING = 'Unverified machine may remain off';

const DETAIL_SEL = '[data-testid="xmachines-machine-detail"], .xm-detail, .xmachines-view';
const ON_SEL = '[data-testid="xmachines-on-button"]';
const OFF_SEL = '[data-testid="xmachines-off-button"]';
const PROGRESS_SEL = '[data-testid="xmachines-power-inprogress"]';
const OFF_REFUSAL_SEL = '[data-testid="xmachines-off-refusal"]';
const WOL_STATUS_SEL = '[data-testid="xmachines-wol-status"]';
const WOL_WARNING_SEL = '[data-testid="xmachines-wol-warning"]';

// ---------------------------------------------------------------------------
// Scratch fake fleet. Everything lives under os.tmpdir(); the repository, the
// real ~/.config/agent-protocols/xmac and the real ~/.xmac are untouched.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  bin: string;
  spyLog: string;
  statusPath: string;
  confPath: string;
  metricsPath: string;
  stateDir: string;
  xmacLog: string;
  env: NodeJS.ProcessEnv;
};

function gatewayScript(): string {
  // The gateway-spy that is also the fake host: it records every argv, then
  // (after a short dwell so the action is genuinely in flight for a moment)
  // mutates the status fixture. A rendered state change is therefore an
  // observed host-state transition, never a claim about a mock.
  return `#!/bin/bash
set -u
log="\${D7_SPY_LOG}"
status="\${D7_STATUS_FIXTURE}"
{
  printf '%s' 'xmac.sh'
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> "$log"

verb="\${1-}"
machine="\${2-}"

set_state() {
  tmp="$status.\$\$"
  awk -v m="$machine" -v s="$1" '{ if (\$1 == m) { \$3 = s } ; print }' "$status" > "$tmp" && mv "$tmp" "$status"
}

case "$verb" in
  up) sleep 1; set_state UP ;;
  down) sleep 1; set_state DOWN ;;
esac
exit 0
`;
}

function sshScript(): string {
  // Every machine on this row is idle: empty stdout, exit 0 — the only shape
  // the fail-closed busy preflight accepts as "confirmed idle". Busy/timeout
  // specimens belong to fence E4, not D7's own focused gate.
  return `#!/bin/bash
set -u
exit 0
`;
}

function statusLines(rows: Row[]): string {
  return `${rows.map((row) => `${row.name} ${row.ip} ${row.state} leases=() ${row.role}`).join('\n')}\n`;
}

function confLines(rows: Row[]): string {
  return `${rows
    .map((row, i) => `${row.name}|${row.ip}|02:00:00:00:00:${80 + i}|agjrom|${row.role}|echo d7-fixture-busy-check`)
    .join('\n')}\n`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Verified WoL evidence (a WAKE followed by a later UP) for every machine
// except DRIFTER, which has no WAKE at all and is therefore never-verified.
function wolLog(): string {
  const now = Date.now();
  const lines: string[] = [];
  for (const row of FLEET) {
    if (row.name === DRIFTER) continue;
    lines.push(`${stamp(now - 30 * 60 * 1000)} WAKE ${row.name} 1`);
    lines.push(`${stamp(now - 20 * 60 * 1000)} UP ${row.name} 1`);
  }
  return `${lines.join('\n')}\n`;
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd7-power-controls-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const spyLog = path.join(dir, 'gateway-argv.log');
  fs.writeFileSync(path.join(bin, 'xmac.sh'), gatewayScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'xmac.sh'), 0o755);
  fs.writeFileSync(path.join(bin, 'ssh'), sshScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'ssh'), 0o755);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  const xmacLog = path.join(dir, 'xmac.log');

  fs.writeFileSync(statusPath, statusLines(FLEET));
  fs.writeFileSync(confPath, confLines(FLEET));
  fs.writeFileSync(
    metricsPath,
    JSON.stringify(Object.fromEntries(FLEET.map((row) => [row.name, {
      gpuTempsC: [52], gpuPowerWatts: [90], uptime: '1d 2h 3m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '20s', cpuTemp: 41,
    }]))),
  );

  // The lease LEASED is held under, read from the real lease location both
  // A13 and A10 read: $XMAC_STATE/leases/<machine>/<holder>.
  fs.mkdirSync(path.join(stateDir, 'leases', LEASED), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'leases', LEASED, LEASE_HOLDER), '');
  fs.writeFileSync(xmacLog, wolLog());

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_ARM: '1',
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    XMAC_LOG: xmacLog,
    XMAC_USER: 'agjrom',
    XMACHINES_UP_SECONDS: '3600',
    D7_SPY_LOG: spyLog,
    D7_STATUS_FIXTURE: statusPath,
    D7_OWNER_TOKEN: OWNER.token,
  };
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  return { dir, bin, spyLog, statusPath, confPath, metricsPath, stateDir, xmacLog, env };
}

type SpyRow = { command: string; argv: string[] };

function gatewayRows(log: string): SpyRow[] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const fields = line.split('\t');
      return { command: fields[0] ?? '', argv: fields.slice(1) };
    });
}

function hostStateOf(statusPath: string, machine: string): string {
  const text = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8') : '';
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] === machine) return (tokens[2] ?? '').toUpperCase();
  }
  return '';
}

async function waitForHostState(statusPath: string, machine: string, want: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hostStateOf(statusPath, machine) === want) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// ---------------------------------------------------------------------------
// The scratch app server: the REAL createApiServer, run through tsx against
// src/ so this file never depends on a freshly built dist/. It serves the
// REAL src/web/public app, so the browser drives the product UI.
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');

const TOKENS = new Map([
  [process.env.D7_OWNER_TOKEN, { id: 1, role: 'owner', username: 'owner' }],
]);

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
    verifyToken: (token) => TOKENS.get(token) ?? null,
    is2FAEnabled: () => false,
  },
  projectService: {}, safetyService: {}, auditService: {}, tmuxService: {}, tmuxStreamManager: {},
  db: new DatabaseService(':memory:'),
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
console.log('D7-SERVER-READY ' + app.server.address().port);
`;

type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };

async function startServer(scratch: Scratch): Promise<Server> {
  const script = path.join(scratch.dir, 'server.mts');
  fs.writeFileSync(script, SERVER_CHILD.replace(/__SRC__/g, path.join(REPO_ROOT, 'src')));
  const child = spawn('npx', ['tsx', script], {
    cwd: REPO_ROOT,
    env: scratch.env,
  } as never) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const match = out.match(/D7-SERVER-READY (\d+)/);
    if (match) return { child, port: Number(match[1]), stderr: () => err.slice(-800) };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`scratch app server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
}

// A tunnel-shaped reverse proxy. Production reaches these routes through
// Cloudflare, which delivers Host: localhost:3101 and the real public name in
// x-forwarded-host; the route's hostFromRequest() reads the forwarded header
// first. This reproduces that header shape; it relaxes no check.
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

type PowerCall = {
  url: string;
  action: string;
  status: number;
  body: Record<string, unknown> | null;
};

const POWER_URL_RE = /\/api\/xmachines\/machines\/[^/]+\/power\/(on|off|force)$/;

function actionOf(url: string): string {
  const match = url.match(POWER_URL_RE);
  return match ? match[1] : '';
}

type Detail = {
  page: import('@playwright/test').Page;
  close: () => Promise<void>;
  calls: PowerCall[];
};

let base = '';
let bootError = '';

async function openDetail(browser: import('@playwright/test').Browser, machine: string): Promise<Detail> {
  if (bootError) throw new Error(bootError);
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const calls: PowerCall[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!POWER_URL_RE.test(url)) return;
    let body: Record<string, unknown> | null = null;
    try { body = (await response.json()) as Record<string, unknown>; } catch { body = null; }
    calls.push({ url, action: actionOf(url), status: response.status(), body });
  });
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript(([token, id]) => {
    try {
      localStorage.setItem('agj_token', token as string);
      localStorage.setItem('agj_user', JSON.stringify({ id, name: 'owner', username: 'owner', role: 'owner' }));
    } catch { /* ignore */ }
  }, [OWNER.token, OWNER.id] as [string, number]);
  await page.goto(`${base}/index.html#/xmachines/${machine}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(DETAIL_SEL, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { page, close: () => context.close(), calls };
}

async function isVisible(page: import('@playwright/test').Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector);
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    if (await locator.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
}

async function text(page: import('@playwright/test').Page, selector: string): Promise<string> {
  const found = await page.locator(selector).first().textContent().catch(() => '');
  return (found || '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// One server for the whole file. Boot failure is captured, not thrown: a
// throw here would abort collection and report an env error instead of a
// capability-proving assertion failure.
// ---------------------------------------------------------------------------
let scratch: Scratch | null = null;
let server: Server | null = null;
let proxy: { base: string; close: () => Promise<void> } | null = null;

test.beforeAll(async () => {
  try {
    scratch = newScratch();
    server = await startServer(scratch);
    proxy = await startProxy(server.port);
    base = proxy.base;
  } catch (error) {
    bootError = `scratch fleet server unavailable: ${(error as Error).message}`;
  }
});

test.afterAll(async () => {
  try { await proxy?.close(); } catch { /* already closed */ }
  try { server?.child.kill('SIGTERM'); } catch { /* already gone */ }
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (scratch) fs.rmSync(scratch.dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// D1a-equivalent (this row's own gate): the owner's ON control, driven
// through the production power/on route, with the same in-progress affordance
// the Off control gets. An ON control that stays clickable while its own
// action is still running invites exactly the double-press the Off control
// already guards against.
// ---------------------------------------------------------------------------
test('ON control submits through production power/on route, drives a real host transition, and hides itself while in progress', async ({ browser }) => {
  test.setTimeout(60_000);
  test.skip(!!bootError, bootError);
  const detail = await openDetail(browser, WAKER);
  try {
    const before = await isVisible(detail.page, ON_SEL);
    const evidenceDir = path.join(REPO_ROOT, 'xmachines/projcore-run-2026-09-25/validation');
    fs.mkdirSync(evidenceDir, { recursive: true });
    await detail.page.screenshot({ path: path.join(evidenceDir, 'D7-D1a-down-machine-no-on-button.png'), fullPage: true }).catch(() => {});
    const domHtml = await detail.page.locator(DETAIL_SEL).first().innerHTML().catch(() => '');
    fs.writeFileSync(path.join(evidenceDir, 'D7-D1a-down-machine-no-on-button-dom.html'), domHtml);
    expect(before, `no visible ON control on the ${WAKER} detail page before any click`).toBe(true);

    await detail.page.locator(ON_SEL).first().click({ timeout: 5_000 });
    await detail.page.waitForTimeout(400);

    const call = detail.calls.filter((c) => c.action === 'on').pop();
    expect(call, `the ON control issued no POST to the production power/on route (calls=${JSON.stringify(detail.calls)})`).toBeTruthy();
    expect(call!.status, `power/on answered ${call!.status} ${JSON.stringify(call!.body)}, expected 202 in-progress`).toBe(202);

    const progressVisible = await isVisible(detail.page, PROGRESS_SEL);
    expect(progressVisible, 'the accepted ON rendered no in-progress state for the owner').toBe(true);

    const onStillVisible = await isVisible(detail.page, ON_SEL);
    expect(
      onStillVisible,
      'the ON control is still rendered clickable while its own action is in progress (in-progress must hide it, the way the Off control already does)',
    ).toBe(false);

    const reachedUp = await waitForHostState(scratch!.statusPath, WAKER, 'UP');
    expect(reachedUp, `the fake host never came up: status fixture still reports ${WAKER}=${hostStateOf(scratch!.statusPath, WAKER)}`).toBe(true);
    const wakeRows = gatewayRows(scratch!.spyLog).filter((row) => row.argv[0] === 'up' && row.argv[1] === WAKER);
    expect(wakeRows.length, 'the ON click never reached the xmac gateway').toBeGreaterThan(0);
  } finally {
    await detail.close();
  }
});

// ---------------------------------------------------------------------------
// The clean owner-Off: the existing control, still working, still hiding
// itself while its own action is in progress, and the host really moves.
// ---------------------------------------------------------------------------
test('Off control submits through production power/off route, drives a real host transition, and hides itself while in progress', async ({ browser }) => {
  test.setTimeout(60_000);
  test.skip(!!bootError, bootError);
  const detail = await openDetail(browser, IDLER);
  try {
    await detail.page.locator(OFF_SEL).first().click({ timeout: 5_000 });
    await detail.page.waitForTimeout(400);

    const call = detail.calls.filter((c) => c.action === 'off').pop();
    expect(call, `the Off control issued no POST to the production power/off route (calls=${JSON.stringify(detail.calls)})`).toBeTruthy();
    expect(call!.status, `power/off answered ${call!.status} ${JSON.stringify(call!.body)}, expected 202 in-progress`).toBe(202);

    const progressVisible = await isVisible(detail.page, PROGRESS_SEL);
    expect(progressVisible, 'the accepted Off rendered no in-progress state for the owner').toBe(true);

    const offStillVisible = await isVisible(detail.page, OFF_SEL);
    expect(offStillVisible, 'the Off control is still rendered clickable while its own action is in progress').toBe(false);

    const reachedDown = await waitForHostState(scratch!.statusPath, IDLER, 'DOWN');
    expect(reachedDown, `the fake host never went down: status fixture still reports ${IDLER}=${hostStateOf(scratch!.statusPath, IDLER)}`).toBe(true);
  } finally {
    await detail.close();
  }
});

// ---------------------------------------------------------------------------
// The exact guard refusal: an active lease refuses the Off, and the refusal
// text on the owner's screen equals the string the route returned in the
// SAME exchange (D2b-shaped, asserted at unit scope for this row alone; the
// exhaustive lease/busy/timeout matrix is fence E4's job, not this file's).
// ---------------------------------------------------------------------------
test('an active-lease Off refusal is rendered exactly as the production route returned it', async ({ browser }) => {
  test.setTimeout(30_000);
  test.skip(!!bootError, bootError);
  const detail = await openDetail(browser, LEASED);
  try {
    await detail.page.locator(OFF_SEL).first().click({ timeout: 5_000 });
    await detail.page.waitForTimeout(1_200);

    const call = detail.calls.filter((c) => c.action === 'off').pop();
    expect(call?.body?.reason, `power/off on a leased machine answered ${JSON.stringify(call?.body)}, expected reason=active-lease`).toBe('active-lease');
    const fromRoute = String(call?.body?.detail ?? '');
    expect(fromRoute, 'the route returned no detail string to compare the rendered node against').toBe(EXACT_LEASE_REFUSAL);

    const rendered = await text(detail.page, OFF_REFUSAL_SEL);
    expect(rendered, `the leased-machine refusal was not rendered exactly: route said ${JSON.stringify(fromRoute)}`).toBe(fromRoute);

    const spawnedDown = gatewayRows(scratch!.spyLog).filter((row) => row.argv[0] === 'down' && row.argv[1] === LEASED);
    expect(spawnedDown.length, 'a lease did not block the owner Off before it reached the gateway').toBe(0);
  } finally {
    await detail.close();
  }
});

// ---------------------------------------------------------------------------
// L15j-shaped (fence E10 owns the full race matrix; this is D7's own reachability
// gate for it): while an Off on a machine is still in flight, the ON control must
// stay reachable so the A10 coordinator's cross-action guard (machine-busy refusal,
// or a genuine serialization) is something an owner can actually trigger from the
// product surface. Silence — no ON control at all during the race — is not
// accepted, the same way fence E10's own L15j text reads it.
// ---------------------------------------------------------------------------
test('ON control stays reachable while an Off on the same machine is still in flight', async ({ browser }) => {
  test.setTimeout(30_000);
  test.skip(!!bootError, bootError);
  const detail = await openDetail(browser, RACER);
  try {
    await detail.page.locator(OFF_SEL).first().click({ timeout: 5_000 });
    // Still inside the gateway's 1s dwell: the Off is genuinely in flight, the
    // host has not yet reached DOWN.
    await detail.page.waitForTimeout(300);
    const evidenceDir = path.join(REPO_ROOT, 'xmachines/projcore-run-2026-09-25/validation');
    fs.mkdirSync(evidenceDir, { recursive: true });
    await detail.page.screenshot({ path: path.join(evidenceDir, 'D7-L15j-on-during-off-no-on-control.png'), fullPage: true }).catch(() => {});
    const domHtml = await detail.page.locator(DETAIL_SEL).first().innerHTML().catch(() => '');
    fs.writeFileSync(path.join(evidenceDir, 'D7-L15j-on-during-off-no-on-control-dom.html'), domHtml);

    const onReachable = await isVisible(detail.page, ON_SEL);
    expect(
      onReachable,
      "no ON control is reachable while an Off on the same machine is in flight, so the coordinator's machine-busy refusal (or a genuine serialization) can never be exercised from the product surface",
    ).toBe(true);
  } finally {
    await detail.close();
  }
});

// ---------------------------------------------------------------------------
// I5c — stale/never-verified challenge ROUTING: D7 owns making sure the click
// reaches the challenge instead of the gateway, i.e. the full challenge body
// (challengeId + displayNumber) the route returns must survive the SAME
// merge mechanism the Off/On buttons use (handleMachineDetailClick), rather
// than being narrowed to just reason/detail. Rendering the number-match UI
// itself is D8's row (a separate contributor); this only proves the data is
// not dropped on the floor before D8's control can ever read it.
// ---------------------------------------------------------------------------
test('a never-verified machine routes its Off refusal through a force-confirmation challenge, and the challenge fields survive the same merge the buttons use', async ({ browser }) => {
  test.setTimeout(30_000);
  test.skip(!!bootError, bootError);
  const detail = await openDetail(browser, DRIFTER);
  try {
    await detail.page.locator(OFF_SEL).first().click({ timeout: 5_000 });
    await detail.page.waitForTimeout(1_200);

    const call = detail.calls.filter((c) => c.action === 'off').pop();
    expect(call?.status, `the never-verified Off answered ${call?.status} ${JSON.stringify(call?.body)}, expected 400 force-confirmation-required`).toBe(400);
    expect(call?.body?.reason).toBe('force-confirmation-required');
    const challengeId = call?.body?.challengeId;
    const displayNumber = call?.body?.displayNumber;
    expect(typeof challengeId, `no challengeId in the route body: ${JSON.stringify(call?.body)}`).toBe('string');
    expect((challengeId as string).length).toBeGreaterThan(0);
    expect(Number.isInteger(displayNumber), `displayNumber is not an integer: ${JSON.stringify(call?.body)}`).toBe(true);

    // OBSERVE, DO NOT INJECT: the body fed into the merge below is the exact
    // body the route just returned in this exchange, not an invented fixture.
    const capturedBody = call!.body;
    const merged = await detail.page.evaluate(async ([body, machineName]) => {
      const mod = await import('/xmachines-cost-view.js');
      const target = document.createElement('button');
      target.setAttribute('data-testid', 'xmachines-off-button');
      document.body.appendChild(target);
      const event = { target, preventDefault: () => {} };
      const payload = { machine: { name: machineName } };
      const fakeFetch = async () => ({
        ok: false,
        json: async () => body,
      });
      const result = await mod.handleMachineDetailClick(event, payload, { fetch: fakeFetch, idempotencyKey: () => 'd7-merge-check' });
      target.remove();
      return result;
    }, [capturedBody, DRIFTER] as [Record<string, unknown> | null, string]);

    expect((merged as any)?.offRefusal?.challengeId, 'the merge dropped challengeId instead of routing it through').toBe(challengeId);
    expect((merged as any)?.offRefusal?.displayNumber, 'the merge dropped displayNumber instead of routing it through').toBe(displayNumber);
  } finally {
    await detail.close();
  }
});

// ---------------------------------------------------------------------------
// I5d — recovery warning: a never-verified machine must show the owner that
// it may not come back if turned off. This function predates D7's diff; it
// is asserted here at full strength anyway because this is where it must
// keep being true once D7 re-renders the surrounding controls.
// ---------------------------------------------------------------------------
test('a never-verified machine shows the WoL recovery warning on the detail page', async ({ browser }) => {
  test.setTimeout(30_000);
  test.skip(!!bootError, bootError);
  const detail = await openDetail(browser, DRIFTER);
  try {
    const status = await text(detail.page, WOL_STATUS_SEL);
    expect(status, 'no WoL status rendered for the never-verified machine').toBe('never verified');
    const warning = await text(detail.page, WOL_WARNING_SEL);
    expect(warning, 'the never-verified machine did not show the recovery warning').toBe(WOL_UNVERIFIED_WARNING);
  } finally {
    await detail.close();
  }
});
