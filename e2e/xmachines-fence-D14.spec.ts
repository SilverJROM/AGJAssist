import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FENCE_ID, ACCEPTANCE_IDS } from './xmachines-fence-D14.manifest.mjs';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence D14 — INTEGRATION: the overview and the power controls compose on the
// ONE live xmachines section — the owner sees a section, not two pages.
// Contributors: D1 (navigation + routing: the section is reachable at all) and
// D7 (the normal ON/Off controls rendered on that section, including the exact
// guard refusal the production route returns).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove D14 and
// implements none of it; it contains no product code.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. The file this replaces
// declared ONE test for BOTH contributors: a red CLOSE on it could only answer
// fault_class=plan failing_units=(none), the fence would requeue nothing and
// could never close. Every assertion that file made survives below, at equal or
// greater strength; nothing was dropped to make the split tidy.
//   test_d1_...   A1e   (unit D1)
//   test_d7_...   D2e   (unit D7)
//
// Attribution: A1e originates on D1 (req-matrix) and D2e on C4 (the normal-OFF
// route, already landed) — but on THIS fence D2e is asserted through the
// RENDERED refusal, which is D7's deliverable: a section whose Off control does
// not show the reason the route gave is a D7 regression even when the route's
// JSON is perfect. Only TWO distinct units appear across every rejection, so a
// red report stays `missing_acceptance` and never trips the J1c >2-unit
// plan_defect rule.
//
// THE FLEET IS THIS JOURNEY'S OWN SERVER, NOT THE DEPLOYED APP. The journey
// spawns the real `createApiServer` through tsx against src/, with an xmac
// `status` fixture, a machines.conf fixture, a telemetry fixture, a scratch
// XMAC_STATE holding a real lease file, and a PATH gateway-spy. The real fleet
// is never contacted. FENCE_ORIGIN is deliberately ignored: a deployed origin
// could not be given a lease-held fictional machine, so the refusal D2e is
// about would be unobservable.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. XMACHINES_ARM=1 IS SET, unlike the unarmed fake-fleet fences. An unarmed
//     server answers every power POST 403 `reason: "unarmed"` before any guard
//     runs, so the only "refusal reason" a UI could render would be the server's
//     own configuration — not the normal-Off guard refusal D2e names. Arming is
//     safe here and cannot actuate: the refusal is decided by ActionCoordinator
//     BEFORE it spawns anything (the active-lease gate returns without a
//     child), `xmac.sh`/`xmac`/`wakeonlan`/`ssh` are PATH spies under
//     os.tmpdir(), the machines are fictional names on TEST-NET-1 addresses,
//     and the D7 test asserts the spy recorded ZERO gateway calls — it fails
//     loudly if anything ever reached a gateway.
//  2. The exact refusal string is not hardcoded from the plan: the journey first
//     asks the PRODUCTION route itself (owner bearer + idempotency key, through
//     the tunnel-shaped proxy) what it refuses with, requires that to be the
//     literal `active lease: <holder>`, and only then requires the UI to render
//     that same string. "Exact" therefore means "the same text the route
//     returned", which is what D2e is for; a UI that prints its own friendly
//     paraphrase fails.
//  3. The UI's own POST is observed on the wire, and the rendered reason must
//     appear on a page that really called `/power/off`. A section that printed
//     the right sentence without asking the route would not satisfy D2e.
//  4. No canonical DOM contract for D7 exists yet, so the Off control is any of
//     several testids/data-actions OR any visible pressable element whose own
//     label reads as powering the box off, and the refusal may surface in a
//     refusal-reason node, a role=alert, or the section's text. That broadens
//     WHERE the evidence may appear; it does not weaken WHAT must be true.
//  5. The owner's Off is attempted on BOTH the machine-detail hash (what the
//     file this replaces used: `#/xmachines/<machine>`) and the overview hash,
//     and either surface satisfies D2e — the fence row's point is that the
//     controls compose on the ONE section, not which of its two views holds the
//     button.
//  6. A1e keeps the replaced file's deep-link assertion AND adds the
//     navigation half (an affordance on the landing page, either shell), the
//     same reading E1 uses. Deep-link-only is already green — the router landed
//     with an earlier slice — so a deep-link-only A1e could never name D1, and
//     this fence would be red on D2e alone.
//  7. The owner session is a stub authService inside the scratch server (the
//     C1/E1 pattern). This fence is render/composition, not the auth matrix
//     (A2c/H1x own that elsewhere), so minting a real JWT against a live
//     database would add a dependency without adding evidence.
//  8. XMAC_LOG is set to the empty string, which `resolveXmacLogPath` reads as
//     "no log": WoL evidence is then absent, the route skips the force-challenge
//     branch, and the normal-Off path reaches the lease guard deterministically.
//     It also guarantees the journey never reads the real ~/.xmac/xmac.log.
//  9. RED TODAY, and MEASURED by running this journey rather than assumed:
//     A1e REJECTS — no landing-page affordance on either shell leads to the
//     section, so owner navigation cannot reach it (D1 has not shipped the nav
//     entry); the deep link alone already renders, which is why the navigation
//     half is what names D1.
//     D2e is ALREADY GREEN against the landed detail surface
//     (`xmachines-cost-view.js` renders `xmachines-off-button`,
//     `handleMachineDetailClick` POSTs the production `/power/off`, and
//     `renderNormalOffRefusal` prints the route's exact `detail`). D7 will not
//     turn it from red to green. It is asserted here at full strength anyway,
//     because THIS fence is where the refusal must KEEP being rendered once D7
//     re-renders the ON/Off controls on the composed section, and the
//     contract's negative control (FENCE_STUB=D7 --expect-red D2e) still
//     discriminates D7 through it. Recorded, not engineered away: weakening or
//     re-pointing D2e to manufacture a red would assert something other than
//     the criterion.
// ---------------------------------------------------------------------------

