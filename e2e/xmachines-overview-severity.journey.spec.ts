import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E6 — INTEGRATION: the fake-fleet overview renders threshold severity,
// hysteresis, two-sample persistence, measured/estimated marks, sample age,
// provenance and stale treatment, all from the production read route.
// Contributor: D3 (severity chips, marks, age, provenance, stale treatment on
// overview values, using the configured thresholds).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E6 and
// implements none of it; it contains no product code. Measured today against
// the landed overview (src/web/public/xmachines-cost-view.js
// renderFleetOverview), a card prints name, state, temperature, watts, uptime,
// freshness, provenance-string, busy and leases — and NO severity chip, NO
// measured/approximate mark, NO sample-age field and NO stale treatment. Every
// id below is therefore red for exactly one reason: D3 has not landed.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. This row has exactly ONE
// contributor, so there is exactly ONE per-contributor test and every REJECT
// line it emits names unit D3 — the fence can always requeue the one slice
// that owns the gap.
//   test_d3_...   B2a B2b B2c B2d B2e B2f B3a B3b L9a L9c L13a L13b L13c
//
// Attribution note (req-matrix.md): B2a-B2f originate on B11 (the alert
// evaluator) and B3a/B3b, L13a-L13c on B4, but on THIS fence they are asserted
// through the RENDERED overview, which is D3's own deliverable. An evaluator
// that computes the right severity while the card shows no chip is a D3 gap,
// and a chip that flips on the first sample or ignores the 3°C hysteresis band
// is a D3 gap too, because D3 is the slice that must render severity "using
// configured thresholds". L9a/L9c are the fake-fleet fence class asserted over
// the same render: the values and the marks must trace to the payload the page
// actually received, not to anything hardcoded in the view.
//
// PATH: as with E1, the journey spawns the real `createApiServer` in a child
// process against an xmac `status` fixture, a machines.conf fixture and a
// telemetry fixture, with a PATH gateway-spy installed and XMACHINES_ARM unset
// (the non-actuating FakeGateway, L10). The real fleet is never contacted and
// nothing can actuate. FENCE_ORIGIN is deliberately ignored: a fence reading a
// deployed origin could not move a temperature between samples, so hysteresis
// and persistence would be unobservable.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. No canonical DOM contract for a D3 severity chip exists yet, so a chip is
//     any of `[data-testid^="xmachines-severity"]`, `[data-severity]`,
//     `[data-level]`, `.xm-severity` or `.xm-chip`, and its value is read from
//     the attribute or the text. Likewise a measured/estimated MARK is any of
//     `[data-testid$="-mark"]`, `[data-measurement]`, `[data-provenance-kind]`
//     or `.xm-mark`, and a sample age any of
//     `[data-testid$="sample-age"]`, `[data-sample-age]` or `.xm-sample-age`.
//     That broadens WHERE the evidence may appear; it does not weaken WHAT must
//     be true (the exact severity word, per named machine, per fixture value).
//  2. B2e/B2f are asserted on the card's overall severity of a machine whose
//     GPU temperature is deliberately normal (50°C / 52°C), so the only thing
//     that can raise its chip is the CPU reading. A CPU-specific chip would
//     satisfy it too; the journey does not prescribe which surface carries it.
//  3. B2c/B2d have evidence class "mutation report" in the acceptance index.
//     Here they are mutated through the FIXTURE — the fence rewrites the
//     telemetry fixture between page loads while the same server process keeps
//     running — which is the only mutation an integration fence can perform
//     without touching product code. The per-sample state this requires must
//     therefore live outside the per-request ReadOnlyCollector; that is a D3
//     design consequence, not an assertion this journey makes.
//  4. The two-sample rule (B2d) is observed across page loads, one telemetry
//     read per load. The journey MEASURES how many payloads each load actually
//     produced instead of assuming one: the "first sample must not flip the
//     chip" half is asserted only on a load that really did contribute a single
//     sample, and the "second sample must flip it" half is asserted
//     unconditionally. A view that polls twice per mount therefore cannot make
//     this id red for a reason that is not D3's.
//  5. L13c ("grayed or cleared rather than shown healthy") is read as a
//     disjunction and asserted as one: the expired machine's card must carry an
//     explicit stale/expired treatment, AND its live values must either be
//     cleared or be visibly de-emphasised (class/style/attribute/aria naming
//     stale, expired, gray, dim or muted). A card that still prints 88°C in
//     healthy styling fails; a card that prints nothing but `stale` passes.
//  6. The owner session is a stub authService inside the scratch server (the
//     C1 read-route suite's pattern), and the browser reaches it through a
//     tunnel-shaped reverse proxy that sets x-forwarded-host/proto — the exact
//     header shape Cloudflare delivers in production and what the route's
//     hostFromRequest() reads first. It relaxes no check; A2c owns the auth
//     matrix and is asserted elsewhere.
//  7. BASELINE NOTE, recorded rather than engineered away and MEASURED by
//     running this journey: 11 of the 13 ids are red today. The two that are
//     already green are L13b (the current renderer prints
//     `[data-testid="xmachines-provenance"]`) and L9a (the card's temperature
//     and watts already trace to the payload). Both are asserted here at full
//     strength anyway — the fixture's own provenance literal and the payload's
//     own numbers, per named machine — because this fence is where they must
//     keep being true once D3 re-renders every value with a chip, a mark and an
//     age. D3 does not have to turn them red-to-green; it has to not break
//     them, and the contract's negative control (FENCE_STUB=D3 --expect-red
//     B2a) discriminates D3 through an id that IS red today.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E6';
const ACCEPTANCE_IDS = [
  'B2a', 'B2b', 'B2c', 'B2d', 'B2e', 'B2f', 'B3a', 'B3b',
  'L9a', 'L9c', 'L13a', 'L13b', 'L13c',
];
// id -> the contributor blamed when it rejects. Exactly one unit on this row.
const COVERED: Record<string, string> = {
  B2a: 'D3', B2b: 'D3', B2c: 'D3', B2d: 'D3', B2e: 'D3', B2f: 'D3',
  B3a: 'D3', B3b: 'D3',
  L9a: 'D3', L9c: 'D3', L13a: 'D3', L13b: 'D3', L13c: 'D3',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'e6-fence-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const WAKE_VERBS = ['up', 'run', 'claim', 'release', 'wake'];
const SELFTEST_MARKER = 'e6-spy-selftest';

// The configured thresholds this fence holds the render to (B11's contract):
// GPU warn 80 / crit 90 with a 3°C hysteresis band, CPU warn 85 / crit 95, and
// a severity change only after the reading persists for two samples.
const GPU_WARN = 80;
const GPU_CRIT = 90;
const GPU_HYST = 3;
const HYST_HOLD_TEMP = GPU_CRIT - (GPU_HYST - 1); // 88 — inside the band, must HOLD critical
const HYST_CLEAR_TEMP = GPU_CRIT - GPU_HYST - 1;  // 86 — through the band, must CLEAR
const CPU_WARN = 85;
const CPU_CRIT = 95;

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media, signal, glimmer) so no assertion here can accidentally be
// satisfied by, or aimed at, a real box.
const EMBER = 'e6-ember';    // GPU 80°C  -> warning            (B2a, B3a measured watts)
const FLARE = 'e6-flare';    // GPU 90°C  -> critical, then 88, then 86 (B2b, B2c)
const CINDER = 'e6-cinder';  // CPU 85°C, GPU normal -> warning (B2e)
const MAGMA = 'e6-magma';    // CPU 95°C, GPU normal -> critical (B2f)
const CREEP = 'e6-creep';    // GPU 70 -> 80 across samples      (B2d)
const MIST = 'e6-mist';      // no measured watts -> estimated   (B3b)
const RELIC = 'e6-relic';    // sample age 900s -> expired       (L13c)

