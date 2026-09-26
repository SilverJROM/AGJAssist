import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import Database from 'better-sqlite3';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E11 — INTEGRATION: non-owner, hostile canonical and noncanonical-
// loopback Host/Origin requests are refused, then revoke-all invalidates prior
// tokens and renders login.
// Contributors: D1 (owner-only navigation + routing — the hidden-navigation
// and deep-link surface) and D12 (the owner settings revoke-all-web-sessions
// action — the revocation surface).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E11 and
// implements none of it; it contains no product code.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. A single test asserting
// all fifteen ids is unattributable — the validator would have to answer
// fault_class=plan failing_units=(none) and the fence could never requeue.
//   test_d1_...    A2a A2b A2c H1a H1b H1c L6a L6b L6c L6d L6e L6j L7r  (D1)
//   test_d12_...   L6f L6g                                              (D12)
//
// Attribution of the ids whose ORIGINATING slice is not an E11 contributor
// (req-matrix.md): A2c, H1a-H1c, L6a-L6e and L6j originate on A6 (the HTTP
// auth/Host/Origin/method/rate-limit matrix) and L7r on C6 (the power-audit
// read route), but on THIS fence they are the refusal surface that sits BEHIND
// the owner-only navigation D1 adds — the fence row names D1 "the hidden-
// navigation/deep-link surface", and a section that is hidden in the nav while
// its routes answer a non-owner, a hostile Host, a hostile Origin, a GET, an
// unthrottled flood or a noncanonical loopback peer is a D1 regression even
// when the nav itself is correct. L6f originates on A7 (session lifetime); it
// is attributed to D12 because lifetime and revocation are the two halves of
// the one session surface D12 exposes to the owner, and D12 is the only other
// unit this fence may name. Only TWO distinct units appear across every
// rejection, so a red report stays `missing_acceptance` and never trips the
// J1c >2-unit plan_defect rule.
//
// THE SERVER UNDER TEST IS THIS JOURNEY'S OWN, NOT THE DEPLOYED APP. The
// journey spawns the real `createApiServer` in a child process with the REAL
// AuthService, AuditService and DatabaseService over a scratch SQLite file, an
// xmac `status` fixture, a machines.conf fixture, a telemetry fixture, a PATH
// gateway-spy and XMACHINES_ARM unset (the non-actuating FakeGateway, L10).
// Real auth services are not optional here: revocation must really delete
// session rows and really stop a previously-good bearer token, which a stub
// authService could only pretend to do. The real fleet is never contacted and
// nothing can actuate.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. A2a and A2b are ABSENCE facts ("a non-owner does not see the nav entry",
//     "a non-owner deep link does not render the section"). Absence is
//     vacuously true today, when no owner sees a nav entry either, so both are
//     authored DIFFERENTIALLY: the owner MUST see the affordance / render the
//     section and the non-owner MUST NOT. That is what makes them red until D1
//     lands and green the moment it does; an absence-only assertion could
//     never name D1.
//  2. No canonical DOM contract for D1's affordance exists yet, so a "nav
//     entry" is any of `[data-testid="xmachines-tile"]`,
//     `[data-testid="xmachines-nav"]`, `[data-nav="xmachines"]`, an anchor to
//     `#/xmachines`, or any visible pressable element whose own label names
//     the section; and the section marker is any of
//     `[data-section="xmachines"]`, `[data-testid="xmachines-fleet-overview"]`
//     or `.xmachines-view`. That broadens WHERE the evidence may appear; it
//     does not weaken WHAT must be true.
//  3. A2a is required on BOTH shells (mini-app tile and desktop Header/
//     Dashboard) because the D1 plan row names both surfaces explicitly. A2b
//     is satisfied either by rendering no section at all or by the codebase's
//     established owner-denied empty state (`McpAccessPage`'s "Owner role
//     required"), provided no fleet content leaks with it.
//  4. The non-owner session is minted through the `/weblogin` code path
//     (`generateLoginCode` + `authenticateWithCode`), because
//     `authenticateTelegram` refuses a non-owner by design and would leave the
//     whole non-owner half of this fence unassertable.
//  5. The hostile and loopback Host values are delivered as `x-forwarded-host`
//     (plus one bare `Host` case), because `hostFromRequest()` reads the
//     forwarded header first — that is the header a request actually arrives
//     with through the production tunnel, so spoofing it is the real attack
//     this row is about. The browser half reaches the app through a
//     tunnel-shaped proxy for the same reason.
//  6. L6d and L6e each use their OWN owner identity, and every other group of
//     power POSTs uses another, because the rate-limit buckets are keyed by
//     owner id: sharing one identity would let an earlier check's requests
//     turn a later check's expected 403 into a 429 and make this journey red
//     for a bookkeeping reason instead of a capability reason.
//  7. L6f is read off the app's REAL session row and the issued JWT against
//     the lifetime this server was configured with (1 hour), not against the
//     production `SESSION_EXPIRY_HOURS` default (24) — the default is a
//     deployment value, while what the code must guarantee is that a
//     power-capable web session is bounded by the configured short lifetime
//     and that the token cannot outlive it.
//  8. "Returns to login" (L6g) is satisfied by the login surface
//     (`.login-container` / `.login-card`) or by the app's session-expired
//     overlay, since both are the app telling the owner to sign in again; the
//     journey also requires the stored token to be gone, the prior bearer
//     token to fail at the API, and the user's web/miniapp session rows to be
//     deleted, so a purely cosmetic redirect cannot satisfy it.
//  9. BASELINE NOTE, recorded rather than engineered away: the eleven backend
//     ids on the D1 test (A2c, H1a-H1c, L6a-L6e, L6j, L7r) and L6f on the D12
//     test are ALREADY GREEN against the landed A6/A7/C6/C7 work — measured,
//     not assumed, by running this journey. D1 and D12 will not turn them from
//     red to green. They are asserted here at full strength anyway, because
//     this fence is where they must KEEP being true once the section becomes
//     reachable and the owner can revoke sessions from the UI. Today the
//     journey is red exactly on A2a and A2b (D1 has not added the owner-only
//     navigation or the owner-gated route render) and on L6g (D12 has not
//     added the owner settings revoke action).
// ---------------------------------------------------------------------------