// id -> the contributor blamed when it rejects. Exactly two distinct units.
const COVERED: Record<string, string> = {
  A1e: 'D1',
  D2e: 'D7',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'd14-fence-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const WAKE_VERBS = ['up', 'down', 'run', 'claim', 'release', 'wake'];
const SELFTEST_MARKER = 'd14-spy-selftest';

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media) so no assertion here can be satisfied by, or aimed at, a real box.
const QUARTZ = 'd14-quartz';   // UP, lease-held — the Off target
const SLATE = 'd14-slate';     // DOWN
const LEASE_HOLDER = 'hold-d14-ember';
// What the production normal-OFF path refuses a lease-held machine with
// (ActionCoordinator: `active lease: <holders>`), decided before any spawn.
const EXPECTED_REASON = 'active-lease';
const EXPECTED_DETAIL = `active lease: ${LEASE_HOLDER}`;

const SECTION_SEL = [
  '[data-section="xmachines"]',
  '[data-testid="xmachines-fleet-overview"]',
  '.xmachines-view',
].join(', ');
const NAV_SEL = [
  '[data-testid="xmachines-tile"]',
  '[data-testid="xmachines-nav"]',
  '[data-nav="xmachines"]',
  'a[href="#/xmachines"]',
  'a[href="/#/xmachines"]',
].join(', ');
const OFF_SEL = [
  '[data-testid="xmachines-off-button"]',
  '[data-action="power-off"]',
  '[data-testid="xmachines-power-off"]',
  '[data-testid="power-off"]',
  '[data-power-action="off"]',
  'button[data-action="off"]',
].join(', ');
const REASON_SEL = [
  '[data-testid="xmachines-off-refusal"]',
  '[data-testid="xmachines-off-refusal-reason"]',
  '[data-refusal-reason]',
  '[data-testid="xmachines-refusal-reason"]',
  '[data-testid="xmachines-power-refusal"]',
  '[data-testid="power-refusal"]',
  '[role="alert"]',
].join(', ');