const FLEET = [EMBER, FLARE, CINDER, MAGMA, CREEP, MIST, RELIC];
// Machines whose reading is inside the freshness window; every one of them owes
// a sample age and a provenance (L13a/L13b).
const FRESH_FLEET = [EMBER, FLARE, CINDER, MAGMA, CREEP, MIST];
const PROVENANCE = 'collector-cli';
const SAMPLE_AGE: Record<string, string> = {
  [EMBER]: '30s', [FLARE]: '25s', [CINDER]: '20s',
  [MAGMA]: '15s', [CREEP]: '12s', [MIST]: '18s', [RELIC]: '900s',
};

const CARD_SEL = [
  '[data-testid="xmachines-fleet-card"]',
  '[data-testid^="xmachines-machine-card"]',
  '[data-testid="xmachines-fleet-overview"] li',
  '.xm-fleet li',
].join(', ');
const SEVERITY_SEL = [
  '[data-testid^="xmachines-severity"]',
  '[data-testid$="-severity"]',
  '[data-severity]',
  '[data-level]',
  '.xm-severity',
  '.xm-chip',
].join(', ');
const MARK_SEL = [
  '[data-testid$="-mark"]',
  '[data-testid^="xmachines-measurement"]',
  '[data-measurement]',
  '[data-provenance-kind]',
  '.xm-mark',
].join(', ');
const AGE_SEL = [
  '[data-testid$="sample-age"]',
  '[data-sample-age]',
  '.xm-sample-age',
].join(', ');
const PROV_SEL = [
  '[data-testid="xmachines-provenance"]',
  '[data-testid$="-provenance"]',
  '[data-provenance]',
  '.xm-provenance',
].join(', ');
const STALE_SEL = [
  '[data-testid$="stale"]',
  '[data-testid$="freshness"]',
  '[data-stale]',
  '[data-freshness]',
  '[data-expired]',
  '.xm-stale',
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
// Scratch fake fleet: xmac `status` text, machines.conf, a rewritable telemetry
// fixture and a PATH gateway-spy. Every path is under os.tmpdir(); the
// repository and the real ~/.config/agent-protocols/xmac are untouched.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  bin: string;
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

const OCTET: Record<string, string> = {
  [EMBER]: '60', [FLARE]: '61', [CINDER]: '62',
  [MAGMA]: '63', [CREEP]: '64', [MIST]: '65', [RELIC]: '66',
};

function statusLines(): string {
  return `${FLEET.map((name) => `${name}  192.0.2.${OCTET[name]}  UP  leases=()  compute`).join('\n')}\n`;
}

function confLines(): string {
  return `${FLEET.map((name) => `${name}|192.0.2.${OCTET[name]}|02:00:00:00:00:${OCTET[name]}|agjrom|compute|true`).join('\n')}\n`;
}

// The only thing that ever changes between samples: FLARE's GPU temperature
// (hysteresis) and CREEP's GPU temperature (two-sample persistence). Every
// other row is identical on every read, so nothing else can explain a chip
// that moves.
function metricsJson(flareTemp: number, creepTemp: number): string {
  return JSON.stringify({
    [EMBER]: {
      gpuTempsC: [GPU_WARN], gpuPowerWatts: [150], uptime: '5d 0h 1m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: SAMPLE_AGE[EMBER], cpuTemp: 45,
    },
    [FLARE]: {
      gpuTempsC: [flareTemp], gpuPowerWatts: [200], uptime: '2d 3h 4m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: SAMPLE_AGE[FLARE], cpuTemp: 46,
    },
    [CINDER]: {
      gpuTempsC: [50], gpuPowerWatts: [40], uptime: '1d 0h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: SAMPLE_AGE[CINDER], cpuTemp: CPU_WARN,
    },
    [MAGMA]: {
      gpuTempsC: [52], gpuPowerWatts: [45], uptime: '0d 6h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: SAMPLE_AGE[MAGMA], cpuTemp: CPU_CRIT,
    },
    [CREEP]: {
      gpuTempsC: [creepTemp], gpuPowerWatts: [60], uptime: '4d 2h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: SAMPLE_AGE[CREEP], cpuTemp: 40,
    },
    // No gpuPowerWatts at all: nothing measured its draw, so whatever the card
    // shows for power is necessarily an estimate (B3b).
    [MIST]: {
      gpuTempsC: [48], uptime: '3d 0h 0m',
      freshness: 'fresh', provenance: PROVENANCE, sampleAge: SAMPLE_AGE[MIST], cpuTemp: 39,
    },
    // UP in the registry, but its last reading is 15 minutes old — well past
    // the 300s freshness window (L13c).
    [RELIC]: {
      gpuTempsC: [88], gpuPowerWatts: [111], uptime: '9d 0h 0m',
      freshness: 'stale', provenance: PROVENANCE, sampleAge: SAMPLE_AGE[RELIC], cpuTemp: 44,
    },
  });
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e6-severity-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'argv.log');
  installSpies(bin, log);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statusPath, statusLines());
  fs.writeFileSync(confPath, confLines());
  fs.writeFileSync(metricsPath, metricsJson(GPU_CRIT, 70));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    E6_OWNER_TOKEN: OWNER_TOKEN,
  };
  // Non-actuating by default (L10): arming is process configuration, and this
  // fence must never be able to reach a real box.
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMAC_LOG;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  delete env.XMACHINES_USE_REGISTRY;
  return { dir, bin, log, statusPath, confPath, metricsPath, stateDir, env };
}