const FENCE_ID = 'E11';
const ACCEPTANCE_IDS = [
  'A2a', 'A2b', 'A2c', 'H1a', 'H1b', 'H1c',
  'L6a', 'L6b', 'L6c', 'L6d', 'L6e', 'L6f', 'L6g', 'L6j', 'L7r',
];
// id -> the contributor blamed when it rejects. Exactly two distinct units.
const COVERED: Record<string, string> = {
  A2a: 'D1', A2b: 'D1', A2c: 'D1', H1a: 'D1', H1b: 'D1', H1c: 'D1',
  L6a: 'D1', L6b: 'D1', L6c: 'D1', L6d: 'D1', L6e: 'D1', L6j: 'D1', L7r: 'D1',
  L6f: 'D12', L6g: 'D12',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const SESSION_HOURS = 1;
const SELFTEST_MARKER = 'e11-spy-selftest';

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media) so no assertion here can be satisfied by, or aimed at, a real box.
const QUARTZ = 'e11-quartz';  // UP, two GPUs
const SLATE = 'e11-slate';    // DOWN

const NAV_SEL = [
  '[data-testid="xmachines-tile"]',
  '[data-testid="xmachines-nav"]',
  '[data-nav="xmachines"]',
  'a[href="#/xmachines"]',
  'a[href="/#/xmachines"]',
].join(', ');
const SECTION_SEL = [
  '[data-section="xmachines"]',
  '[data-testid="xmachines-fleet-overview"]',
  '.xmachines-view',
].join(', ');
const REVOKE_SEL = [
  '[data-testid="xmachines-revoke-sessions"]',
  '[data-testid="revoke-all-sessions"]',
  '[data-testid="revoke-all-web-sessions"]',
  '[data-testid="revoke-web-sessions"]',
  '[data-testid="xmachines-revoke-all"]',
].join(', ');
const LOGIN_SEL = [
  '.login-container',
  '.login-card',
  '[data-testid="login"]',
  '[data-testid="session-expired"]',
].join(', ');

const OWNER_DENIED = /owner role required/i;

function finish(fenceTest: string, results: boolean[], expected: number): void {
  if (results.length !== expected) {
    throw new Error(`${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  }
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// ---------------------------------------------------------------------------
// Scratch fleet + scratch database. Every path is under os.tmpdir(); the
// repository, the production sqlite file and ~/.config/agent-protocols/xmac
// are untouched.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  log: string;
  dbPath: string;
  env: NodeJS.ProcessEnv;
};

// The command name is a literal baked into each spy script, not read from
// argv[0] at invocation time, so the recorded executable identity cannot be
// spoofed by how the child happened to be invoked (the A14/A15 pattern).
function installSpies(bin: string, log: string): void {
  for (const name of ['ping', 'ssh', 'xmac.sh', 'xmac', 'wakeonlan', 'nvidia-smi', 'smartctl', 'upsc', 'sensors']) {
    const body = `#!/bin/bash\nset -u\n{\n  printf '%s' ${JSON.stringify(name)}\n  for arg in "$@"; do printf '\\t%s' "$arg"; done\n  printf '\\n'\n} >> ${JSON.stringify(log)}\nexit 0\n`;
    const file = path.join(bin, name);
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
}

function newScratch(tag: string): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `e11-${tag}-`));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'argv.log');
  installSpies(bin, log);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  const dbPath = path.join(dir, 'e11.sqlite');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statusPath, [
    `${QUARTZ}  192.0.2.60  UP  leases=()  compute`,
    `${SLATE}  192.0.2.61  DOWN  leases=()  storage`,
    '',
  ].join('\n'));
  fs.writeFileSync(confPath, [
    `${QUARTZ}|192.0.2.60|02:00:00:00:00:60|agjrom|compute|true`,
    `${SLATE}|192.0.2.61|02:00:00:00:00:61|agjrom|storage|true`,
    '',
  ].join('\n'));
  fs.writeFileSync(metricsPath, JSON.stringify({
    [QUARTZ]: {
      gpuTempsC: [58, 64], gpuPowerWatts: [90, 70], uptime: '2d 3h 4m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '20s', cpuTemp: 41,
    },
    [SLATE]: { gpuTempsC: [], gpuPowerWatts: [], freshness: 'stale', sampleAge: '900s' },
  }));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    E11_DB_PATH: dbPath,
    E11_SESSION_HOURS: String(SESSION_HOURS),
  };
  // Non-actuating (L10): arming is process configuration, and this fence must
  // never be able to reach a real box.
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMAC_LOG;
  delete env.XMACHINES_USE_REGISTRY;
  return { dir, log, dbPath, env };
}

// ---------------------------------------------------------------------------
// The scratch app server: the REAL createApiServer over the REAL AuthService,
// AuditService and DatabaseService, run through tsx against src/ so the
// journey never depends on a freshly built dist/ (a stale bundle would make
// this red for a build reason instead of a capability reason).
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
import { spawnSync } from 'node:child_process';
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');
const { AuthService } = await import('__SRC__/auth/auth-service.js');
const { AuditService } = await import('__SRC__/services/audit-service.js');

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
const SESSION_HOURS = Number(process.env.E11_SESSION_HOURS);
const OWNER_TG = 7001000;