function finish(fenceTest: string, results: boolean[], expected: number): void {
  if (results.length !== expected) {
    throw new Error(`${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  }
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// ---------------------------------------------------------------------------
// Scratch fleet: xmac `status` text, machines.conf, telemetry fixture, a real
// lease file and a PATH gateway-spy. Every path is under os.tmpdir(); the
// repository and the real ~/.config/agent-protocols/xmac are untouched.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  log: string;
  statusPath: string;
  confPath: string;
  metricsPath: string;
  stateDir: string;
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

function statusLines(): string {
  return [
    `${QUARTZ}  192.0.2.60  UP  leases=(${LEASE_HOLDER})  compute`,
    `${SLATE}  192.0.2.61  DOWN  leases=()  storage`,
  ].join('\n') + '\n';
}

// The 6th field is the busy-check command and is deliberately EMPTY: an
// SSH busy preflight would make the refusal depend on a spied ssh instead of
// the lease, and this fence is about the lease refusal reaching the UI.
function confLines(): string {
  return [
    `${QUARTZ}|192.0.2.60|02:00:00:00:00:60|agjrom|compute|`,
    `${SLATE}|192.0.2.61|02:00:00:00:00:61|agjrom|storage|`,
  ].join('\n') + '\n';
}

function newScratch(tag: string): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `d14-${tag}-`));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'argv.log');
  installSpies(bin, log);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  fs.writeFileSync(statusPath, statusLines());
  fs.writeFileSync(confPath, confLines());
  // The real lease shape ActionCoordinator reads: $XMAC_STATE/leases/<machine>/<holder>
  fs.mkdirSync(path.join(stateDir, 'leases', QUARTZ), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'leases', QUARTZ, LEASE_HOLDER), '');
  fs.writeFileSync(metricsPath, JSON.stringify({
    [QUARTZ]: {
      gpuTempsC: [58, 64], gpuPowerWatts: [110, 40], uptime: '5d 6h 7m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '22s', cpuTemp: 45,
    },
    [SLATE]: {
      gpuTempsC: [51], gpuPowerWatts: [80], uptime: '2d 0h 4m',
      freshness: 'stale', sampleAge: '1100s',
    },
  }));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    // Ambiguity 8: empty means "no xmac log", so no WoL evidence exists and the
    // real ~/.xmac/xmac.log is never read.
    XMAC_LOG: '',
    // Ambiguity 1: armed, so a power POST reaches the normal-Off guards at all.
    XMACHINES_ARM: '1',
    D14_OWNER_TOKEN: OWNER_TOKEN,
  };
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  return { dir, log, statusPath, confPath, metricsPath, stateDir, env };
}

function argvRows(log: string): string[][] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => line.split('\t'));
}

function isForbiddenGatewayCall(row: string[]): boolean {
  if (row[0] === 'xmac.sh' || row[0] === 'xmac' || row[0] === 'wakeonlan') return true;
  return row.some((token) => WAKE_VERBS.includes(token));
}

// ---------------------------------------------------------------------------
// The scratch app server: the REAL createApiServer, run through tsx against
// src/ so the journey never depends on a freshly built dist/ (a stale bundle
// would make this red for a build reason instead of a capability reason).
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
import { spawnSync } from 'node:child_process';
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');

const OWNER_TOKEN = process.env.D14_OWNER_TOKEN;
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
// Spy self-test BEFORE anything is served, so "zero gateway calls" is a real
// observation and not an artefact of a spy that was never on PATH. 'ping' is a
// read verb, never a wake verb.
spawnSync('ping', ['__SELFTEST__'], { encoding: 'utf8' });
console.log('D14-SERVER-READY ' + app.server.address().port);
`;

type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };

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
    const match = out.match(/D14-SERVER-READY (\d+)/);
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
// first. This reproduces that header shape for a server on an ephemeral port.
// It relaxes no check: the route still applies its own allowlist.
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

// One authenticated owner browser on the app the scratch server serves.
async function openShell(
  browser: import('@playwright/test').Browser,
  base: string,
  opts: { hash: string; shell?: Shell },
): Promise<{
  context: import('@playwright/test').BrowserContext;
  page: import('@playwright/test').Page;
  offPosts: Array<{ status: number; body: string }>;
}> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const offPosts: Array<{ status: number; body: string }> = [];
  page.on('response', async (response) => {
    if (!/\/power\/off$/.test(response.url().split('?')[0])) return;
    let body = '';
    try { body = await response.text(); } catch { body = ''; }
    offPosts.push({ status: response.status(), body });
  });
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript(([token, shell]) => {
    if (shell === 'miniapp') {
      const w = window as unknown as { Telegram?: unknown };
      w.Telegram = {
        WebApp: {
          initData: 'd14-fence',
          ready() {}, expand() {}, disableVerticalSwipes() {},
          themeParams: {},
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { selectionChanged() {} },
        },
      };
    }
    try {
      localStorage.setItem('agj_token', token as string);
      localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'owner', username: 'owner', role: 'owner' }));
    } catch { /* ignore */ }
  }, [OWNER_TOKEN, opts.shell ?? 'miniapp'] as [string, string]);

  await page.goto(`${base}/index.html${opts.hash}`, { waitUntil: 'domcontentloaded' });
  return { context, page, offPosts };
}

// ---------------------------------------------------------------------------
// D1's surface: is the section REACHED and RENDERED at all?
// ---------------------------------------------------------------------------
type DeepLink = { hash: string; sectionCount: number; bodyText: string };