function writeMetrics(scratch: Scratch, flareTemp: number, creepTemp: number): void {
  fs.writeFileSync(scratch.metricsPath, metricsJson(flareTemp, creepTemp));
}

function argvRows(log: string): string[][] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => line.split('\t'));
}

function forbiddenGatewayCalls(log: string): string[][] {
  return argvRows(log).filter((row) => {
    if (row.includes(SELFTEST_MARKER)) return false;
    if (row[0] === 'xmac.sh' || row[0] === 'xmac' || row[0] === 'wakeonlan') return true;
    return row.some((token) => WAKE_VERBS.includes(token));
  });
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

const OWNER_TOKEN = process.env.E6_OWNER_TOKEN;
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
// Spy self-test BEFORE anything is served, so a later "no wake calls" reading
// is a real observation and not an artefact of a spy that was never on PATH.
// 'ping' is a read verb, never a wake verb.
spawnSync('ping', ['__SELFTEST__'], { encoding: 'utf8' });
console.log('E6-SERVER-READY ' + app.server.address().port);
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
    const match = out.match(/E6-SERVER-READY (\d+)/);
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

// ---------------------------------------------------------------------------
// The owner's browser: the Telegram mini-app shell at phone width, carrying an
// owner session, deep-linked to the overview. ONE page for the whole journey —
// each reload is one more telemetry sample, which is how hysteresis and
// two-sample persistence become observable at all.
// ---------------------------------------------------------------------------
type Card = {
  name: string;
  text: string;
  aria: string;
  temp: string | null;
  watts: string | null;
  uptime: string | null;
  state: string | null;
  severityTokens: string[];
  markTokens: string[];
  ageTokens: string[];
  provenanceTokens: string[];
  staleTokens: string[];
  valueStyleTokens: string[];
};

type PayloadRow = Record<string, unknown> & {
  name?: unknown;
  gpuTemp?: unknown;
  powerWatts?: unknown;
  telemetry?: { gpuTempMax?: number | null; powerWatts?: number | null; uptime?: string | null } | null;
};
type Payload = { armed?: boolean; mode?: string; machines?: PayloadRow[] };

type Snapshot = {
  cards: Card[];
  hash: string;
  bodyText: string;
  payload: Payload | null;
  samplesThisLoad: number;
  samplesTotal: number;
};

type Session = {
  context: import('@playwright/test').BrowserContext;
  page: import('@playwright/test').Page;
  payloads: Payload[];
  statuses: number[];
  loaded: boolean;
};

async function openSession(
  browser: import('@playwright/test').Browser,
  base: string,
): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const payloads: Payload[] = [];
  const statuses: number[] = [];
  page.on('response', async (response) => {
    if (!/\/api\/xmachines\/telemetry/.test(response.url())) return;
    statuses.push(response.status());
    try { payloads.push((await response.json()) as Payload); } catch { /* non-JSON body */ }
  });
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript((token) => {
    const w = window as unknown as { Telegram?: unknown };
    w.Telegram = {
      WebApp: {
        initData: 'e6-fence',
        ready() {}, expand() {}, disableVerticalSwipes() {},
        themeParams: {},
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { selectionChanged() {} },
      },
    };
    try {
      localStorage.setItem('agj_token', token as string);
      localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'owner', username: 'owner', role: 'owner' }));
    } catch { /* ignore */ }
  }, OWNER_TOKEN);
  return { context, page, payloads, statuses, loaded: false };
}