const db = new DatabaseService(process.env.E11_DB_PATH);
db.ensureOwner(OWNER_TG);
const authService = new AuthService(db, BOT_TOKEN, 'e11-secret', SESSION_HOURS);
const auditService = new AuditService(db);

// A real web session, minted the way the /weblogin code path mints one. The
// role comes from the users row, so this is also the only way to obtain a
// genuine NON-OWNER token (authenticateTelegram refuses non-owners by design).
function mint(telegramId, role) {
  if (role) authService.addUser(telegramId, role);
  const issuedAt = Date.now();
  const code = authService.generateLoginCode(telegramId);
  const res = authService.authenticateWithCode(code);
  if (!res) throw new Error('could not mint a session for ' + telegramId);
  return { token: res.token, userId: res.user.id, role: res.user.role, issuedAt };
}

const owner = mint(OWNER_TG, null);
// Separate owner identities: the power rate-limit buckets are keyed by owner
// id, so each group of checks gets its own and cannot poison another's.
const owners = [];
for (let i = 0; i < 10; i++) owners.push(mint(7002000 + i, 'owner'));
const viewer = mint(7003000, 'viewer');
if (owner.role !== 'owner') throw new Error('owner fixture is not an owner: ' + owner.role);
if (viewer.role === 'owner') throw new Error('the non-owner fixture came back as owner');

const config = {
  telegram: { botToken: BOT_TOKEN, authorizedUserId: OWNER_TG, authorizedChatIds: [OWNER_TG], testMode: true, updateMode: 'polling', webhookUrl: null, webhookPath: '/api/telegram/webhook', webhookSecretToken: 's' },
  runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
  api: { port: 0, host: '127.0.0.1', jwtSecret: 'e11-secret', sessionExpiryHours: SESSION_HOURS },
  db: { path: process.env.E11_DB_PATH },
  projects: { root: '/tmp' },
  tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
  overmind: { token: 't' },
};
const services = {
  authService, auditService, db,
  projectService: {}, safetyService: {}, tmuxService: {}, tmuxStreamManager: {},
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
// Spy self-test BEFORE anything is served, so a later "no gateway call"
// observation is a real observation and not an artefact of a spy that was
// never on PATH. 'ping' is a read verb, never a wake verb.
spawnSync('ping', ['__SELFTEST__'], { encoding: 'utf8' });
console.log('E11-SERVER-READY ' + JSON.stringify({ port: app.server.address().port, owner, owners, viewer }));
`;

type Minted = { token: string; userId: number; role: string; issuedAt: number };
type Server = {
  child: ChildProcessWithoutNullStreams;
  port: number;
  owner: Minted;
  owners: Minted[];
  viewer: Minted;
  stderr: () => string;
};

async function startServer(scratch: Scratch): Promise<Server> {
  const script = path.join(scratch.dir, 'server.mts');
  fs.writeFileSync(
    script,
    SERVER_CHILD.replace(/__SRC__/g, path.join(REPO_ROOT, 'src')).replace('__SELFTEST__', SELFTEST_MARKER),
  );
  const child = spawn('npx', ['tsx', script], {
    cwd: REPO_ROOT,
    env: scratch.env,
    encoding: 'utf8',
  } as never) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const match = out.match(/E11-SERVER-READY (\{.*\})/);
    if (match) {
      const parsed = JSON.parse(match[1]) as { port: number; owner: Minted; owners: Minted[]; viewer: Minted };
      return { child, ...parsed, stderr: () => err.slice(-800) };
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`scratch app server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
}

// ---------------------------------------------------------------------------
// Raw HTTP, straight at the server, so every header this fence is about (Host,
// x-forwarded-host, Origin, Authorization) is exactly what the journey chose.
// ---------------------------------------------------------------------------
type Res = { status: number; text: string; json: Record<string, unknown> | null };