async function openDeepLink(
  browser: import('@playwright/test').Browser,
  base: string,
): Promise<{ close: () => Promise<void>; seen: DeepLink }> {
  const { context, page } = await openShell(browser, base, { hash: '#/xmachines' });
  // Give the section its own chance to appear; a miss here is an assertion
  // failure below, not a thrown timeout.
  await page.waitForSelector(SECTION_SEL, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const seen: DeepLink = {
    hash: await page.evaluate(() => location.hash),
    sectionCount: await page.locator(SECTION_SEL).count(),
    bodyText: ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim(),
  };
  return { close: () => context.close(), seen };
}

type NavAttempt = { shell: Shell; affordances: number; hash: string; sectionCount: number; error: string };

// Owner navigation: start on the landing page and reach the section by USING
// the app, not by typing a hash. Either shell's affordance satisfies it.
async function navigateFromLanding(
  browser: import('@playwright/test').Browser,
  base: string,
  shell: Shell,
): Promise<NavAttempt> {
  const { context, page } = await openShell(browser, base, { hash: '#/', shell });
  try {
    await page.waitForTimeout(1_500);
    const visible: number[] = [];
    const count = await page.locator(NAV_SEL).count();
    for (let i = 0; i < count; i++) {
      if (await page.locator(NAV_SEL).nth(i).isVisible().catch(() => false)) visible.push(i);
    }
    if (visible.length === 0) {
      // Last resort before declaring no affordance: any visible, pressable
      // element whose own label names the section.
      const labelled = page.locator('a, button, [role="button"], [role="link"], li, .tile, .card')
        .filter({ hasText: /xmachines/i });
      const labelledCount = await labelled.count();
      let pressed = false;
      for (let i = 0; i < labelledCount; i++) {
        const node = labelled.nth(i);
        if (!(await node.isVisible().catch(() => false))) continue;
        await node.click({ timeout: 3_000 }).catch(() => {});
        pressed = true;
        break;
      }
      if (!pressed) {
        return {
          shell,
          affordances: 0,
          hash: await page.evaluate(() => location.hash),
          sectionCount: 0,
          error: 'no visible xmachines navigation affordance on the landing page',
        };
      }
    } else {
      await page.locator(NAV_SEL).nth(visible[0]).click({ timeout: 5_000 }).catch(() => {});
    }
    await page.waitForSelector(SECTION_SEL, { timeout: 10_000 }).catch(() => {});
    return {
      shell,
      affordances: visible.length,
      hash: await page.evaluate(() => location.hash),
      sectionCount: await page.locator(SECTION_SEL).count(),
      error: '',
    };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// D7's surface: the owner presses Off on the section and the section renders
// the reason the production route refused with.
// ---------------------------------------------------------------------------
type OffAttempt = {
  hash: string;
  controls: number;
  pressed: boolean;
  posts: Array<{ status: number; body: string }>;
  reasonNodes: string[];
  bodyText: string;
  error: string;
};

async function pressOff(
  browser: import('@playwright/test').Browser,
  base: string,
  hash: string,
): Promise<OffAttempt> {
  const { context, page, offPosts } = await openShell(browser, base, { hash });
  try {
    await page.waitForSelector(SECTION_SEL, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_000);

    // A control the owner can actually see and press. A hidden node is not a
    // control, so visible-only.
    const candidates: import('@playwright/test').Locator[] = [];
    const explicit = page.locator(OFF_SEL);
    const explicitCount = await explicit.count();
    for (let i = 0; i < explicitCount; i++) {
      const node = explicit.nth(i);
      if (await node.isVisible().catch(() => false)) candidates.push(node);
    }
    if (candidates.length === 0) {
      // Ambiguity 4: a button need not carry a testid to be the thing the owner
      // presses — a visible pressable element whose own label reads as powering
      // the box off counts.
      const labelled = page.locator('button, a, [role="button"]')
        .filter({ hasText: /power\s*off|shut\s*down|turn\s*off|^\s*off\s*$/i });
      const labelledCount = await labelled.count();
      for (let i = 0; i < labelledCount; i++) {
        const node = labelled.nth(i);
        if (await node.isVisible().catch(() => false)) candidates.push(node);
      }
    }

    let pressed = false;
    let error = '';
    if (candidates.length === 0) {
      error = `no visible power-off control on the section at ${hash} (tried ${OFF_SEL}, then any visible pressable element labelled power off / shut down / turn off)`;
    } else {
      await candidates[0].click({ timeout: 5_000 }).catch((e: Error) => { error = `the power-off control could not be pressed: ${e.message}`; });
      pressed = error === '';
      // The refusal has to come back from the route, then be rendered.
      await page.waitForResponse(
        (response) => /\/power\/off$/.test(response.url().split('?')[0]),
        { timeout: 15_000 },
      ).catch(() => {});
      await page.waitForTimeout(1_000);
    }

    const reasonNodes = await page.$$eval(REASON_SEL, (nodes) => nodes
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.length > 0));

    return {
      hash,
      controls: candidates.length,
      pressed,
      posts: [...offPosts],
      reasonNodes,
      bodyText: ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim(),
      error,
    };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Structural guard on the split itself: the two per-contributor tests below
// must between them cover exactly the row's acceptance ids, each once.
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
// D1 — the section exists as a place: owner navigation reaches it from the
// landing page, and a fresh `#/xmachines` deep link renders it rather than the
// landing page (mini-app shell, the one carrying the KNOWN_EXACT redirect).
// Owns: A1e
// ---------------------------------------------------------------------------
test('test_d1_owner_navigation_and_a_fresh_deep_link_both_reach_the_xmachines_section', async ({ browser }) => {
  test.setTimeout(180_000);
  const results: boolean[] = [];
  const scratch = newScratch('nav');
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let deep: { close: () => Promise<void>; seen: DeepLink } | null = null;
  let nav: NavAttempt[] = [];
  let startupError = '';

  try {
    try {
      server = await startServer(scratch);
      proxy = await startProxy(server.port);
      deep = await openDeepLink(browser, proxy.base);
      nav = [
        await navigateFromLanding(browser, proxy.base, 'miniapp'),
        await navigateFromLanding(browser, proxy.base, 'desktop'),
      ];
    } catch (error) {
      startupError = (error as Error).message;
    }

    // A1e — the section is REACHED (owner navigation from the landing page, on
    // either shell) and RENDERS on a fresh deep link that was not redirected.
    results.push(await guardedCheck('A1e', COVERED.A1e, async () => {
      if (!deep) throw new Error(`the owner's browser never reached the section: ${startupError}`);
      if (deep.seen.hash !== '#/xmachines') {
        throw new Error(`a fresh deep link was redirected away from the section: location.hash=${JSON.stringify(deep.seen.hash)} (KNOWN_EXACT must accept /xmachines)`);
      }
      if (deep.seen.sectionCount === 0) {
        throw new Error(`no xmachines section rendered on a fresh #/xmachines load (tried ${SECTION_SEL}); body=${JSON.stringify(deep.seen.bodyText.slice(0, 200))}`);
      }
      if (/page not found/i.test(deep.seen.bodyText)) {
        throw new Error(`the router rendered its not-found surface for #/xmachines: ${JSON.stringify(deep.seen.bodyText.slice(0, 200))}`);
      }
      const reached = nav.filter((attempt) => attempt.hash === '#/xmachines' && attempt.sectionCount > 0);
      if (reached.length === 0) {
        throw new Error(`owner navigation cannot reach the section from the landing page on either shell — the deep link works but nothing in the app leads to it: ${JSON.stringify(nav)}`);
      }
    }));
  } finally {
    if (deep) await deep.close();
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('D14/D1', results, 1);
});

// ---------------------------------------------------------------------------
// D7 — the power controls compose ON that section: the owner presses Off on a
// lease-held machine and the section renders the EXACT reason the production
// normal-OFF route refused with, having really called it.
// Owns: D2e
// ---------------------------------------------------------------------------
test('test_d7_the_section_off_control_renders_the_exact_route_refusal_reason', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const results: boolean[] = [];
  const scratch = newScratch('off');
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let probe: { status: number; body: string } | null = null;
  let attempts: OffAttempt[] = [];
  let startupError = '';

  try {
    try {
      server = await startServer(scratch);
      proxy = await startProxy(server.port);

      // Ambiguity 2: ask the PRODUCTION route what it refuses with, so "exact"
      // is measured against the route and not against a literal from the plan.
      const response = await request.post(
        `${proxy.base}/api/xmachines/machines/${QUARTZ}/power/off`,
        {
          headers: {
            authorization: `Bearer ${OWNER_TOKEN}`,
            'idempotency-key': 'd14-probe-1',
            origin: CANONICAL_ORIGIN,
            'content-type': 'application/json',
          },
          data: {},
          timeout: 30_000,
        },
      );
      probe = { status: response.status(), body: await response.text() };

      // Both views of the one section; either satisfies the row (ambiguity 5).
      attempts = [
        await pressOff(browser, proxy.base, `#/xmachines/${QUARTZ}`),
        await pressOff(browser, proxy.base, '#/xmachines'),
      ];
    } catch (error) {
      startupError = (error as Error).message;
    }

    const context = () => (server ? ` [server stderr: ${server.stderr().slice(-200)}]` : '');

    // D2e — the refusal reason is RENDERED, verbatim, on the section the owner
    // pressed Off on, and the page really asked the route for it.
    results.push(await guardedCheck('D2e', COVERED.D2e, async () => {
      if (!probe) throw new Error(`the normal-OFF route was never reached: ${startupError}${context()}`);

      // The route's own refusal, first: if this is not the lease refusal, the
      // journey has nothing exact to require of the UI and says so plainly.
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(probe.body) as Record<string, unknown>; } catch { parsed = {}; }
      if (probe.status !== 400 || parsed.status !== 'rejected' || parsed.reason !== EXPECTED_REASON || parsed.detail !== EXPECTED_DETAIL) {
        throw new Error(`the production normal-OFF route did not refuse the lease-held ${QUARTZ} with ${JSON.stringify({ status: 400, reason: EXPECTED_REASON, detail: EXPECTED_DETAIL })}; it answered HTTP ${probe.status} ${JSON.stringify(probe.body.slice(0, 300))} — without that refusal there is no exact reason for the section to render${context()}`);
      }

      const pressedAttempts = attempts.filter((attempt) => attempt.pressed);
      if (pressedAttempts.length === 0) {
        throw new Error(`the owner cannot press Off anywhere on the section, so the route's refusal (${JSON.stringify(EXPECTED_DETAIL)}) can never be rendered: ${JSON.stringify(attempts.map((a) => ({ hash: a.hash, controls: a.controls, error: a.error })))}${context()}`);
      }

      // Ambiguity 3: the rendered reason must appear on a page that really
      // called /power/off, and the reason must be the route's own text.
      const satisfying = pressedAttempts.filter((attempt) => {
        const calledRoute = attempt.posts.length > 0;
        const rendered = attempt.reasonNodes.some((text) => text.includes(EXPECTED_DETAIL))
          || attempt.bodyText.includes(EXPECTED_DETAIL);
        return calledRoute && rendered;
      });
      if (satisfying.length === 0) {
        throw new Error(`no view of the section rendered the route's exact refusal ${JSON.stringify(EXPECTED_DETAIL)} after the owner pressed Off: ${JSON.stringify(pressedAttempts.map((a) => ({
          hash: a.hash,
          offPosts: a.posts.map((p) => `${p.status} ${p.body.slice(0, 120)}`),
          reasonNodes: a.reasonNodes.slice(0, 4),
          body: a.bodyText.slice(0, 200),
        })))}${context()}`);
      }

      // A generic failure banner is not the reason: the machine and the holder
      // must both be legible to the owner who pressed the button.
      const legible = satisfying.filter((attempt) => attempt.bodyText.includes(QUARTZ) && attempt.bodyText.includes(LEASE_HOLDER));
      if (legible.length === 0) {
        throw new Error(`the refusal is rendered but names neither the machine (${QUARTZ}) nor the lease holder (${LEASE_HOLDER}) on the page: ${JSON.stringify(satisfying.map((a) => a.bodyText.slice(0, 200)))}`);
      }

      // Safety, not an acceptance id: a refused Off must have spawned nothing.
      // The lease gate returns before any child, so any gateway row here means
      // the journey actuated — which must fail loudly rather than pass quietly.
      const rows = argvRows(scratch.log);
      const spyLive = rows.some((row) => row[0] === 'ping' && row.includes(SELFTEST_MARKER));
      if (!spyLive) {
        throw new Error(`the gateway spy recorded no self-test row, so "nothing was actuated" would be vacuous — the spy was never on PATH (rows=${rows.length})${context()}`);
      }
      const forbidden = rows.filter((row) => isForbiddenGatewayCall(row) && !row.includes(SELFTEST_MARKER));
      if (forbidden.length !== 0) {
        throw new Error(`a REFUSED Off reached the gateway ${forbidden.length} time(s): ${JSON.stringify(forbidden.slice(0, 3))}`);
      }
    }));
  } finally {
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('D14/D7', results, 1);
});