// One more read of the fleet, as the owner sees it. Returns how many telemetry
// payloads THIS load produced, so the two-sample rule is observed rather than
// assumed (ambiguity 4).
async function readOverview(session: Session, base: string): Promise<Snapshot> {
  const before = session.payloads.length;
  if (session.loaded) {
    await session.page.reload({ waitUntil: 'domcontentloaded' });
  } else {
    await session.page.goto(`${base}/index.html#/xmachines`, { waitUntil: 'domcontentloaded' });
    session.loaded = true;
  }
  // Give the cards their own chance to appear; a miss here is an assertion
  // failure below, not a thrown timeout.
  await session.page.waitForSelector(CARD_SEL, { timeout: 15_000 }).catch(() => {});
  await session.page.waitForTimeout(400);

  const cards: Card[] = await session.page.$$eval(
    CARD_SEL,
    (nodes, sel) => {
      const [severitySel, markSel, ageSel, provSel, staleSel] = sel as string[];
      const collect = (el: Element, selector: string): string[] => {
        const out: string[] = [];
        const seen = new Set<Element>();
        for (const found of Array.from(el.querySelectorAll(selector))) {
          if (seen.has(found)) continue;
          seen.add(found);
          for (const attr of Array.from(found.attributes)) {
            out.push(`${attr.name}=${attr.value}`);
          }
          out.push((found.textContent || '').trim());
        }
        // The card itself may carry the attribute rather than a child node.
        for (const attr of Array.from(el.attributes)) {
          if (selector.includes(`[${attr.name}]`)) out.push(`${attr.name}=${attr.value}`);
        }
        return out.filter((token) => token.length > 0);
      };
      const pick = (el: Element, selector: string): string | null => {
        const found = el.querySelector(selector);
        return found ? (found.textContent || '').trim() : null;
      };
      return nodes.map((el) => ({
        name: '',
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        aria: el.getAttribute('aria-label') || '',
        temp: pick(el, '[data-testid="xmachines-gpu-temp"]'),
        watts: pick(el, '[data-testid="xmachines-power-draw"]'),
        uptime: pick(el, '[data-testid="xmachines-uptime"]'),
        state: pick(el, '[data-testid="xmachines-power-state"], [data-testid="xmachines-state"]'),
        severityTokens: collect(el, severitySel),
        markTokens: collect(el, markSel),
        ageTokens: collect(el, ageSel),
        provenanceTokens: collect(el, provSel),
        staleTokens: collect(el, staleSel),
        // Everything that could carry a "grayed" treatment on the card itself
        // or on the VALUE nodes whose readings are expired — deliberately not
        // every descendant, so unrelated chrome (a role hint's own opacity)
        // cannot be mistaken for a stale treatment of the reading.
        valueStyleTokens: [
          el,
          ...Array.from(el.querySelectorAll('[data-testid="xmachines-gpu-temp"], [data-testid="xmachines-power-draw"], [data-testid="xmachines-uptime"]')),
        ].map((node) => Array.from(node.attributes)
          .map((attr) => `${attr.name}=${attr.value}`)
          .join(' '))
          .filter((token) => token.trim().length > 0),
      }));
    },
    [SEVERITY_SEL, MARK_SEL, AGE_SEL, PROV_SEL, STALE_SEL],
  );

  const hash = await session.page.evaluate(() => location.hash);
  const bodyText = ((await session.page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();
  return {
    cards,
    hash,
    bodyText,
    payload: session.payloads.length > 0 ? session.payloads[session.payloads.length - 1] : null,
    samplesThisLoad: session.payloads.length - before,
    samplesTotal: session.payloads.length,
  };
}

function cardFor(snapshot: Snapshot | null, name: string): Card | undefined {
  if (!snapshot) return undefined;
  return snapshot.cards.filter((card) => card.text.includes(name) || card.aria.includes(name))[0];
}

function rowFor(snapshot: Snapshot | null, name: string): PayloadRow | undefined {
  const rows = snapshot?.payload?.machines;
  if (!Array.isArray(rows)) return undefined;
  return rows.find((row) => String(row.name) === name);
}

// The severity the card actually claims, from the chip's attribute or its text.
// `null` means the card carries no severity at all — which is the honest
// reading of today's renderer and the reason these ids are red.
type Severity = 'critical' | 'warning' | 'normal';
function severityOf(card: Card | undefined): Severity | null {
  if (!card) return null;
  const blob = card.severityTokens.join(' ').toLowerCase();
  if (blob.length === 0) return null;
  if (/critical|crit\b|danger|alarm/.test(blob)) return 'critical';
  if (/warning|warn\b|caution|elevated/.test(blob)) return 'warning';
  if (/normal|nominal|healthy|\bok\b|\bgood\b/.test(blob)) return 'normal';
  return null;
}

function describeSeverity(card: Card | undefined, machine: string): string {
  if (!card) return `${machine} has no card at all`;
  if (card.severityTokens.length === 0) {
    return `${machine}'s card renders no severity chip (tried ${SEVERITY_SEL}); card text was ${JSON.stringify(card.text.slice(0, 160))}`;
  }
  return `${machine}'s severity tokens were ${JSON.stringify(card.severityTokens.slice(0, 8))}`;
}

const MEASURED_RE = /measured|meter(ed)?|direct|actual/i;
const ESTIMATED_RE = /estimat|approx|modelled|modeled|derived|~/i;

function marksMeasured(card: Card | undefined): boolean {
  if (!card) return false;
  const blob = card.markTokens.join(' ');
  return MEASURED_RE.test(blob) && !ESTIMATED_RE.test(blob);
}

function marksEstimated(card: Card | undefined): boolean {
  if (!card) return false;
  return ESTIMATED_RE.test(card.markTokens.join(' '));
}

function firstNumber(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

// ---------------------------------------------------------------------------
// Structural guard on the split itself: the per-contributor test(s) below must
// between them cover exactly the row's acceptance ids, each once, and name only
// this row's contributor.
// ---------------------------------------------------------------------------
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
  const units = new Set(Object.values(COVERED));
  if (units.size !== 1 || !units.has('D3')) {
    throw new Error(`fence ${FENCE_ID}: rejections must name exactly the 1 contributor D3, found ${JSON.stringify([...units])}`);
  }
});

// ---------------------------------------------------------------------------
// D3 — the overview renders, for every value it shows: threshold severity with
// the configured GPU/CPU bands, the 3°C hysteresis, the two-sample persistence
// rule, a measured-vs-estimated mark, the sample age, the provenance, and an
// expired reading treated as expired rather than healthy.
// Owns: B2a B2b B2c B2d B2e B2f B3a B3b L9a L9c L13a L13b L13c
// ---------------------------------------------------------------------------
test('test_d3_the_overview_renders_threshold_severity_marks_age_provenance_and_stale_treatment', async ({ browser }) => {
  test.setTimeout(165_000);
  const results: boolean[] = [];
  const scratch = newScratch();
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let session: Session | null = null;
  let startupError = '';

  // Phase A — the steady fleet, read twice so every severity has had the two
  // samples the persistence rule requires before any threshold id is judged.
  let steady: Snapshot | null = null;
  // Phase B — CREEP crosses the GPU warning threshold (B2d).
  let creepFirst: Snapshot | null = null;
  let creepSecond: Snapshot | null = null;
  // Phase C — FLARE falls INSIDE the hysteresis band, then THROUGH it (B2c).
  let hold: Snapshot | null = null;
  let cleared: Snapshot | null = null;

  try {
    try {
      server = await startServer(scratch);
      proxy = await startProxy(server.port);
      session = await openSession(browser, proxy.base);

      // Phase A: two reads of the unchanged fixture.
      await readOverview(session, proxy.base);
      steady = await readOverview(session, proxy.base);

      // Phase B: CREEP rises from 70°C to the warning threshold. Nothing else
      // in the fixture moves, and the server process is not restarted.
      writeMetrics(scratch, GPU_CRIT, GPU_WARN);
      creepFirst = await readOverview(session, proxy.base);
      creepSecond = await readOverview(session, proxy.base);

      // Phase C: FLARE, already critical, falls to 88°C — inside the 3°C band,
      // so the chip must HOLD critical even after two samples there...
      writeMetrics(scratch, HYST_HOLD_TEMP, GPU_WARN);
      await readOverview(session, proxy.base);
      hold = await readOverview(session, proxy.base);
      // ...and then to 86°C, through the band, where it must finally clear.
      writeMetrics(scratch, HYST_CLEAR_TEMP, GPU_WARN);
      await readOverview(session, proxy.base);
      cleared = await readOverview(session, proxy.base);
    } catch (error) {
      startupError = (error as Error).message;
    }

    const context = () => {
      if (startupError) return ` [startup: ${startupError}]`;
      const status = session?.statuses.length
        ? ` [telemetry HTTP ${session.statuses.join(',')}]`
        : ' [the page never called /api/xmachines/telemetry]';
      const spy = forbiddenGatewayCalls(scratch.log);
      const spyNote = spy.length ? ` [WARNING: ${spy.length} gateway call(s) were made: ${JSON.stringify(spy.slice(0, 2))}]` : '';
      return `${status}${spyNote}${server ? ` [server stderr: ${server.stderr().slice(-200)}]` : ''}`;
    };
    const needSteady = (): Snapshot => {
      if (!steady) throw new Error(`the overview never rendered${context()}`);
      return steady;
    };

    // B2a — a GPU sample at the configured warning threshold (80°C) renders
    // WARNING severity on that machine's card. Not merely "some severity":
    // 80°C is below the 90°C critical threshold, so critical is wrong too.
    results.push(await guardedCheck('B2a', COVERED.B2a, async () => {
      const snap = needSteady();
      const card = cardFor(snap, EMBER);
      const severity = severityOf(card);
      if (severity !== 'warning') {
        throw new Error(`${EMBER} reads ${GPU_WARN}°C, the configured GPU warning threshold, but its card renders severity ${JSON.stringify(severity)} — ${describeSeverity(card, EMBER)}${context()}`);
      }
    }));

    // B2b — a GPU sample at the configured critical threshold (90°C) renders
    // CRITICAL severity, not merely warning.
    results.push(await guardedCheck('B2b', COVERED.B2b, async () => {
      const snap = needSteady();
      const card = cardFor(snap, FLARE);
      const severity = severityOf(card);
      if (severity !== 'critical') {
        throw new Error(`${FLARE} reads ${GPU_CRIT}°C, the configured GPU critical threshold, but its card renders severity ${JSON.stringify(severity)} — ${describeSeverity(card, FLARE)}${context()}`);
      }
    }));

    // B2c — hysteresis: a critical machine that falls to 88°C is still inside
    // the 3°C band and must HOLD critical; only once it falls through the band
    // (86°C) may the chip clear. A renderer that simply re-reads the threshold
    // each sample fails the first half; one that latches forever fails the
    // second.
    results.push(await guardedCheck('B2c', COVERED.B2c, async () => {
      if (!hold || !cleared) throw new Error(`the overview never re-rendered across the hysteresis band${context()}`);
      const wasCritical = severityOf(cardFor(steady, FLARE));
      if (wasCritical !== 'critical') {
        throw new Error(`${FLARE} was not critical before the temperature fell, so hysteresis cannot be observed — ${describeSeverity(cardFor(steady, FLARE), FLARE)}${context()}`);
      }
      const held = severityOf(cardFor(hold, FLARE));
      if (held !== 'critical') {
        throw new Error(`${FLARE} fell from ${GPU_CRIT}°C to ${HYST_HOLD_TEMP}°C — inside the configured ${GPU_HYST}°C hysteresis band — but its severity already dropped to ${JSON.stringify(held)}; it must hold critical until the reading falls through the band`);
      }
      const after = severityOf(cardFor(cleared, FLARE));
      if (after === 'critical') {
        throw new Error(`${FLARE} fell to ${HYST_CLEAR_TEMP}°C, through the ${GPU_HYST}°C band below the ${GPU_CRIT}°C threshold, but its card is still critical; hysteresis holds a severity, it does not latch it forever`);
      }
      if (after !== 'warning') {
        throw new Error(`${FLARE} at ${HYST_CLEAR_TEMP}°C is above the ${GPU_WARN}°C warning threshold, so its card must read warning once critical clears, not ${JSON.stringify(after)} — ${describeSeverity(cardFor(cleared, FLARE), FLARE)}`);
      }
    }));

    // B2d — two-sample persistence: a machine crossing into warning must not
    // flip on the first sample that crosses. Asserted against the measured
    // sample count, so a view that polls more than once per load cannot make
    // this red for a reason that is not D3's (ambiguity 4).
    results.push(await guardedCheck('B2d', COVERED.B2d, async () => {
      if (!creepFirst || !creepSecond) throw new Error(`the overview never re-rendered after ${CREEP} crossed the threshold${context()}`);
      const before = severityOf(cardFor(steady, CREEP));
      if (before !== 'normal') {
        throw new Error(`${CREEP} reads 70°C, below every configured threshold, but its card renders ${JSON.stringify(before)} instead of normal — ${describeSeverity(cardFor(steady, CREEP), CREEP)}${context()}`);
      }
      const afterOne = severityOf(cardFor(creepFirst, CREEP));
      if (creepFirst.samplesThisLoad === 1 && afterOne !== 'normal') {
        throw new Error(`${CREEP} crossed to ${GPU_WARN}°C and its card flipped to ${JSON.stringify(afterOne)} after a SINGLE sample; a severity change requires the reading to persist for two samples`);
      }
      const afterTwo = severityOf(cardFor(creepSecond, CREEP));
      if (afterTwo !== 'warning') {
        throw new Error(`${CREEP} has now read ${GPU_WARN}°C for ${creepFirst.samplesThisLoad + creepSecond.samplesThisLoad} consecutive samples but its card renders ${JSON.stringify(afterTwo)} instead of warning — a persisted threshold crossing must show`);
      }
    }));

    // B2e — a CPU sample at 85°C renders warning severity. This machine's GPU
    // is at 50°C, well below every GPU threshold, so the CPU reading is the
    // only thing that can raise its chip.
    results.push(await guardedCheck('B2e', COVERED.B2e, async () => {
      const snap = needSteady();
      const card = cardFor(snap, CINDER);
      const severity = severityOf(card);
      if (severity !== 'warning') {
        throw new Error(`${CINDER} reads CPU ${CPU_WARN}°C (GPU 50°C, normal) — the configured CPU warning threshold — but its card renders severity ${JSON.stringify(severity)} — ${describeSeverity(card, CINDER)}${context()}`);
      }
    }));

    // B2f — a CPU sample at 95°C renders critical severity, again with a normal
    // GPU (52°C) so the CPU reading is the only possible cause.
    results.push(await guardedCheck('B2f', COVERED.B2f, async () => {
      const snap = needSteady();
      const card = cardFor(snap, MAGMA);
      const severity = severityOf(card);
      if (severity !== 'critical') {
        throw new Error(`${MAGMA} reads CPU ${CPU_CRIT}°C (GPU 52°C, normal) — the configured CPU critical threshold — but its card renders severity ${JSON.stringify(severity)} — ${describeSeverity(card, MAGMA)}${context()}`);
      }
    }));

    // B3a — a measured value is visibly marked measured. EMBER's draw comes
    // from a real per-GPU wattage reading in the fixture.
    results.push(await guardedCheck('B3a', COVERED.B3a, async () => {
      const snap = needSteady();
      const card = cardFor(snap, EMBER);
      if (!card) throw new Error(`${EMBER} has no card at all${context()}`);
      if (card.markTokens.length === 0) {
        throw new Error(`${EMBER}'s power draw is a measured reading (150 W from the GPU sensor) but its card carries no measurement mark at all (tried ${MARK_SEL}); card text was ${JSON.stringify(card.text.slice(0, 160))}${context()}`);
      }
      if (!marksMeasured(card)) {
        throw new Error(`${EMBER}'s measured power draw is not marked measured — mark tokens were ${JSON.stringify(card.markTokens.slice(0, 8))}`);
      }
    }));

    // B3b — an estimated value is visibly marked approximate. MIST has NO
    // measured wattage in the fixture at all, so whatever number its card shows
    // for power is necessarily derived.
    results.push(await guardedCheck('B3b', COVERED.B3b, async () => {
      const snap = needSteady();
      const card = cardFor(snap, MIST);
      if (!card) throw new Error(`${MIST} has no card at all${context()}`);
      if (card.markTokens.length === 0) {
        throw new Error(`${MIST} has no measured wattage in the fixture, so its power is an estimate, but its card carries no measurement mark at all (tried ${MARK_SEL}); card text was ${JSON.stringify(card.text.slice(0, 160))}${context()}`);
      }
      if (!marksEstimated(card)) {
        throw new Error(`${MIST}'s estimated power draw is not marked approximate — mark tokens were ${JSON.stringify(card.markTokens.slice(0, 8))}`);
      }
    }));

    // L9a — the rendered telemetry values are the fake fleet's values: the
    // numbers on a card trace to the payload the page actually received, and
    // the payload is the non-actuating fake mode.
    results.push(await guardedCheck('L9a', COVERED.L9a, async () => {
      const snap = needSteady();
      if (!snap.payload) {
        throw new Error(`the page received no /api/xmachines/telemetry payload, so no rendered value can be traced to the fake fleet${context()}`);
      }
      if (snap.payload.armed === true || snap.payload.mode === 'armed') {
        throw new Error(`the read route reported an ARMED runtime (mode=${snap.payload.mode}); a fake-fleet fence must run against the non-actuating gateway`);
      }
      const payloadNames = (snap.payload.machines || []).map((row) => String(row.name));
      if (JSON.stringify(payloadNames) !== JSON.stringify(FLEET)) {
        throw new Error(`the payload fleet ${JSON.stringify(payloadNames)} is not the status fixture's ${JSON.stringify(FLEET)}`);
      }
      for (const name of [EMBER, FLARE, CINDER, MAGMA]) {
        const row = rowFor(snap, name);
        const card = cardFor(snap, name);
        if (!card) throw new Error(`${name} is in the payload but has no card${context()}`);
        const renderedTemp = firstNumber(card.temp ?? card.text);
        if (renderedTemp !== Number(row?.gpuTemp)) {
          throw new Error(`${name}: the card renders GPU temperature ${JSON.stringify(card.temp)} (parsed ${renderedTemp}) but the payload it was rendered from says ${JSON.stringify(row?.gpuTemp)}`);
        }
        const renderedWatts = firstNumber(card.watts);
        if (renderedWatts !== Number(row?.powerWatts)) {
          throw new Error(`${name}: the card renders power ${JSON.stringify(card.watts)} (parsed ${renderedWatts}) but the payload says ${JSON.stringify(row?.powerWatts)}`);
        }
      }
    }));

    // L9c — the measured/estimated marks trace to the payload too: the mark
    // follows whether that machine's reading was actually measured, rather than
    // being a constant the view prints on every card.
    results.push(await guardedCheck('L9c', COVERED.L9c, async () => {
      const snap = needSteady();
      if (!snap.payload) {
        throw new Error(`the page received no telemetry payload, so no mark can be traced to it${context()}`);
      }
      const measuredRow = rowFor(snap, EMBER);
      const estimatedRow = rowFor(snap, MIST);
      if (typeof measuredRow?.telemetry?.powerWatts !== 'number') {
        throw new Error(`${EMBER} should carry a measured power reading in the payload, got ${JSON.stringify(measuredRow?.telemetry ?? null)} — the fixture, not the render, is wrong`);
      }
      if (estimatedRow?.telemetry?.powerWatts != null) {
        throw new Error(`${MIST} should carry NO measured power reading in the payload, got ${JSON.stringify(estimatedRow?.telemetry ?? null)} — the fixture, not the render, is wrong`);
      }
      const measuredCard = cardFor(snap, EMBER);
      const estimatedCard = cardFor(snap, MIST);
      if (!marksMeasured(measuredCard) || !marksEstimated(estimatedCard)) {
        throw new Error(`the marks do not follow the payload: ${EMBER} (measured in the payload) marks ${JSON.stringify(measuredCard?.markTokens.slice(0, 6) ?? null)} and ${MIST} (unmeasured in the payload) marks ${JSON.stringify(estimatedCard?.markTokens.slice(0, 6) ?? null)}${context()}`);
      }
      const sameMark = JSON.stringify(measuredCard?.markTokens) === JSON.stringify(estimatedCard?.markTokens);
      if (sameMark) {
        throw new Error(`${EMBER} and ${MIST} render the SAME measurement mark ${JSON.stringify(measuredCard?.markTokens.slice(0, 6))} although only one of them has a measured reading; a mark that never varies proves nothing`);
      }
    }));

    // L13a — every live value renders its sample age, as the fixture's literal.
    results.push(await guardedCheck('L13a', COVERED.L13a, async () => {
      const snap = needSteady();
      const missing: string[] = [];
      for (const name of FRESH_FLEET) {
        const card = cardFor(snap, name);
        const blob = card ? card.ageTokens.join(' ') : '';
        if (!card || !blob.includes(SAMPLE_AGE[name])) {
          missing.push(`${name}: expected sample age ${SAMPLE_AGE[name]}, age tokens were ${JSON.stringify(card ? card.ageTokens.slice(0, 6) : null)}`);
        }
      }
      if (missing.length > 0) {
        throw new Error(`${missing.length} of ${FRESH_FLEET.length} live machines render no sample age (tried ${AGE_SEL}) — ${JSON.stringify(missing.slice(0, 3))}${context()}`);
      }
    }));

    // L13b — every live value renders its provenance, as the fixture's literal
    // rather than a hardcoded word.
    results.push(await guardedCheck('L13b', COVERED.L13b, async () => {
      const snap = needSteady();
      const missing: string[] = [];
      for (const name of FRESH_FLEET) {
        const card = cardFor(snap, name);
        const blob = card ? card.provenanceTokens.join(' ') : '';
        if (!card || !blob.includes(PROVENANCE)) {
          missing.push(`${name}: expected provenance ${PROVENANCE}, provenance tokens were ${JSON.stringify(card ? card.provenanceTokens.slice(0, 6) : null)}`);
        }
      }
      if (missing.length > 0) {
        throw new Error(`${missing.length} of ${FRESH_FLEET.length} live machines render no provenance (tried ${PROV_SEL}) — ${JSON.stringify(missing.slice(0, 3))}${context()}`);
      }
    }));

    // L13c — an expired reading (900s old, far past the 300s freshness window)
    // is grayed or cleared rather than shown healthy: the card must say so, and
    // any value it still prints must be visibly de-emphasised (ambiguity 5).
    results.push(await guardedCheck('L13c', COVERED.L13c, async () => {
      const snap = needSteady();
      const card = cardFor(snap, RELIC);
      if (!card) throw new Error(`${RELIC} has no card at all${context()}`);
      const staleBlob = `${card.staleTokens.join(' ')} ${card.aria}`.toLowerCase();
      if (!/stale|expired|outdated|unknown/.test(staleBlob)) {
        throw new Error(`${RELIC}'s reading is ${SAMPLE_AGE[RELIC]} old — past the 300s freshness window — but its card carries no stale/expired treatment (tried ${STALE_SEL}); tokens were ${JSON.stringify(card.staleTokens.slice(0, 8))} and the card read ${JSON.stringify(card.text.slice(0, 160))}${context()}`);
      }
      const stillShowsValues = Boolean((card.temp && card.temp.trim() !== '') || (card.watts && card.watts.trim() !== ''));
      if (stillShowsValues) {
        const deemphasised = /stale|expired|gray|grey|dim|muted|faded|opacity/i.test(card.valueStyleTokens.join(' '));
        if (!deemphasised) {
          throw new Error(`${RELIC} still prints its expired readings (temp=${JSON.stringify(card.temp)} watts=${JSON.stringify(card.watts)}) in healthy styling; an expired value must be grayed or cleared, not shown as if live — the card's and the value nodes' own attributes were ${JSON.stringify(card.valueStyleTokens.slice(0, 4))}`);
        }
      }
      if (severityOf(card) === 'normal' && !stillShowsValues) {
        throw new Error(`${RELIC}'s expired reading renders a healthy 'normal' severity with no values behind it; an expired sample cannot be reported as normal`);
      }
    }));
  } finally {
    if (session) await session.context.close();
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('E6/D3', results, 13);
});