function httpCall(
  port: number,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => {
          let json: Record<string, unknown> | null = null;
          try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
          resolve({ status: res.statusCode || 0, text, json });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Canonical request headers: what a real request arriving through the
// production tunnel carries. Overrides let one check make exactly one of them
// hostile while everything else stays legitimate.
function headersFor(token: string | null, overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    host: `${CANONICAL_HOST}`,
    'x-forwarded-host': CANONICAL_HOST,
    'x-forwarded-proto': 'https',
    origin: CANONICAL_ORIGIN,
    'content-type': 'application/json',
    'idempotency-key': `e11-${Math.random().toString(36).slice(2)}`,
  };
  if (token) base.authorization = `Bearer ${token}`;
  return { ...base, ...overrides };
}

type Route = { method: string; path: string; label: string };
const XM_ROUTES: Route[] = [
  { method: 'GET', path: '/api/xmachines/telemetry', label: 'telemetry' },
  { method: 'GET', path: `/api/xmachines/machines/${QUARTZ}`, label: 'machine detail' },
  { method: 'GET', path: `/api/xmachines/machines/${QUARTZ}/history?metric=temperature`, label: 'machine history' },
  { method: 'GET', path: '/api/xmachines/audit', label: 'power audit' },
  { method: 'POST', path: `/api/xmachines/machines/${QUARTZ}/power/on`, label: 'power on' },
  { method: 'POST', path: `/api/xmachines/machines/${QUARTZ}/power/off`, label: 'power off' },
  { method: 'POST', path: `/api/xmachines/machines/${QUARTZ}/power/force`, label: 'power force' },
  { method: 'POST', path: '/api/xmachines/sessions/revoke-all', label: 'revoke all web sessions' },
];
const POWER_ROUTES: Route[] = XM_ROUTES.filter((route) => /\/power\/(on|off|force)$/.test(route.path));

function isOwnerRoleDenial(res: Res): boolean {
  return res.status === 403 && OWNER_DENIED.test(res.text);
}

function describe(res: Res): string {
  return `HTTP ${res.status} ${JSON.stringify(res.text.slice(0, 160))}`;
}

// ---------------------------------------------------------------------------
// The browser: the app served by the scratch server, reached through a
// tunnel-shaped reverse proxy (Cloudflare delivers Host: localhost:3101 plus
// the public name in x-forwarded-host, which is what hostFromRequest() reads
// first). The proxy relaxes no check; the routes still apply their allowlist.
// ---------------------------------------------------------------------------
async function startProxy(targetPort: number): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    headers.host = `127.0.0.1:${targetPort}`;
    headers['x-forwarded-host'] = CANONICAL_HOST;
    headers['x-forwarded-proto'] = 'https';
    if (headers.origin) headers.origin = CANONICAL_ORIGIN;
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

type Shell = 'miniapp' | 'desktop';

async function openShell(
  browser: import('@playwright/test').Browser,
  base: string,
  opts: { hash: string; shell: Shell; token: string; role: string },
): Promise<{ context: import('@playwright/test').BrowserContext; page: import('@playwright/test').Page }> {
  const context = await browser.newContext({ viewport: opts.shell === 'miniapp' ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript(([token, shell, role]) => {
    if (shell === 'miniapp') {
      const w = window as unknown as { Telegram?: unknown };
      w.Telegram = {
        WebApp: {
          initData: 'e11-fence',
          ready() {}, expand() {}, disableVerticalSwipes() {},
          themeParams: {},
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { selectionChanged() {} },
        },
      };
    }
    try {
      localStorage.setItem('agj_token', token as string);
      localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: role, username: role, role }));
    } catch { /* ignore */ }
  }, [opts.token, opts.shell, opts.role] as [string, string, string]);

  await page.goto(`${base}/index.html${opts.hash}`, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

type NavLook = { shell: Shell; role: string; affordances: string[]; error: string };

// What the owner (or a non-owner) can actually SEE and press on the landing
// page. A hidden node is not navigation, so visible-only.
async function navLook(
  browser: import('@playwright/test').Browser,
  base: string,
  shell: Shell,
  session: { token: string; role: string },
): Promise<NavLook> {
  const { context, page } = await openShell(browser, base, { hash: '#/', shell, token: session.token, role: session.role });
  try {
    await page.waitForSelector(NAV_SEL, { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const affordances: string[] = [];
    const explicit = page.locator(NAV_SEL);
    const explicitCount = await explicit.count();
    for (let i = 0; i < explicitCount; i++) {
      const node = explicit.nth(i);
      if (await node.isVisible().catch(() => false)) {
        affordances.push((await node.textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim().slice(0, 60) || '<unlabelled>');
      }
    }
    // A tile need not carry a testid or an href to be the thing the owner
    // presses, so any visible pressable element whose own label names the
    // section also counts.
    const labelled = page.locator('a, button, [role="button"], [role="link"], li, .tile, .card').filter({ hasText: /xmachines/i });
    const labelledCount = await labelled.count();
    for (let i = 0; i < labelledCount; i++) {
      const node = labelled.nth(i);
      if (!(await node.isVisible().catch(() => false))) continue;
      const text = ((await node.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!affordances.includes(text)) affordances.push(text);
    }
    return { shell, role: session.role, affordances, error: '' };
  } catch (error) {
    return { shell, role: session.role, affordances: [], error: (error as Error).message };
  } finally {
    await context.close();
  }
}

type DeepLink = { shell: Shell; role: string; hash: string; sections: number; body: string; leaks: string[]; denied: boolean };

// What a FRESH #/xmachines load renders — a deep link, not an in-app click.
async function deepLink(
  browser: import('@playwright/test').Browser,
  base: string,
  shell: Shell,
  session: { token: string; role: string },
): Promise<DeepLink> {
  const { context, page } = await openShell(browser, base, { hash: '#/xmachines', shell, token: session.token, role: session.role });
  try {
    await page.waitForSelector(SECTION_SEL, { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    const body = (((await page.locator('body').textContent().catch(() => '')) || '')).replace(/\s+/g, ' ').trim();
    const sectionText = (await page.locator(SECTION_SEL).allTextContents().catch(() => [])).join(' ');
    return {
      shell,
      role: session.role,
      hash: await page.evaluate(() => location.hash),
      sections: await page.locator(SECTION_SEL).count(),
      body: body.slice(0, 400),
      leaks: [QUARTZ, SLATE].filter((name) => body.includes(name) || sectionText.includes(name)),
      denied: OWNER_DENIED.test(body),
    };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Structural guard on the split itself: the two per-contributor tests below
// must between them cover exactly the row's acceptance ids, each once, naming
// exactly the two contributors.
// ---------------------------------------------------------------------------
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
  const units = new Set(Object.values(COVERED));
  if (units.size !== 2) {
    throw new Error(`fence ${FENCE_ID}: rejections must name exactly the 2 contributors, found ${JSON.stringify([...units])}`);
  }
});

// ---------------------------------------------------------------------------
// D1 — the hidden-navigation and deep-link surface: the section is owner-only
// in the nav and on a fresh deep link, and everything behind it refuses a
// non-owner, a hostile canonical Host or Origin, a GET on a power route, an
// unthrottled flood, and a noncanonical loopback peer.
// Owns: A2a A2b A2c H1a H1b H1c L6a L6b L6c L6d L6e L6j L7r
// ---------------------------------------------------------------------------
test('test_d1_the_xmachines_section_is_owner_only_in_navigation_and_every_route_behind_it_refuses_hostile_callers', async ({ browser }) => {
  test.setTimeout(240_000);
  const results: boolean[] = [];
  const scratch = newScratch('d1');
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let ownerNav: NavLook[] = [];
  let viewerNav: NavLook[] = [];
  let ownerLink: DeepLink | null = null;
  let viewerLink: DeepLink | null = null;
  let startupError = '';

  try {
    try {
      server = await startServer(scratch);
      proxy = await startProxy(server.port);
      const ownerSession = { token: server.owner.token, role: 'owner' };
      const viewerSession = { token: server.viewer.token, role: 'viewer' };
      ownerNav = [
        await navLook(browser, proxy.base, 'miniapp', ownerSession),
        await navLook(browser, proxy.base, 'desktop', ownerSession),
      ];
      viewerNav = [
        await navLook(browser, proxy.base, 'miniapp', viewerSession),
        await navLook(browser, proxy.base, 'desktop', viewerSession),
      ];
      ownerLink = await deepLink(browser, proxy.base, 'miniapp', ownerSession);
      viewerLink = await deepLink(browser, proxy.base, 'miniapp', viewerSession);
    } catch (error) {
      startupError = (error as Error).message;
    }

    const live = (): Server => {
      if (!server) throw new Error(`the scratch app server never started: ${startupError}`);
      return server;
    };

    // A2a — the nav entry is the OWNER's: it is there for the owner on both
    // shells the D1 row names, and there is nothing for a non-owner to see.
    results.push(await guardedCheck('A2a', COVERED.A2a, async () => {
      if (startupError) throw new Error(`the owner's browser never reached the app: ${startupError}`);
      const blind = ownerNav.filter((look) => look.affordances.length === 0);
      if (blind.length > 0) {
        throw new Error(`the owner sees no xmachines navigation entry on ${JSON.stringify(blind.map((l) => l.shell))} (tried ${NAV_SEL} plus any visible element labelled xmachines); an entry a non-owner cannot see must first be one the OWNER can: ${JSON.stringify(ownerNav)}`);
      }
      const leaked = viewerNav.filter((look) => look.affordances.length > 0);
      if (leaked.length > 0) {
        throw new Error(`a non-owner session sees the xmachines navigation entry on ${JSON.stringify(leaked.map((l) => ({ shell: l.shell, affordances: l.affordances })))}`);
      }
    }));

    // A2b — a fresh #/xmachines deep link renders the section for the owner
    // and renders no section (and leaks no fleet content) for a non-owner.
    results.push(await guardedCheck('A2b', COVERED.A2b, async () => {
      if (!ownerLink || !viewerLink) throw new Error(`the deep link was never loaded: ${startupError}`);
      if (ownerLink.hash !== '#/xmachines' || ownerLink.sections === 0) {
        throw new Error(`the OWNER's fresh deep link did not render the section (hash=${JSON.stringify(ownerLink.hash)} sections=${ownerLink.sections}); a non-owner's absence is only meaningful against an owner's presence. body=${JSON.stringify(ownerLink.body.slice(0, 200))}`);
      }
      if (viewerLink.leaks.length > 0) {
        throw new Error(`a non-owner's deep link leaked fleet content ${JSON.stringify(viewerLink.leaks)}: ${JSON.stringify(viewerLink.body.slice(0, 200))}`);
      }
      if (viewerLink.sections > 0 && !viewerLink.denied) {
        throw new Error(`a non-owner's fresh deep link rendered the xmachines section (${viewerLink.sections} section node(s)) with no owner-denied treatment: ${JSON.stringify(viewerLink.body.slice(0, 200))}`);
      }
    }));

    // A2c — the 401/403 matrix: every xmachines route answers 401 with no
    // session and 403 for a non-owner session.
    results.push(await guardedCheck('A2c', COVERED.A2c, async () => {
      const server_ = live();
      for (const route of XM_ROUTES) {
        const anon = await httpCall(server_.port, route.method, route.path, headersFor(null), route.method === 'POST' ? '{}' : undefined);
        if (anon.status !== 401) {
          throw new Error(`${route.method} ${route.label} answered a request with NO session with ${describe(anon)}, expected 401`);
        }
        const viewer = await httpCall(server_.port, route.method, route.path, headersFor(server_.viewer.token), route.method === 'POST' ? '{}' : undefined);
        if (!isOwnerRoleDenial(viewer)) {
          throw new Error(`${route.method} ${route.label} answered a valid NON-OWNER session with ${describe(viewer)}, expected 403 owner-role-required`);
        }
      }
    }));

    // H1a — the gate is the OWNER ROLE, not a blanket refusal: the same routes
    // that refuse a non-owner let an owner through.
    results.push(await guardedCheck('H1a', COVERED.H1a, async () => {
      const server_ = live();
      for (const route of XM_ROUTES) {
        const viewer = await httpCall(server_.port, route.method, route.path, headersFor(server_.viewer.token), route.method === 'POST' ? '{}' : undefined);
        if (!isOwnerRoleDenial(viewer)) {
          throw new Error(`${route.method} ${route.label} does not require the owner role: a non-owner got ${describe(viewer)}`);
        }
        // revoke-all really revokes, so its owner probe uses a throwaway owner
        // identity whose sessions nothing else in this fence depends on.
        const token = route.path.endsWith('/sessions/revoke-all') ? server_.owners[9].token : server_.owners[0].token;
        const owner = await httpCall(server_.port, route.method, route.path, headersFor(token), route.method === 'POST' ? '{}' : undefined);
        if (owner.status === 401 || isOwnerRoleDenial(owner)) {
          throw new Error(`${route.method} ${route.label} refuses an OWNER too (${describe(owner)}); the route is not owner-gated, it is closed`);
        }
      }
    }));

    // H1b — power routes reject a Host outside the allowlist.
    results.push(await guardedCheck('H1b', COVERED.H1b, async () => {
      const server_ = live();
      const token = server_.owners[1].token;
      for (const route of POWER_ROUTES) {
        const res = await httpCall(
          server_.port, route.method, route.path,
          headersFor(token, { 'x-forwarded-host': 'evil.example.com', host: 'evil.example.com' }),
          '{}',
        );
        if (res.status !== 403 || !/host_not_allowed/.test(res.text)) {
          throw new Error(`${route.label} accepted a foreign Host (evil.example.com) with ${describe(res)}, expected 403 host_not_allowed`);
        }
      }
    }));

    // H1c — power routes reject an Origin outside the allowlist.
    results.push(await guardedCheck('H1c', COVERED.H1c, async () => {
      const server_ = live();
      const token = server_.owners[2].token;
      for (const route of POWER_ROUTES) {
        const res = await httpCall(
          server_.port, route.method, route.path,
          headersFor(token, { origin: 'https://evil.example.com' }),
          '{}',
        );
        if (res.status !== 403 || !/origin_not_allowed/.test(res.text)) {
          throw new Error(`${route.label} accepted a foreign Origin (https://evil.example.com) with ${describe(res)}, expected 403 origin_not_allowed`);
        }
      }
    }));

    // L6a — every power route is POST-only: a GET is not a power action.
    results.push(await guardedCheck('L6a', COVERED.L6a, async () => {
      const server_ = live();
      const token = server_.owners[3].token;
      for (const route of POWER_ROUTES) {
        const res = await httpCall(server_.port, 'GET', route.path, headersFor(token));
        if (res.status < 400 || res.status >= 500) {
          throw new Error(`GET ${route.label} was answered with ${describe(res)}; a power route must not serve GET`);
        }
        if (![404, 405].includes(res.status)) {
          throw new Error(`GET ${route.label} answered ${describe(res)}, expected 404 or 405 (method not routed)`);
        }
      }
    }));

    // L6b — the external Host check is a STRICT allowlist, not a substring or
    // suffix match: canonical-looking hosts are refused.
    results.push(await guardedCheck('L6b', COVERED.L6b, async () => {
      const server_ = live();
      const token = server_.owners[4].token;
      const hostile = [
        `${CANONICAL_HOST}.evil.example.com`,
        `evil.${CANONICAL_HOST}`,
        `${CANONICAL_HOST}:8443`,
        'agjasst.silverjrom.app.',
      ];
      const route = POWER_ROUTES.find((r) => r.path.endsWith('/power/off'))!;
      for (const host of hostile) {
        const res = await httpCall(server_.port, 'POST', route.path, headersFor(token, { 'x-forwarded-host': host, host }), '{}');
        if (res.status !== 403 || !/host_not_allowed/.test(res.text)) {
          throw new Error(`the Host allowlist admitted ${JSON.stringify(host)} with ${describe(res)}; only the exact canonical name and the local-test entries may pass`);
        }
      }
    }));

    // L6c — the external Origin check is a STRICT allowlist: a canonical-
    // looking or wrong-scheme Origin is refused.
    results.push(await guardedCheck('L6c', COVERED.L6c, async () => {
      const server_ = live();
      const token = server_.owners[5].token;
      const hostile = [
        `https://${CANONICAL_HOST}.evil.example.com`,
        `https://evil.${CANONICAL_HOST}`,
        `http://${CANONICAL_HOST}`,
        'null',
      ];
      const route = POWER_ROUTES.find((r) => r.path.endsWith('/power/off'))!;
      for (const origin of hostile) {
        const res = await httpCall(server_.port, 'POST', route.path, headersFor(token, { origin }), '{}');
        if (res.status !== 403 || !/origin_not_allowed/.test(res.text)) {
          throw new Error(`the Origin allowlist admitted ${JSON.stringify(origin)} with ${describe(res)}; only the exact canonical origin and the local-test entries may pass`);
        }
      }
    }));

    // L6d — a per-route rate limit: the same owner cannot hammer one power
    // route without being throttled.
    results.push(await guardedCheck('L6d', COVERED.L6d, async () => {
      const server_ = live();
      const token = server_.owners[6].token;
      const route = POWER_ROUTES.find((r) => r.path.endsWith('/power/off'))!;
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await httpCall(server_.port, 'POST', route.path, headersFor(token), '{}');
        statuses.push(res.status);
        if (res.status === 429) break;
      }
      if (!statuses.includes(429)) {
        throw new Error(`${statuses.length} consecutive POSTs to ${route.label} by one owner were never throttled (statuses ${JSON.stringify(statuses)}); the route enforces no rate limit`);
      }
      if (statuses[0] === 429) {
        throw new Error(`the very first POST to ${route.label} was throttled (${JSON.stringify(statuses)}); that is a poisoned bucket, not a rate limit under test`);
      }
    }));

    // L6e — a cross-route rate limit per owner identity: spreading the same
    // flood across on AND off, so neither route's own bucket is exhausted,
    // still gets throttled.
    results.push(await guardedCheck('L6e', COVERED.L6e, async () => {
      const server_ = live();
      const token = server_.owners[7].token;
      const on = POWER_ROUTES.find((r) => r.path.endsWith('/power/on'))!;
      const off = POWER_ROUTES.find((r) => r.path.endsWith('/power/off'))!;
      const seen: Array<{ route: string; status: number }> = [];
      let throttled = false;
      let perRouteOn = 0;
      let perRouteOff = 0;
      for (let i = 0; i < 14 && !throttled; i++) {
        const route = i % 2 === 0 ? on : off;
        if (route === on) perRouteOn++; else perRouteOff++;
        const res = await httpCall(server_.port, 'POST', route.path, headersFor(token), '{}');
        seen.push({ route: route.label, status: res.status });
        throttled = res.status === 429;
      }
      if (!throttled) {
        throw new Error(`an owner spread ${seen.length} power POSTs across two routes and was never throttled (${JSON.stringify(seen)}); there is no cross-route per-owner limit`);
      }
      const last = seen[seen.length - 1];
      const perRoute = last.route === on.label ? perRouteOn : perRouteOff;
      if (perRoute > 10) {
        throw new Error(`the throttle fired only after ${perRoute} requests to ${last.route} alone, which its own per-route limit already covers; that is not evidence of a cross-route limit (${JSON.stringify(seen)})`);
      }
    }));

    // L6j — a LOOPBACK peer is not trusted for being loopback: a loopback
    // Host or Origin outside the allowlist is refused, while the allowlisted
    // local-test entries still pass.
    results.push(await guardedCheck('L6j', COVERED.L6j, async () => {
      const server_ = live();
      const token = server_.owners[0].token;
      const route = POWER_ROUTES.find((r) => r.path.endsWith('/power/force'))!;
      const ephemeralHost = `127.0.0.1:${server_.port}`;
      const noncanonicalHost = await httpCall(
        server_.port, 'POST', route.path,
        // No x-forwarded-host at all: the request arrives straight from a
        // loopback peer on the ephemeral port it is really listening on.
        { host: ephemeralHost, 'content-type': 'application/json', authorization: `Bearer ${token}`, origin: `http://${ephemeralHost}` },
        '{}',
      );
      if (noncanonicalHost.status !== 403 || !/host_not_allowed/.test(noncanonicalHost.text)) {
        throw new Error(`a loopback peer with the noncanonical Host ${JSON.stringify(ephemeralHost)} was answered ${describe(noncanonicalHost)}, expected 403 host_not_allowed`);
      }
      const noncanonicalOrigin = await httpCall(
        server_.port, 'POST', route.path,
        headersFor(token, { 'x-forwarded-host': 'localhost:3101', host: 'localhost:3101', origin: 'http://localhost:9999' }),
        '{}',
      );
      if (noncanonicalOrigin.status !== 403 || !/origin_not_allowed/.test(noncanonicalOrigin.text)) {
        throw new Error(`a loopback peer with the noncanonical Origin http://localhost:9999 was answered ${describe(noncanonicalOrigin)}, expected 403 origin_not_allowed`);
      }
      const allowlisted = await httpCall(
        server_.port, 'POST', route.path,
        headersFor(token, { 'x-forwarded-host': 'localhost:3101', host: 'localhost:3101', origin: 'http://localhost:3101' }),
        '{}',
      );
      if (allowlisted.status === 403 && /host_not_allowed|origin_not_allowed/.test(allowlisted.text)) {
        throw new Error(`the allowlisted local-test entry localhost:3101 was refused as well (${describe(allowlisted)}); the refusal is blanket, not an allowlist`);
      }
    }));

    // L7r — the power-audit view rejects a non-owner, and serves the owner.
    results.push(await guardedCheck('L7r', COVERED.L7r, async () => {
      const server_ = live();
      const viewer = await httpCall(server_.port, 'GET', '/api/xmachines/audit', headersFor(server_.viewer.token));
      if (!isOwnerRoleDenial(viewer)) {
        throw new Error(`the power-audit view answered a non-owner with ${describe(viewer)}, expected 403 owner-role-required`);
      }
      const anon = await httpCall(server_.port, 'GET', '/api/xmachines/audit', headersFor(null));
      if (anon.status !== 401) {
        throw new Error(`the power-audit view answered an unauthenticated request with ${describe(anon)}, expected 401`);
      }
      const owner = await httpCall(server_.port, 'GET', '/api/xmachines/audit', headersFor(server_.owners[0].token));
      if (owner.status !== 200 || !Array.isArray(owner.json?.entries)) {
        throw new Error(`the power-audit view did not serve the OWNER (${describe(owner)}); a view that rejects everyone does not prove it rejects a non-owner`);
      }
    }));
  } finally {
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('E11/D1', results, 13);
});

// ---------------------------------------------------------------------------
// D12 — the revocation surface: an owner settings action revokes all web
// sessions, the current UI returns to login and every prior token stops
// working; and a power-capable web session is bounded by its configured
// lifetime in the first place.
// Owns: L6f L6g
// ---------------------------------------------------------------------------
test('test_d12_the_owner_settings_revoke_action_returns_the_ui_to_login_and_kills_every_prior_token', async ({ browser }) => {
  test.setTimeout(240_000);
  const results: boolean[] = [];
  const scratch = newScratch('d12');
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let startupError = '';

  type Revoke = {
    shell: Shell;
    found: string[];
    clicked: boolean;
    loginVisible: boolean;
    tokenInStorage: string | null;
    body: string;
    error: string;
  };
  let revoke: Revoke | null = null;
  let sessionsBefore: Array<{ surface: string; expires_at: string; created_at: string }> = [];
  let sessionsAfter: Array<{ surface: string }> = [];
  let tokenAfter: Res | null = null;

  const readSessions = (userId: number): Array<Record<string, string>> => {
    const db = new Database(scratch.dbPath, { readonly: true });
    try {
      return db.prepare('SELECT surface, expires_at, created_at FROM sessions WHERE user_id = ?').all(userId) as Array<Record<string, string>>;
    } finally {
      db.close();
    }
  };

  try {
    try {
      server = await startServer(scratch);
      proxy = await startProxy(server.port);
      sessionsBefore = readSessions(server.owner.userId) as Array<{ surface: string; expires_at: string; created_at: string }>;

      // The owner goes looking for the action where an owner would: settings
      // first, then the section itself. Mini-app shell, then desktop.
      const session = { token: server.owner.token, role: 'owner' };
      for (const shell of ['miniapp', 'desktop'] as Shell[]) {
        for (const hash of ['#/settings', '#/xmachines']) {
          if (revoke?.clicked) break;
          const { context, page } = await openShell(browser, proxy.base, { hash, shell, token: session.token, role: session.role });
          try {
            await page.waitForTimeout(1_500);
            const found: string[] = [];
            const explicit = page.locator(REVOKE_SEL);
            const labelled = page.locator('a, button, [role="button"]').filter({ hasText: /revoke\s+(all\s+)?(web\s+)?sessions|sign out everywhere|log out everywhere|log out all/i });
            let target: import('@playwright/test').Locator | null = null;
            for (const candidate of [explicit, labelled]) {
              const count = await candidate.count();
              for (let i = 0; i < count; i++) {
                const node = candidate.nth(i);
                if (!(await node.isVisible().catch(() => false))) continue;
                found.push(((await node.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 60) || '<unlabelled>');
                if (!target) target = node;
              }
            }
            if (!target) {
              if (!revoke) revoke = { shell, found, clicked: false, loginVisible: false, tokenInStorage: null, body: '', error: `no owner revoke-all-web-sessions action on ${shell} ${hash}` };
              continue;
            }
            await target.click({ timeout: 5_000 }).catch(() => {});
            // A destructive owner action may confirm first (the codebase's own
            // two-step `mcp-revoke` pattern); press the confirmation if one
            // appears.
            const confirm = page.locator('button, [role="button"]').filter({ hasText: /confirm|revoke|yes/i });
            const confirmCount = await confirm.count();
            for (let i = 0; i < confirmCount; i++) {
              const node = confirm.nth(i);
              if (!(await node.isVisible().catch(() => false))) continue;
              const text = ((await node.textContent().catch(() => '')) || '');
              if (/confirm|yes/i.test(text)) { await node.click({ timeout: 3_000 }).catch(() => {}); break; }
            }
            await page.waitForSelector(LOGIN_SEL, { timeout: 15_000 }).catch(() => {});
            await page.waitForTimeout(1_000);
            const body = (((await page.locator('body').textContent().catch(() => '')) || '')).replace(/\s+/g, ' ').trim();
            revoke = {
              shell,
              found,
              clicked: true,
              loginVisible: (await page.locator(LOGIN_SEL).count()) > 0 || /log in again|session expired|sign in/i.test(body),
              tokenInStorage: await page.evaluate(() => { try { return localStorage.getItem('agj_token'); } catch { return null; } }),
              body: body.slice(0, 300),
              error: '',
            };
          } finally {
            await context.close();
          }
        }
      }

      if (revoke?.clicked) {
        tokenAfter = await httpCall(server.port, 'GET', '/api/xmachines/telemetry', headersFor(server.owner.token));
        sessionsAfter = readSessions(server.owner.userId) as Array<{ surface: string }>;
      }
    } catch (error) {
      startupError = (error as Error).message;
    }

    // L6f — a power-capable web session is bounded by the configured short
    // lifetime: the stored session row expires within it and the issued JWT
    // cannot outlive the row.
    results.push(await guardedCheck('L6f', COVERED.L6f, async () => {
      if (!server) throw new Error(`the scratch app server never started: ${startupError}`);
      const rows = sessionsBefore.filter((row) => ['web', 'miniapp'].includes(row.surface));
      if (rows.length === 0) {
        throw new Error(`the owner's power-capable web session left no session row to bound (rows=${JSON.stringify(sessionsBefore)})`);
      }
      for (const row of rows) {
        const hours = (new Date(row.expires_at).getTime() - server.owner.issuedAt) / 3_600_000;
        if (!Number.isFinite(hours)) {
          throw new Error(`a web session row has an unusable expiry ${JSON.stringify(row.expires_at)}; an unbounded session is not a short one`);
        }
        if (hours > SESSION_HOURS * 1.1 || hours < SESSION_HOURS * 0.5) {
          throw new Error(`a power-capable web session expires in ${hours.toFixed(2)}h, but the server was configured for ${SESSION_HOURS}h; the configured lifetime is not what the session got`);
        }
      }
      const payload = server.owner.token.split('.')[1];
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
      if (typeof claims.exp !== 'number') {
        throw new Error('the issued web-session token carries no exp claim, so nothing bounds it if the session row is lost');
      }
      const tokenHours = (claims.exp * 1000 - server.owner.issuedAt) / 3_600_000;
      if (tokenHours > SESSION_HOURS * 1.1) {
        throw new Error(`the issued token lives ${tokenHours.toFixed(2)}h against a configured ${SESSION_HOURS}h session`);
      }
    }));

    // L6g — the owner's settings action revokes all web sessions: the UI
    // returns to login, the stored token is gone, the prior bearer token is
    // refused by the API, and the session rows are deleted.
    results.push(await guardedCheck('L6g', COVERED.L6g, async () => {
      if (!server) throw new Error(`the scratch app server never started: ${startupError}`);
      if (!revoke || !revoke.clicked) {
        throw new Error(`the owner has no revoke-all-web-sessions action to use: ${revoke?.error || startupError || 'nothing matching ' + REVOKE_SEL + ' or a revoke-sessions label was visible on #/settings or #/xmachines on either shell'}`);
      }
      if (!revoke.loginVisible || revoke.tokenInStorage) {
        throw new Error(`after revoking, the UI did not return to login (login surface visible=${revoke.loginVisible}, stored token still present=${Boolean(revoke.tokenInStorage)}): ${JSON.stringify(revoke.body.slice(0, 200))}`);
      }
      if (!tokenAfter || tokenAfter.status !== 401) {
        throw new Error(`the owner's PRIOR bearer token still works after revoke-all: ${tokenAfter ? describe(tokenAfter) : 'never probed'}, expected 401`);
      }
      const survivors = sessionsAfter.filter((row) => ['web', 'miniapp'].includes(row.surface));
      if (survivors.length > 0) {
        throw new Error(`${survivors.length} web session row(s) survived revoke-all: ${JSON.stringify(survivors)}`);
      }
    }));
  } finally {
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('E11/D12', results, 2);
});
