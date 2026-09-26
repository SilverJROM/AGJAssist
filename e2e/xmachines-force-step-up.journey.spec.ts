import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E8 — INTEGRATION: an owner force journey on a fake fleet captures the
// PRODUCTION Telegram sender's actual outbound number-match update, binds that
// challenge to one session / one machine / one action, consumes it exactly
// once, renders the live process-and-lease probe text, and lets `xmac.sh down
// --force` reach the gateway only through the consumed challenge (C5). A
// mocked dialog inside the page, or an argv row with no host movement, is a
// FAILING proof, not a pass.
//
// Contributor: D8 alone — "render the separate force flow with live-probe
// confirmation text and number match; the runner must capture the production
// Telegram sender's actual outbound update and reject mocked-dialog-only
// evidence". Its path transitively contains C8 (force HTTP contract), A3 (the
// challenge service) and C5 (the routes), which is why one contributor carries
// the whole row.
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E8 and
// implements none of it; it contains no product code. It is red today because
// D8 has not landed:
//   * `src/web/public/xmachines-cost-view.js` renders a detail section, a
//     normal Off button and a normal-Off refusal block, and NOTHING ELSE. It
//     has no force control, no number-match surface, no confirmation text and
//     no consume path — grep the file for `force`: the only hits are inside
//     `renderNormalOffRefusal`. `POST /api/xmachines/machines/:name/power/force`
//     therefore has no product caller at all.
//   * The force route (`powerForce`) never calls `deliverForceNumberMatch`,
//     the production Telegram sender that the normal-Off step-up path already
//     uses, so issuing a force challenge emits ZERO outbound updates and the
//     capture server below records nothing. `e2e/run-xmachines-force-ui.mjs`
//     (D8's own command) does not exist either.
// Every acceptance id on this row is asserted through that missing surface, so
// every one of them is red for that ONE reason and green the moment D8 lands.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. This row has exactly one
// contributor, so there is exactly one such test and every rejection names D8:
//   test_d8_...  D3a D3b L3a L3b L3c L3d L3e L3f L3g L3h L6h L9b L9d L9e L15b
// A single distinct unit appears across every rejection, so a red report stays
// `missing_acceptance` and never trips the J1c >2-unit plan_defect rule. The
// contract's negative control (FENCE_STUB=D8 --expect-red L3b) discriminates
// D8 through L3b — the captured Telegram update — which is why L3b is asserted
// over the capture server rather than over anything the page could fake.
//
// THE FAKE FLEET IS THIS JOURNEY'S OWN SERVER, NOT THE DEPLOYED APP. The
// journey spawns the real `createApiServer` in a child process against an xmac
// `status` fixture, a machines.conf fixture, a protected-role fixture, an
// XMAC_LOG WoL fixture, a force-probe fixture and a PATH gateway-spy that IS
// the fake host: the spy records every argv AND mutates the status fixture, so
// UP-to-STOPPING-to-DOWN is an observed host-state change and not a claim about
// a mock. Every fixture address is in TEST-NET-1 (192.0.2.0/24), so no real box
// can be addressed. api.telegram.org is likewise replaced by a local capture
// server through the sender's own TELEGRAM_API_BASE override, so the update the
// journey reads is the one the production sender really put on the wire.
// FENCE_ORIGIN is deliberately ignored: a fence that read a deployed origin
// could not arm the runtime, install a spy, or author probe and role fixtures,
// so nothing on this row would be observable.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. XMACHINES_ARM=1. The power routes answer 403 `unarmed` otherwise, so an
//     unarmed E8 could not observe a single id. Arming here reaches the PATH
//     spy on a TEST-NET address, never a machine — the A0.3 boundary is what
//     makes that safe, and the C5 route suite arms the same way.
//  2. WHERE THE NUMBER IS TAPPED. The production sender's prompt is "tap the
//     number shown on your screen" with an inline keyboard, i.e. the number is
//     rendered by the web surface and the owner may answer in Telegram; the
//     route also accepts `{challengeId, selectedNumber}` on the force POST. The
//     journey therefore does not prescribe WHICH consume control D8 renders: it
//     accepts a pressable element whose text is the route's own displayNumber,
//     or a force-confirm control, and fails only when NO web control can
//     consume the challenge at all. What it does not relax is that the consume
//     must come from the product surface and must carry the challenge the
//     product flow itself issued.
//  3. No canonical DOM contract for D8 exists yet, so the force control, the
//     challenge block, the confirmation text and the force refusal are each
//     looked for across an alias set (testids, data-attributes and an
//     accessible-text fallback inside the detail section). That broadens WHERE
//     the evidence may appear; it does not weaken WHAT must be true — a
//     rendered refusal is compared for EQUALITY against the string the route
//     returned in the SAME exchange, so the journey never invents copy.
//  4. THE BINDING VIOLATIONS (L3e session, L3f machine, L3g action) are
//     replayed from the page's OWN session and origin rather than clicked,
//     because no correct force UI would ever offer a wrong-machine or
//     wrong-action button. The challenge under replay is always one the
//     PRODUCT FLOW issued through D8's rendered control, so these ids stay
//     D8-attributable: with no rendered flow there is no challenge to bind.
//  5. L3d EXPIRY. The challenge TTL is a hardcoded 60s and no fixture moves the
//     server clock, so the expiring specimen's challenge is opened in the FIRST
//     phase and confirmed in the LAST one; the journey waits only for whatever
//     of the 60s the rest of the fence did not already spend (hard-capped, so
//     the row cannot blow the runner's 170s spawn budget). The service prunes
//     expired challenges on the next startChallenge, so the refusal reason is
//     accepted as either `expired` or `unknown-challenge` — what is asserted at
//     full strength is that the window the route itself published is <= 60s,
//     that the late confirm is REFUSED and rendered as refused, and that no
//     `--force` ever reaches the gateway for that machine.
//  6. Three owner identities (ids 1/2/3, three tokens on the same stub
//     authService) spread the specimens across the route's per-owner power rate
//     limit, and give L3e a genuinely second web session. The limit itself is
//     A6's and is asserted on E11, not here.
//  7. BASELINE NOTE, recorded rather than engineered away: the never-verified
//     normal-Off refusal that C4 already renders is one of the three distinct
//     rendered refusal strings L9b counts. It is not sufficient on its own —
//     L9b additionally requires at least two distinct rendered refusals from
//     the FORCE surface, which is D8's own and renders nothing today.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E8';
const ACCEPTANCE_IDS = [
  'D3a', 'D3b',
  'L3a', 'L3b', 'L3c', 'L3d', 'L3e', 'L3f', 'L3g', 'L3h',
  'L6h', 'L9b', 'L9d', 'L9e', 'L15b',
];
// id -> the contributor blamed when it rejects. Exactly one distinct unit.
const COVERED: Record<string, string> = {
  D3a: 'D8', D3b: 'D8',
  L3a: 'D8', L3b: 'D8', L3c: 'D8', L3d: 'D8', L3e: 'D8', L3f: 'D8', L3g: 'D8', L3h: 'D8',
  L6h: 'D8', L9b: 'D8', L9d: 'D8', L9e: 'D8', L15b: 'D8',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const SELFTEST_MARKER = 'e8-spy-selftest';

// Three owner sessions on the same stub authService, plus one non-owner.
const OWNERS = {
  one: { token: 'e8-fence-owner-1', id: 1 },
  two: { token: 'e8-fence-owner-2', id: 2 },
  three: { token: 'e8-fence-owner-3', id: 3 },
} as const;
const NON_OWNER = { token: 'e8-fence-viewer-4', id: 4 };

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media, signal, glimmer) so no assertion here can be aimed at, or
// accidentally satisfied by, a real box. Every address is TEST-NET-1.
const FORGE = 'e8-forge';     // UP, verified, idle  -> the consumed force
const WARDEN = 'e8-warden';   // .174 while signal is live -> protected refusal
const LATCH = 'e8-latch';     // UP, never-verified  -> action-binding + step-up
const KEEL = 'e8-keel';       // UP -> session binding
const PIVOT = 'e8-pivot';     // UP -> machine binding (challenge source)
const BOLT = 'e8-bolt';       // UP -> machine binding (replay target), keyless
const TALLY = 'e8-tally';     // UP -> the expiring challenge

const FORGE_PROCESSES = 'pid 4821 render-worker (agjrom) 41m';
const FORGE_LEASES = '1 active lease';
const FORGE_HOLDER = 'xmac-claim-e8-forge-render';

type Row = { name: string; ip: string; state: 'UP' | 'DOWN'; role: string };
const FLEET: Row[] = [
  { name: FORGE, ip: '192.0.2.60', state: 'UP', role: 'compute' },
  { name: LATCH, ip: '192.0.2.61', state: 'UP', role: 'media' },
  { name: KEEL, ip: '192.0.2.62', state: 'UP', role: 'compute' },
  { name: PIVOT, ip: '192.0.2.63', state: 'UP', role: 'compute' },
  { name: BOLT, ip: '192.0.2.64', state: 'UP', role: 'compute' },
  { name: TALLY, ip: '192.0.2.65', state: 'UP', role: 'compute' },
  { name: WARDEN, ip: '192.0.2.174', state: 'UP', role: 'signal' },
];

const CHALLENGE_TTL_MS = 60_000;

// Control and refusal surfaces. Alias sets, not a prescribed DOM (ambiguity 3).
const DETAIL_SEL = '[data-testid="xmachines-machine-detail"], .xm-detail, .xmachines-view';
const OFF_SEL = [
  '[data-testid="xmachines-off-button"]',
  '[data-testid="xmachines-power-off"]',
  '[data-action="power-off"]',
  'button[data-power="off"]',
].join(', ');
const FORCE_SEL = [
  '[data-testid="xmachines-force-button"]',
  '[data-testid="xmachines-force-off-button"]',
  '[data-testid="xmachines-power-force"]',
  '[data-testid="xmachines-force-power-off"]',
  '[data-action="power-force"]',
  'button[data-power="force"]',
].join(', ');
const CHALLENGE_SEL = [
  '[data-testid="xmachines-force-challenge"]',
  '[data-testid="xmachines-number-match"]',
  '[data-testid="xmachines-force-number"]',
  '[data-testid="xmachines-challenge"]',
  '[data-challenge]',
].join(', ');
const CONFIRMATION_SEL = [
  '[data-testid="xmachines-force-confirmation"]',
  '[data-testid="xmachines-force-probe"]',
  '[data-testid="xmachines-force-confirmation-text"]',
].join(', ');
const CONFIRM_SEL = [
  '[data-testid="xmachines-force-confirm"]',
  '[data-testid="xmachines-force-confirm-button"]',
  '[data-testid="xmachines-number-match-confirm"]',
  '[data-action="force-confirm"]',
].join(', ');
const REFUSAL_SEL = [
  '[data-testid="xmachines-force-refusal"]',
  '[data-testid="xmachines-force-refusal-reason"]',
  '[data-testid="xmachines-off-refusal"]',
  '[data-testid="xmachines-off-refusal-reason"]',
  '[data-testid="xmachines-power-refusal"]',
  '[data-testid="xmachines-refusal"]',
  '[role="alert"]',
].join(', ');
const STATE_SEL = [
  '[data-testid="xmachines-power-state"]',
  '[data-testid="xmachines-state"]',
].join(', ');

const FORCE_TEXT = /^(force|force off|force power off|force shutdown|full force)$/i;
const OFF_TEXT = /^(turn off|power off|off|shut ?down)$/i;
const CONFIRM_TEXT = /^(confirm|confirm force|confirm number|confirm force off|match)$/i;

function finish(fenceTest: string, results: boolean[], expected: number): void {
  if (results.length !== expected) {
    throw new Error(`${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  }
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// ---------------------------------------------------------------------------
// The scratch fake fleet. Everything is under os.tmpdir(); the repository, the
// real ~/.config/agent-protocols/xmac and the real ~/.xmac are untouched.
//
// `xmac.sh` here is BOTH the gateway-spy and the fake host: it records argv and
// then mutates the status fixture, so a force has an observable HOST-STATE
// consequence. That is what makes L9e's `via` honest — the journey reads the
// host's state back, it does not read a mock's argv and declare the machine off.
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
  probePath: string;
  protectedDir: string;
  transitions: string;
  env: NodeJS.ProcessEnv;
};

const RECORDING_SPIES = ['ping', 'wakeonlan', 'xmac', 'nvidia-smi', 'smartctl', 'upsc', 'sensors'];

// The command name is a literal baked into each spy script, not read from
// argv[0] at invocation time, so the recorded executable identity cannot be
// spoofed by how the child happened to be invoked (the A14/A15 pattern).
function installRecordingSpies(bin: string, log: string): void {
  for (const name of RECORDING_SPIES) {
    const body = `#!/bin/bash\nset -u\n{\n  printf '%s' ${JSON.stringify(name)}\n  printf '\\t%s' "\${XMAC_CALLER-}"\n  for arg in "$@"; do printf '\\t%s' "$arg"; done\n  printf '\\n'\n} >> ${JSON.stringify(log)}\nexit 0\n`;
    const file = path.join(bin, name);
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
}

// The gateway-spy that is also the fake host.
function gatewayScript(): string {
  return `#!/bin/bash
set -u
log="\${E8_SPY_LOG}"
status="\${E8_STATUS_FIXTURE}"
trans="\${E8_TRANSITIONS_LOG}"
{
  printf '%s' 'xmac.sh'
  printf '\\t%s' "\${XMAC_CALLER-}"
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> "$log"

verb="\${1-}"
machine="\${2-}"

note() { printf '%s\\t%s\\t%s\\n' "$machine" "$1" "$(date -u +%FT%TZ)" >> "$trans"; }
set_state() {
  tmp="$status.\$\$"
  awk -v m="$machine" -v s="$1" '{ if (\$1 == m) { \$3 = s } ; print }' "$status" > "$tmp" && mv "$tmp" "$status"
}

case "$verb" in
  up)
    note STARTING
    sleep 0.3
    set_state UP
    note UP
    ;;
  down)
    note STOPPING
    sleep 0.5
    set_state DOWN
    note DOWN
    ;;
esac
exit 0
`;
}

// The busy preflight's ssh. Every fake box answers idle: this fence is about
// the force step-up, not about the busy preflight (L1*, which E4 owns).
function sshScript(): string {
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
    .map((row, i) => `${row.name}|${row.ip}|02:00:00:00:00:${60 + i}|agjrom|${row.role}|echo e8-fixture-busy-check`)
    .join('\n')}\n`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Verified WoL evidence (a WAKE followed by a later UP) for every machine
// except LATCH, which has no WAKE at all and is therefore never-verified.
function wolLog(): string {
  const now = Date.now();
  const lines: string[] = [];
  for (const row of FLEET) {
    if (row.name === LATCH) continue;
    lines.push(`${stamp(now - 30 * 60 * 1000)} WAKE ${row.name} 1`);
    lines.push(`${stamp(now - 20 * 60 * 1000)} UP ${row.name} 1`);
  }
  return `${lines.join('\n')}\n`;
}

// The live process-and-lease probe the confirmation text must carry (L3h).
function probeFixture(): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  for (const row of FLEET) {
    rows[row.name] = row.name === FORGE
      ? { processesText: FORGE_PROCESSES, leasesText: FORGE_LEASES, leaseHolders: [FORGE_HOLDER] }
      : {
        processesText: `pid 1000 idle-agent (agjrom) on ${row.name}`,
        leasesText: 'no active lease',
        leaseHolders: [],
      };
  }
  return rows;
}

let telegramBase = '';

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e8-force-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const spyLog = path.join(dir, 'gateway-argv.log');
  installRecordingSpies(bin, spyLog);
  fs.writeFileSync(path.join(bin, 'xmac.sh'), gatewayScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'xmac.sh'), 0o755);
  fs.writeFileSync(path.join(bin, 'ssh'), sshScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'ssh'), 0o755);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  const xmacLog = path.join(dir, 'xmac.log');
  const probePath = path.join(dir, 'force-probe.json');
  const protectedDir = path.join(dir, 'protected');
  const transitions = path.join(dir, 'transitions.log');

  fs.writeFileSync(statusPath, statusLines(FLEET));
  fs.writeFileSync(confPath, confLines(FLEET));
  fs.writeFileSync(
    metricsPath,
    JSON.stringify(Object.fromEntries(FLEET.map((row) => [row.name, {
      gpuTempsC: [48], gpuPowerWatts: [85], uptime: '1d 2h 3m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '20s', cpuTemp: 39,
    }]))),
  );
  fs.writeFileSync(xmacLog, wolLog());
  fs.writeFileSync(probePath, JSON.stringify(probeFixture()));
  fs.writeFileSync(transitions, '');

  // The lease FORGE is held under, read from the real lease location A13 and
  // the A10 coordinator both read: $XMAC_STATE/leases/<machine>/<holder>.
  fs.mkdirSync(path.join(stateDir, 'leases', FORGE), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'leases', FORGE, FORGE_HOLDER), '');

  // Protected roles, by observed address: .174 while signal is live.
  fs.mkdirSync(protectedDir, { recursive: true });
  fs.writeFileSync(
    path.join(protectedDir, 'status.json'),
    JSON.stringify(Object.fromEntries(FLEET.map((row) => [row.name, { ip: row.ip }]))),
  );
  fs.writeFileSync(path.join(protectedDir, 'roles.json'), JSON.stringify({ signal: 'live', glimmer: 'live' }));
  fs.writeFileSync(path.join(protectedDir, 'leases.json'), JSON.stringify({ names: [] }));
  fs.writeFileSync(path.join(protectedDir, 'schedule.json'), JSON.stringify({}));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_ARM: '1',
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMACHINES_PROTECTED_FIXTURE_DIR: protectedDir,
    XMACHINES_FORCE_PROBE_FIXTURE: probePath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    XMAC_LOG: xmacLog,
    XMAC_USER: 'agjrom',
    XMACHINES_UP_SECONDS: '3600',
    // The production Telegram sender's own base override: the capture server
    // below IS api.telegram.org for this run, so what it records is the real
    // outbound update and not a dialog mocked inside the page (L3b).
    TELEGRAM_API_BASE: telegramBase,
    TELEGRAM_API_BASE_URL: telegramBase,
    TELEGRAM_API_ROOT: telegramBase,
    XMACHINES_TELEGRAM_API_BASE: telegramBase,
    E8_SPY_LOG: spyLog,
    E8_STATUS_FIXTURE: statusPath,
    E8_TRANSITIONS_LOG: transitions,
    E8_OWNER_TOKEN_ONE: OWNERS.one.token,
    E8_OWNER_TOKEN_TWO: OWNERS.two.token,
    E8_OWNER_TOKEN_THREE: OWNERS.three.token,
    E8_VIEWER_TOKEN: NON_OWNER.token,
  };
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  return {
    dir, bin, spyLog, statusPath, confPath, metricsPath,
    stateDir, xmacLog, probePath, protectedDir, transitions, env,
  };
}

type SpyRow = { command: string; caller: string; argv: string[] };

function spyRows(log: string): SpyRow[] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const fields = line.split('\t');
      return { command: fields[0] ?? '', caller: fields[1] ?? '', argv: fields.slice(2) };
    });
}

function gatewayRows(log: string): SpyRow[] {
  return spyRows(log).filter((row) => row.command === 'xmac.sh');
}

function forceRowsFor(log: string, machine: string): SpyRow[] {
  return gatewayRows(log).filter(
    (row) => row.argv[0] === 'down' && row.argv[1] === machine && row.argv.includes('--force'),
  );
}

function allForceRows(log: string): SpyRow[] {
  return gatewayRows(log).filter((row) => row.argv.includes('--force'));
}

function transitionRows(file: string): Array<{ machine: string; state: string }> {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [machine, state] = line.split('\t');
      return { machine: machine ?? '', state: state ?? '' };
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

async function waitForGatewayRow(
  log: string,
  predicate: (row: SpyRow) => boolean,
  timeoutMs = 8_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gatewayRows(log).some(predicate)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// ---------------------------------------------------------------------------
// A local capture server standing in for api.telegram.org. It records the
// ACTUAL outbound Telegram updates the production sender puts on the wire,
// which is the only thing that proves L3b; a dialog mocked inside the page is
// explicitly not acceptable.
// ---------------------------------------------------------------------------
type Captured = { url: string; body: Record<string, unknown> | string | null };
const captured: Captured[] = [];

async function startCaptureServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> | string | null = null;
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = raw; }
      captured.push({ url: req.url || '', body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: captured.length } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function sendMessageCaptures(): Captured[] {
  return captured.filter((entry) => /\/bot[^/]*\/sendMessage$/.test(entry.url));
}

function capturedText(entry: Captured): string {
  const body = entry.body;
  if (!body || typeof body !== 'object') return '';
  return typeof (body as { text?: unknown }).text === 'string' ? (body as { text: string }).text : '';
}

// ---------------------------------------------------------------------------
// The scratch app server: the REAL createApiServer, run through tsx against
// src/ so the journey never depends on a freshly built dist/ (a stale bundle
// would make this red for a build reason instead of a capability reason). It
// serves the REAL src/web/public app, so the browser drives the product UI.
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');

const TOKENS = new Map([
  [process.env.E8_OWNER_TOKEN_ONE, { id: 1, role: 'owner', username: 'owner' }],
  [process.env.E8_OWNER_TOKEN_TWO, { id: 2, role: 'owner', username: 'owner2' }],
  [process.env.E8_OWNER_TOKEN_THREE, { id: 3, role: 'owner', username: 'owner3' }],
  [process.env.E8_VIEWER_TOKEN, { id: 4, role: 'user', username: 'viewer' }],
]);

const config = {
  telegram: { botToken: '123:ABC', authorizedUserId: 77, authorizedChatIds: [77], testMode: true, updateMode: 'polling', webhookUrl: null, webhookPath: '/api/telegram/webhook', webhookSecretToken: 's' },
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
console.log('E8-SERVER-READY ' + app.server.address().port);
`;

const OWNER_TELEGRAM_ID = 77;

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
    const match = out.match(/E8-SERVER-READY (\d+)/);
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
// It relaxes no check: the route still applies its own Host/Origin allowlist.
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
// The owner's browser on the product detail page.
// ---------------------------------------------------------------------------
type PowerCall = {
  url: string;
  method: string;
  status: number;
  body: Record<string, unknown> | null;
  idempotencyKey: string;
  postData: string | null;
  at: number;
};

type Detail = {
  page: import('@playwright/test').Page;
  close: () => Promise<void>;
  calls: PowerCall[];
};

let base = '';
let bootError = '';

async function openDetail(
  browser: import('@playwright/test').Browser,
  machine: string,
  owner: { token: string; id: number },
): Promise<Detail> {
  if (bootError) throw new Error(bootError);
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await context.newPage();
  const calls: PowerCall[] = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!/\/api\/xmachines\/machines\/[^/]+\/power\/(on|off|force)$/.test(url)) return;
    const request = response.request();
    const headers = await request.allHeaders().catch(() => ({} as Record<string, string>));
    let body: Record<string, unknown> | null = null;
    try { body = (await response.json()) as Record<string, unknown>; } catch { body = null; }
    calls.push({
      url,
      method: request.method(),
      status: response.status(),
      body,
      idempotencyKey: headers['idempotency-key'] ?? headers['x-idempotency-key'] ?? '',
      postData: request.postData(),
      at: Date.now(),
    });
  });
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript(([token, id]) => {
    try {
      localStorage.setItem('agj_token', token as string);
      localStorage.setItem('agj_user', JSON.stringify({ id, name: 'owner', username: 'owner', role: 'owner' }));
    } catch { /* ignore */ }
  }, [owner.token, owner.id] as [string, number]);
  await page.goto(`${base}/index.html#/xmachines/${machine}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(DETAIL_SEL, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { page, close: () => context.close(), calls };
}

// A visible, pressable control: an alias selector first, then an
// accessible-text fallback inside the detail section (ambiguity 3).
async function clickControl(
  page: import('@playwright/test').Page,
  selector: string,
  textRe: RegExp | null,
): Promise<string> {
  const direct = page.locator(selector);
  const count = await direct.count();
  for (let i = 0; i < count; i++) {
    const node = direct.nth(i);
    if (!(await node.isVisible().catch(() => false))) continue;
    await node.click({ timeout: 5_000 });
    return 'selector';
  }
  if (textRe) {
    const buttons = page.locator(`${DETAIL_SEL} button, ${DETAIL_SEL} [role="button"]`);
    const buttonCount = await buttons.count();
    for (let i = 0; i < buttonCount; i++) {
      const node = buttons.nth(i);
      if (!(await node.isVisible().catch(() => false))) continue;
      const label = ((await node.textContent().catch(() => '')) || '').trim();
      const aria = (await node.getAttribute('aria-label').catch(() => '')) || '';
      if (textRe.test(label) || textRe.test(aria)) {
        await node.click({ timeout: 5_000 });
        return `text:${label || aria}`;
      }
    }
  }
  return '';
}

async function texts(page: import('@playwright/test').Page, selector: string): Promise<string[]> {
  return page.$$eval(selector, (nodes) => nodes.map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()));
}

async function renderedState(page: import('@playwright/test').Page): Promise<string> {
  const found = await texts(page, STATE_SEL);
  return (found[0] ?? '').toLowerCase();
}

// The control that consumes the challenge from the PRODUCT surface: a
// pressable element carrying the route's own displayNumber, else a force
// confirm control (ambiguity 2).
async function consumeChallenge(
  page: import('@playwright/test').Page,
  displayNumber: number | null,
): Promise<string> {
  if (displayNumber !== null) {
    const buttons = page.locator('button, [role="button"], [data-number]');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const node = buttons.nth(i);
      if (!(await node.isVisible().catch(() => false))) continue;
      const label = ((await node.textContent().catch(() => '')) || '').trim();
      const attr = (await node.getAttribute('data-number').catch(() => '')) || '';
      if (label === String(displayNumber) || attr === String(displayNumber)) {
        await node.click({ timeout: 5_000 });
        return `number:${displayNumber}`;
      }
    }
  }
  return clickControl(page, CONFIRM_SEL, CONFIRM_TEXT);
}

type ForcePress = {
  clicked: string;
  challengeId: string;
  displayNumber: number | null;
  expiresAt: number | null;
  confirmation: string;
  issuedAt: number;
  status: number;
  rendered: string[];
  calls: PowerCall[];
};

function lastForceCall(calls: PowerCall[]): PowerCall | undefined {
  return calls.filter((call) => /\/power\/force$/.test(call.url)).pop();
}

function readChallenge(call: PowerCall | undefined, clicked: string, rendered: string[], calls: PowerCall[]): ForcePress {
  const body = call?.body ?? null;
  return {
    clicked,
    challengeId: typeof body?.challengeId === 'string' ? body.challengeId : '',
    displayNumber: typeof body?.displayNumber === 'number' ? body.displayNumber : null,
    expiresAt: typeof body?.expiresAt === 'number' ? body.expiresAt : null,
    confirmation: typeof body?.confirmation === 'string' ? body.confirmation : '',
    issuedAt: call?.at ?? 0,
    status: call?.status ?? 0,
    rendered,
    calls,
  };
}

// Press the product's FORCE control and report what the route answered and
// what the page then showed.
async function pressForce(detail: Detail, settleMs = 2_000): Promise<ForcePress> {
  const clicked = await clickControl(detail.page, FORCE_SEL, FORCE_TEXT);
  if (clicked) await detail.page.waitForTimeout(settleMs);
  const rendered = await texts(detail.page, `${CHALLENGE_SEL}, ${CONFIRMATION_SEL}, ${REFUSAL_SEL}`);
  return readChallenge(lastForceCall(detail.calls), clicked, rendered, [...detail.calls]);
}

// A POST issued from the PAGE's own origin and session — used only for the
// binding violations and the keyless control (ambiguity 4), never to
// manufacture a challenge the product flow did not itself issue.
type PagePost = { status: number; body: Record<string, unknown> | null };

async function postFromPage(
  page: import('@playwright/test').Page,
  machine: string,
  route: 'force' | 'off',
  payload: Record<string, unknown> | null,
  withKey = true,
): Promise<PagePost> {
  return page.evaluate(async ([name, kind, bodyJson, key]) => {
    const token = localStorage.getItem('agj_token') || '';
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (key === '1') headers['Idempotency-Key'] = `e8-${Math.random().toString(36).slice(2)}`;
    let body: string | undefined;
    if (bodyJson) {
      headers['Content-Type'] = 'application/json';
      body = bodyJson as string;
    }
    const res = await fetch(`/api/xmachines/machines/${encodeURIComponent(name as string)}/power/${kind}`, {
      method: 'POST',
      headers,
      ...(body ? { body } : {}),
    });
    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { parsed = null; }
    return { status: res.status, body: parsed as Record<string, unknown> | null };
  }, [machine, route, payload ? JSON.stringify(payload) : '', withKey ? '1' : '0'] as [string, string, string, string]);
}

function reasonOf(post: PagePost): string {
  const body = post.body;
  if (!body) return '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const detail = typeof body.detail === 'string' ? body.detail : '';
  const error = typeof body.error === 'string' ? body.error : '';
  return reason || detail || error;
}

// Every rendered refusal this fence observed, with the string the route
// returned in the SAME exchange. L9b is asserted over this ledger.
const refusalLedger: Array<{ machine: string; surface: 'force' | 'off'; rendered: string; fromRoute: string }> = [];

function recordRendered(
  machine: string,
  surface: 'force' | 'off',
  rendered: string[],
  call: PowerCall | undefined,
): void {
  const body = call?.body ?? null;
  const fromRoute = typeof body?.detail === 'string'
    ? body.detail
    : typeof body?.reason === 'string' ? body.reason : '';
  if (!fromRoute) return;
  const shown = rendered.find((text) => text === fromRoute)
    ?? rendered.find((text) => text.includes(fromRoute))
    ?? '';
  refusalLedger.push({ machine, surface, rendered: shown, fromRoute });
}

// ---------------------------------------------------------------------------
// One server for the whole fence. Boot failure is CAPTURED, not thrown: a throw
// here would abort collection and the driver would see an env error instead of
// a proving assertion failure.
// ---------------------------------------------------------------------------
let scratch: Scratch | null = null;
let server: Server | null = null;
let proxy: { base: string; close: () => Promise<void> } | null = null;
let capture: { base: string; close: () => Promise<void> } | null = null;

test.beforeAll(async () => {
  try {
    capture = await startCaptureServer();
    telegramBase = capture.base;
    scratch = newScratch();
    // Spy self-test BEFORE anything is served, so "zero wake calls" is a real
    // observation and not an artefact of a spy that was never on PATH.
    // 'ping' is a read verb, never a wake verb.
    spawnSync('ping', [SELFTEST_MARKER], { env: scratch.env, encoding: 'utf8' });
    server = await startServer(scratch);
    proxy = await startProxy(server.port);
    base = proxy.base;
  } catch (error) {
    bootError = `fake-fleet server unavailable: ${(error as Error).message}`;
  }
});

test.afterAll(async () => {
  try { await proxy?.close(); } catch { /* already closed */ }
  try { server?.child.kill('SIGTERM'); } catch { /* already gone */ }
  try { await capture?.close(); } catch { /* already closed */ }
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (scratch) fs.rmSync(scratch.dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Structural guard on the split itself: the per-contributor test below must
// cover exactly the row's acceptance ids, each once, and every rejection must
// name the row's single contributor.
// ---------------------------------------------------------------------------
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
  const units = new Set(Object.values(COVERED));
  if (units.size !== 1 || !units.has('D8')) {
    throw new Error(`fence ${FENCE_ID}: rejections must name exactly the 1 contributor D8, found ${JSON.stringify([...units])}`);
  }
});

// ---------------------------------------------------------------------------
// D8 — the separate force surface: an owner-only force control that opens a
// number-match challenge, puts the production Telegram sender's real update on
// the wire, renders the live process-and-lease probe, consumes the challenge
// exactly once under session/machine/action binding, and is the ONLY path by
// which `xmac.sh down --force` ever reaches the gateway.
// Owns: D3a D3b L3a L3b L3c L3d L3e L3f L3g L3h L6h L9b L9d L9e L15b
// ---------------------------------------------------------------------------
test('test_d8_force_flow_renders_number_match_and_live_probe_and_is_the_only_path_to_force', async ({ browser }) => {
  test.setTimeout(170_000);
  const results: boolean[] = [];
  const log = scratch?.spyLog ?? '';
  const statusPath = scratch?.statusPath ?? '';
  const transitions = scratch?.transitions ?? '';
  const bootNote = bootError ? ` [${bootError}]` : '';
  const phaseErrors: string[] = [];

  async function phase(name: string, fn: () => Promise<void>): Promise<void> {
    if (bootError) return;
    try {
      await fn();
    } catch (error) {
      phaseErrors.push(`${name}: ${(error as Error).message}`);
    }
  }
  const phaseNote = () => (phaseErrors.length ? ` [phases: ${phaseErrors.join(' | ')}]` : '');

  // ---- state collected across the phases ----------------------------------
  let tally: ForcePress | null = null;          // the expiring challenge
  let tallyLate: { rendered: string[]; post: PagePost | null; clicked: string } | null = null;
  let forge: ForcePress | null = null;          // the consumed force
  let forgeForceRowsAtChallenge = 0;
  let forgeConfirmClicked = '';
  let forgeConfirmCall: PowerCall | undefined;
  let forgeRenderedAfterConfirm: string[] = [];
  let forgeReplay: PagePost | null = null;
  let forgeReplayRendered: string[] = [];
  let forgeStateAfter = '';
  let warden: ForcePress | null = null;
  let keel: ForcePress | null = null;
  let keelCrossSession: PagePost | null = null;
  let pivot: ForcePress | null = null;
  let pivotCrossMachine: PagePost | null = null;
  let latch: ForcePress | null = null;
  let latchCrossAction: PagePost | null = null;
  let latchOffRendered: string[] = [];
  let latchOffCall: PowerCall | undefined;
  let keyless: PagePost | null = null;
  let viewerForce: PagePost | null = null;
  let viewerSawForceControl = true;
  let ownerForceControls = 0;
  let ownerOffControls = 0;
  let forceControlIsOffControl = true;
  let allPowerCalls: PowerCall[] = [];

  // ---- phase 0: open the challenge that must EXPIRE (ambiguity 5) ---------
  await phase('tally-open', async () => {
    const detail = await openDetail(browser, TALLY, OWNERS.one);
    try {
      tally = await pressForce(detail);
      allPowerCalls.push(...detail.calls);
      // The page stays closed between phases; the challenge lives server-side
      // and is re-confirmed from a fresh page of the SAME session at the end.
    } finally {
      await detail.close();
    }
  });

  // ---- phase 1: the clean owner force on FORGE ----------------------------
  await phase('forge-force', async () => {
    const detail = await openDetail(browser, FORGE, OWNERS.one);
    try {
      // The two controls must be distinct nodes on the same detail (L3a).
      ownerForceControls = await detail.page.locator(FORCE_SEL).count();
      ownerOffControls = await detail.page.locator(OFF_SEL).count();
      if (ownerForceControls > 0 && ownerOffControls > 0) {
        forceControlIsOffControl = await detail.page.evaluate(([forceSel, offSel]) => {
          const force = Array.from(document.querySelectorAll(forceSel as string));
          const off = Array.from(document.querySelectorAll(offSel as string));
          return force.some((node) => off.includes(node));
        }, [FORCE_SEL, OFF_SEL] as [string, string]);
      }

      forge = await pressForce(detail);
      // Nothing may have reached the gateway while only a challenge is open.
      forgeForceRowsAtChallenge = allForceRows(log).length;

      forgeConfirmClicked = await consumeChallenge(detail.page, forge.displayNumber);
      if (forgeConfirmClicked) await detail.page.waitForTimeout(2_500);
      forgeConfirmCall = detail.calls
        .filter((call) => /\/power\/force$/.test(call.url) && call.status === 202)
        .pop();
      forgeRenderedAfterConfirm = await texts(detail.page, `${CHALLENGE_SEL}, ${CONFIRMATION_SEL}, ${REFUSAL_SEL}`);

      // Second consume of the SAME challenge: from the surface if it is still
      // pressable, else replayed from the page's own session.
      const again = await consumeChallenge(detail.page, forge.displayNumber);
      if (again) {
        await detail.page.waitForTimeout(1_500);
        const replayCall = detail.calls.filter((call) => /\/power\/force$/.test(call.url)).pop();
        forgeReplay = { status: replayCall?.status ?? 0, body: replayCall?.body ?? null };
      } else if (forge.challengeId && forge.displayNumber !== null) {
        forgeReplay = await postFromPage(detail.page, FORGE, 'force', {
          challengeId: forge.challengeId,
          selectedNumber: forge.displayNumber,
        });
        await detail.page.waitForTimeout(500);
      }
      forgeReplayRendered = await texts(detail.page, `${CHALLENGE_SEL}, ${REFUSAL_SEL}`);
      allPowerCalls.push(...detail.calls);
    } finally {
      await detail.close();
    }
    await waitForGatewayRow(log, (row) => row.argv[0] === 'down' && row.argv[1] === FORGE);
  });

  // ---- phase 2: the protected-role force refusal, rendered ----------------
  await phase('warden-protected', async () => {
    const detail = await openDetail(browser, WARDEN, OWNERS.two);
    try {
      warden = await pressForce(detail);
      recordRendered(WARDEN, 'force', warden.rendered, lastForceCall(detail.calls));
      allPowerCalls.push(...detail.calls);
    } finally {
      await detail.close();
    }
  });

  // ---- phase 3: session binding (L3e) -------------------------------------
  await phase('keel-session-binding', async () => {
    const detail = await openDetail(browser, KEEL, OWNERS.one);
    try {
      keel = await pressForce(detail);
      allPowerCalls.push(...detail.calls);
    } finally {
      await detail.close();
    }
    if (keel?.challengeId && keel.displayNumber !== null) {
      const other = await openDetail(browser, KEEL, OWNERS.two);
      try {
        keelCrossSession = await postFromPage(other.page, KEEL, 'force', {
          challengeId: keel.challengeId,
          selectedNumber: keel.displayNumber,
        });
        allPowerCalls.push(...other.calls);
      } finally {
        await other.close();
      }
    }
  });

  // ---- phase 4: machine binding (L3f) -------------------------------------
  await phase('pivot-machine-binding', async () => {
    const detail = await openDetail(browser, PIVOT, OWNERS.one);
    try {
      pivot = await pressForce(detail);
      if (pivot.challengeId && pivot.displayNumber !== null) {
        pivotCrossMachine = await postFromPage(detail.page, BOLT, 'force', {
          challengeId: pivot.challengeId,
          selectedNumber: pivot.displayNumber,
        });
      }
      // ---- the keyless control (L15b), same page, same session ------------
      keyless = await postFromPage(detail.page, BOLT, 'force', null, false);
      allPowerCalls.push(...detail.calls);
    } finally {
      await detail.close();
    }
  });

  // ---- phase 5: action binding (L3g) and the normal-Off step-up (L6h) -----
  await phase('latch-action-binding', async () => {
    const detail = await openDetail(browser, LATCH, OWNERS.three);
    try {
      latch = await pressForce(detail);
      if (latch.challengeId && latch.displayNumber !== null) {
        latchCrossAction = await postFromPage(detail.page, LATCH, 'off', {
          challengeId: latch.challengeId,
          selectedNumber: latch.displayNumber,
        });
      }
      const offClicked = await clickControl(detail.page, OFF_SEL, OFF_TEXT);
      if (offClicked) await detail.page.waitForTimeout(2_000);
      latchOffRendered = await texts(detail.page, `${CHALLENGE_SEL}, ${CONFIRMATION_SEL}, ${REFUSAL_SEL}`);
      latchOffCall = detail.calls.filter((call) => /\/power\/off$/.test(call.url)).pop();
      recordRendered(LATCH, 'off', latchOffRendered, latchOffCall);
      allPowerCalls.push(...detail.calls);
    } finally {
      await detail.close();
    }
  });

  // ---- phase 6: the non-owner (D3a) --------------------------------------
  await phase('viewer-force', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.route(/telegram-web-app\.js/, (route) => route.abort());
      await page.addInitScript(([token, id]) => {
        try {
          localStorage.setItem('agj_token', token as string);
          localStorage.setItem('agj_user', JSON.stringify({ id, name: 'viewer', username: 'viewer', role: 'user' }));
        } catch { /* ignore */ }
      }, [NON_OWNER.token, NON_OWNER.id] as [string, number]);
      await page.goto(`${base}/index.html#/xmachines/${BOLT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1_200);
      viewerSawForceControl = (await page.locator(FORCE_SEL).count()) > 0;
      viewerForce = await postFromPage(page, BOLT, 'force', null);
    } finally {
      await context.close();
    }
  });

  // ---- phase 7: the expired confirm (L3d), after the TTL has really run ---
  await phase('tally-expire', async () => {
    const expiresAt = tally?.expiresAt ?? (tally?.issuedAt ? tally.issuedAt + CHALLENGE_TTL_MS : 0);
    if (expiresAt) {
      // Hard-capped so a fast run cannot blow the runner's 170s spawn budget.
      const waitMs = Math.max(0, Math.min(expiresAt + 1_500 - Date.now(), 45_000));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    const detail = await openDetail(browser, TALLY, OWNERS.one);
    try {
      const clicked = tally ? await consumeChallenge(detail.page, tally.displayNumber) : '';
      if (clicked) await detail.page.waitForTimeout(1_500);
      let post: PagePost | null = null;
      if (clicked) {
        const call = detail.calls.filter((c) => /\/power\/force$/.test(c.url)).pop();
        post = { status: call?.status ?? 0, body: call?.body ?? null };
      } else if (tally?.challengeId && tally.displayNumber !== null) {
        post = await postFromPage(detail.page, TALLY, 'force', {
          challengeId: tally.challengeId,
          selectedNumber: tally.displayNumber,
        });
        await detail.page.waitForTimeout(500);
      }
      const rendered = await texts(detail.page, `${CHALLENGE_SEL}, ${REFUSAL_SEL}`);
      tallyLate = { rendered, post, clicked };
      recordRendered(TALLY, 'force', rendered, detail.calls.filter((c) => /\/power\/force$/.test(c.url)).pop());
      allPowerCalls.push(...detail.calls);
    } finally {
      await detail.close();
    }
  });

  // ---- phase 8: what the product shows after the host really moved --------
  await phase('forge-reload', async () => {
    const detail = await openDetail(browser, FORGE, OWNERS.two);
    try {
      forgeStateAfter = await renderedState(detail.page);
      if (!forgeStateAfter) {
        forgeStateAfter = ((await detail.page.locator('body').textContent().catch(() => '')) || '')
          .replace(/\s+/g, ' ')
          .toLowerCase();
      }
    } finally {
      await detail.close();
    }
  });

  // =========================================================================
  // The acceptance ids.
  // =========================================================================

  // D3a — only an owner can start a force action.
  results.push(await guardedCheck('D3a', COVERED.D3a, async () => {
    if (ownerForceControls === 0 && !(forge?.clicked)) {
      throw new Error(`the owner's detail page exposes no force control at all (tried ${FORCE_SEL} and a button labelled like ${FORCE_TEXT}), so "only an owner can start a force action" is unobservable — nobody can start one${bootNote}${phaseNote()}`);
    }
    if (viewerSawForceControl) {
      throw new Error(`a non-owner session was shown a force control on the machine detail page`);
    }
    if (!viewerForce) {
      throw new Error(`the non-owner force attempt never reached the route${phaseNote()}`);
    }
    if (viewerForce.status !== 403) {
      throw new Error(`a non-owner force POST was answered ${viewerForce.status} ${JSON.stringify(viewerForce.body)}, expected 403`);
    }
    if (!/owner/i.test(reasonOf(viewerForce))) {
      throw new Error(`a non-owner force POST was refused without naming the owner requirement: ${JSON.stringify(viewerForce.body)}`);
    }
    if (allForceRows(log).some((row) => row.argv[1] === BOLT)) {
      throw new Error(`the non-owner attempt reached the gateway: ${JSON.stringify(allForceRows(log).map((r) => r.argv))}`);
    }
  }, 'http-matrix'));

  // D3b — force is unavailable until its number-match confirmation succeeds.
  results.push(await guardedCheck('D3b', COVERED.D3b, async () => {
    if (!forge?.clicked) {
      throw new Error(`no force control could be pressed on ${FORGE}, so the force flow never started${bootNote}${phaseNote()}`);
    }
    if (!forge.challengeId || forge.displayNumber === null) {
      throw new Error(`pressing force answered ${forge.status} ${JSON.stringify(forge.calls.map((c) => ({ url: c.url, status: c.status, body: c.body })).slice(-2))} — no number-match challenge was issued`);
    }
    if (forgeForceRowsAtChallenge !== 0) {
      throw new Error(`${forgeForceRowsAtChallenge} --force row(s) reached the gateway while only a challenge was open: ${JSON.stringify(allForceRows(log).map((r) => r.argv))}`);
    }
    if (!forgeConfirmClicked) {
      throw new Error(`no product control could consume the challenge (no pressable element carrying displayNumber=${forge.displayNumber}, no ${CONFIRM_SEL}), so force can never become available from the product surface`);
    }
    if (forgeConfirmCall?.status !== 202) {
      throw new Error(`consuming the challenge did not start the force: ${forgeConfirmCall?.status} ${JSON.stringify(forgeConfirmCall?.body)}`);
    }
    const rows = forceRowsFor(log, FORGE);
    if (rows.length !== 1) {
      throw new Error(`expected exactly one 'down ${FORGE} --force' after the consumed challenge, gateway recorded ${rows.length}: ${JSON.stringify(gatewayRows(log).map((r) => r.argv))}`);
    }
  }));

  // L3a — full force is a separate action from normal Off.
  results.push(await guardedCheck('L3a', COVERED.L3a, async () => {
    if (ownerForceControls === 0) {
      throw new Error(`the detail page renders no force control, so force is not a separate action — it is no action at all (off controls found: ${ownerOffControls})${bootNote}${phaseNote()}`);
    }
    if (ownerOffControls === 0) {
      throw new Error(`the detail page renders no normal Off control, so "separate from normal Off" is unobservable`);
    }
    if (forceControlIsOffControl) {
      throw new Error(`the force control and the normal Off control are the same node`);
    }
    if (!forgeConfirmCall || !/\/power\/force$/.test(forgeConfirmCall.url)) {
      throw new Error(`the force flow's accepted POST was ${forgeConfirmCall?.url ?? 'never issued'}, not the separate /power/force route`);
    }
    const latchOff = latchOffCall;
    if (!latchOff) {
      throw new Error(`the normal Off control on ${LATCH} issued no POST, so "normal Off is a different action" is unasserted`);
    }
    if (/\/power\/force$/.test(latchOff.url)) {
      throw new Error(`the normal Off control posted the force route: ${latchOff.url}`);
    }
    if (forceRowsFor(log, LATCH).length !== 0) {
      throw new Error(`a normal Off produced a --force gateway call: ${JSON.stringify(forceRowsFor(log, LATCH).map((r) => r.argv))}`);
    }
  }));

  // L3b — full force requires a Telegram number-match challenge, captured at
  // the owner destination from the PRODUCTION sender (never a mocked dialog).
  results.push(await guardedCheck('L3b', COVERED.L3b, async () => {
    if (!forge?.challengeId || forge.displayNumber === null) {
      throw new Error(`the force flow issued no challenge, so no number-match update could be sent${bootNote}${phaseNote()}`);
    }
    const sends = sendMessageCaptures();
    if (sends.length === 0) {
      throw new Error(`the capture server standing in for api.telegram.org received NO outbound sendMessage while the force flow issued a challenge (captured=${captured.length}); a number shown only inside the page is a mocked dialog, not a Telegram number match`);
    }
    const match = sends.find((entry) => {
      const text = capturedText(entry);
      return text.includes(String(forge!.displayNumber)) && text.includes(FORGE);
    });
    if (!match) {
      throw new Error(`no captured Telegram update carried the challenge number ${forge.displayNumber} for ${FORGE}: ${JSON.stringify(sends.map((s) => capturedText(s).slice(0, 120)))}`);
    }
    const body = match.body as Record<string, unknown>;
    if (body.chat_id !== OWNER_TELEGRAM_ID) {
      throw new Error(`the captured update was addressed to ${JSON.stringify(body.chat_id)}, not the configured owner destination ${OWNER_TELEGRAM_ID}`);
    }
    const markup = body.reply_markup as { inline_keyboard?: unknown[][] } | undefined;
    const rows = Array.isArray(markup?.inline_keyboard) ? markup!.inline_keyboard! : [];
    const buttons = rows.flat() as Array<{ text?: string }>;
    if (buttons.length < 2) {
      throw new Error(`the captured update offered ${buttons.length} button(s); a number MATCH needs the owner to pick the shown number from alternatives: ${JSON.stringify(body.reply_markup)}`);
    }
    if (!buttons.some((btn) => String(btn?.text ?? '') === String(forge!.displayNumber))) {
      throw new Error(`no captured button carried the number the page displayed (${forge.displayNumber}): ${JSON.stringify(buttons.map((b) => b?.text))}`);
    }
  }, 'telegram-capture'));

  // L3c — a successful force challenge can be consumed only once.
  results.push(await guardedCheck('L3c', COVERED.L3c, async () => {
    if (!forgeConfirmClicked || forgeConfirmCall?.status !== 202) {
      throw new Error(`no challenge was ever successfully consumed, so "only once" is unobservable${bootNote}${phaseNote()}`);
    }
    if (!forgeReplay) {
      throw new Error(`the consumed challenge was never re-submitted, so single use is unasserted`);
    }
    if (forgeReplay.status === 202 || forgeReplay.status === 200) {
      throw new Error(`re-submitting the consumed challenge was accepted (${forgeReplay.status} ${JSON.stringify(forgeReplay.body)})`);
    }
    const reason = reasonOf(forgeReplay);
    if (!/already-consumed|consumed|unknown-challenge/.test(reason)) {
      throw new Error(`re-submitting the consumed challenge was refused for ${JSON.stringify(reason)}, which does not name a spent challenge`);
    }
    const rows = forceRowsFor(log, FORGE);
    if (rows.length !== 1) {
      throw new Error(`a re-used challenge produced ${rows.length} --force gateway calls for ${FORGE}, expected exactly 1`);
    }
  }));

  // L3d — a force challenge expires no later than 60 seconds.
  results.push(await guardedCheck('L3d', COVERED.L3d, async () => {
    if (!tally?.challengeId || tally.displayNumber === null) {
      throw new Error(`the force flow issued no challenge on ${TALLY}, so its expiry is unobservable${bootNote}${phaseNote()}`);
    }
    if (tally.expiresAt === null) {
      throw new Error(`the challenge the product flow issued published no expiresAt, so the owner is never told the window: ${JSON.stringify(tally.calls.map((c) => c.body).slice(-1))}`);
    }
    const window = tally.expiresAt - tally.issuedAt;
    if (!(window > 0 && window <= CHALLENGE_TTL_MS + 1_000)) {
      throw new Error(`the challenge window is ${window}ms, which is not "no later than 60 seconds"`);
    }
    if (!tallyLate?.post) {
      throw new Error(`the expired challenge was never re-submitted, so expiry is unasserted`);
    }
    if (Date.now() < tally.expiresAt) {
      throw new Error(`the late confirm ran before the published expiry, so nothing about expiry was observed`);
    }
    if (tallyLate.post.status === 202 || tallyLate.post.status === 200) {
      throw new Error(`a confirm submitted after the 60s window was accepted: ${tallyLate.post.status} ${JSON.stringify(tallyLate.post.body)}`);
    }
    const reason = reasonOf(tallyLate.post);
    if (!/expired|unknown-challenge/.test(reason)) {
      throw new Error(`the late confirm was refused for ${JSON.stringify(reason)}, which does not name an expired or pruned challenge`);
    }
    if (!tallyLate.rendered.some((text) => text.length > 0)) {
      throw new Error(`the expired confirm rendered nothing at all, so the owner is never shown that the window closed`);
    }
    if (forceRowsFor(log, TALLY).length !== 0) {
      throw new Error(`an expired challenge still reached the gateway: ${JSON.stringify(forceRowsFor(log, TALLY).map((r) => r.argv))}`);
    }
  }, 'http-matrix'));

  // L3e — a force challenge is bound to one web session.
  results.push(await guardedCheck('L3e', COVERED.L3e, async () => {
    if (!keel?.challengeId || keel.displayNumber === null) {
      throw new Error(`the force flow issued no challenge on ${KEEL}, so session binding is unobservable${bootNote}${phaseNote()}`);
    }
    if (!keelCrossSession) {
      throw new Error(`the second owner session never replayed the challenge`);
    }
    if (keelCrossSession.status === 202 || keelCrossSession.status === 200) {
      throw new Error(`a challenge issued to one web session was consumed by another: ${keelCrossSession.status} ${JSON.stringify(keelCrossSession.body)}`);
    }
    const reason = reasonOf(keelCrossSession);
    if (!/session-mismatch|session|force-confirmation-required|unknown-challenge/.test(reason)) {
      throw new Error(`the cross-session confirm was refused for ${JSON.stringify(reason)}, which does not name the session binding`);
    }
    if (forceRowsFor(log, KEEL).length !== 0) {
      throw new Error(`a cross-session confirm reached the gateway: ${JSON.stringify(forceRowsFor(log, KEEL).map((r) => r.argv))}`);
    }
  }, 'http-matrix'));

  // L3f — a force challenge is bound to one machine.
  results.push(await guardedCheck('L3f', COVERED.L3f, async () => {
    if (!pivot?.challengeId || pivot.displayNumber === null) {
      throw new Error(`the force flow issued no challenge on ${PIVOT}, so machine binding is unobservable${bootNote}${phaseNote()}`);
    }
    if (!pivotCrossMachine) {
      throw new Error(`the challenge was never replayed against a second machine`);
    }
    if (pivotCrossMachine.status === 202 || pivotCrossMachine.status === 200) {
      throw new Error(`a challenge issued for ${PIVOT} was consumed against ${BOLT}: ${pivotCrossMachine.status} ${JSON.stringify(pivotCrossMachine.body)}`);
    }
    const reason = reasonOf(pivotCrossMachine);
    if (!/machine-mismatch|machine|force-confirmation-required|unknown-challenge/.test(reason)) {
      throw new Error(`the cross-machine confirm was refused for ${JSON.stringify(reason)}, which does not name the machine binding`);
    }
    const strays = allForceRows(log).filter((row) => row.argv[1] === BOLT || row.argv[1] === PIVOT);
    if (strays.length !== 0) {
      throw new Error(`a cross-machine confirm reached the gateway: ${JSON.stringify(strays.map((r) => r.argv))}`);
    }
  }, 'http-matrix'));

  // L3g — a force challenge is bound to the force action.
  results.push(await guardedCheck('L3g', COVERED.L3g, async () => {
    if (!latch?.challengeId || latch.displayNumber === null) {
      throw new Error(`the force flow issued no challenge on ${LATCH}, so action binding is unobservable${bootNote}${phaseNote()}`);
    }
    if (!latchCrossAction) {
      throw new Error(`the force challenge was never submitted to the Off action`);
    }
    if (latchCrossAction.status === 202 || latchCrossAction.status === 200) {
      throw new Error(`a challenge bound to the force action was consumed by the Off action: ${latchCrossAction.status} ${JSON.stringify(latchCrossAction.body)}`);
    }
    const reason = reasonOf(latchCrossAction);
    if (!/action-mismatch|action|force-confirmation-required|unknown-challenge/.test(reason)) {
      throw new Error(`the cross-action confirm was refused for ${JSON.stringify(reason)}, which does not name the action binding`);
    }
    const rows = gatewayRows(log).filter((row) => row.argv[0] === 'down' && row.argv[1] === LATCH);
    if (rows.length !== 0) {
      throw new Error(`a cross-action confirm actuated ${LATCH}: ${JSON.stringify(rows.map((r) => r.argv))}`);
    }
  }, 'http-matrix'));

  // L3h — the confirmation text carries the CURRENT live process and lease
  // probe, and the owner is shown it before confirming.
  results.push(await guardedCheck('L3h', COVERED.L3h, async () => {
    if (!forge?.challengeId) {
      throw new Error(`the force flow issued no challenge, so no confirmation text exists to render${bootNote}${phaseNote()}`);
    }
    const routeText = forge.confirmation;
    if (!routeText) {
      throw new Error(`the challenge carried no confirmation text: ${JSON.stringify(forge.calls.map((c) => c.body).slice(-1))}`);
    }
    if (!routeText.includes(FORGE_PROCESSES)) {
      throw new Error(`the confirmation text does not carry the live process probe (${JSON.stringify(FORGE_PROCESSES)}): ${JSON.stringify(routeText)}`);
    }
    if (!routeText.includes(FORGE_LEASES) || !routeText.includes(FORGE_HOLDER)) {
      throw new Error(`the confirmation text does not carry the live lease probe (${JSON.stringify(FORGE_LEASES)} / ${JSON.stringify(FORGE_HOLDER)}): ${JSON.stringify(routeText)}`);
    }
    const flat = routeText.replace(/\s+/g, ' ').trim();
    const shownProcesses = forge.rendered.some((text) => text.includes(FORGE_PROCESSES));
    const shownLease = forge.rendered.some((text) => text.includes(FORGE_HOLDER));
    if (!shownProcesses || !shownLease) {
      throw new Error(`the live probe the route returned was never rendered before the owner confirmed (processes shown=${shownProcesses} lease shown=${shownLease}); the page showed ${JSON.stringify(forge.rendered.slice(0, 4))} against route text ${JSON.stringify(flat.slice(0, 160))}`);
    }
  }));

  // L6h — OFF and force remain behind the force step-up rules.
  results.push(await guardedCheck('L6h', COVERED.L6h, async () => {
    if (!forge?.challengeId) {
      throw new Error(`no force challenge was ever issued from the product surface, so the step-up rules are unobservable${bootNote}${phaseNote()}`);
    }
    // The never-verified normal Off is held behind the same step-up.
    if (!latchOffCall) {
      throw new Error(`the normal Off on the never-verified ${LATCH} issued no POST`);
    }
    if (latchOffCall.status === 202) {
      throw new Error(`a never-verified normal Off actuated with no step-up: ${JSON.stringify(latchOffCall.body)}`);
    }
    const offReason = String(latchOffCall.body?.reason ?? '');
    if (!/force-confirmation-required/.test(offReason)) {
      throw new Error(`the never-verified Off was refused for ${JSON.stringify(offReason)}, not the force step-up`);
    }
    if (!latchOffRendered.some((text) => text.length > 0)) {
      throw new Error(`the never-verified Off refusal was never rendered to the owner`);
    }
    // Every --force the whole fence produced followed a CONSUMED challenge.
    const forced = allForceRows(log);
    if (forced.length !== 1) {
      throw new Error(`${forced.length} --force gateway call(s) were emitted across the fence, expected exactly the one that followed a consumed challenge: ${JSON.stringify(forced.map((r) => r.argv))}`);
    }
    if (forced[0].argv[1] !== FORGE) {
      throw new Error(`the only --force call addressed ${forced[0].argv[1]}, not the machine whose challenge was consumed (${FORGE})`);
    }
    if (!forced[0].caller.includes(String(OWNERS.one.id))) {
      throw new Error(`the --force call carried XMAC_CALLER=${JSON.stringify(forced[0].caller)}, which does not identify the owner that consumed the challenge`);
    }
    // The protected role is still refused even with force available.
    if (!warden) {
      throw new Error(`no protected-role force specimen was observed`);
    }
    if (forceRowsFor(log, WARDEN).length !== 0) {
      throw new Error(`a protected machine was forced: ${JSON.stringify(forceRowsFor(log, WARDEN).map((r) => r.argv))}`);
    }
  }, 'http-matrix'));

  // L9b — the fence asserts RENDERED refusal strings, not just route bodies.
  results.push(await guardedCheck('L9b', COVERED.L9b, async () => {
    if (refusalLedger.length < 3) {
      throw new Error(`only ${refusalLedger.length} refusal specimen(s) reached the route, so a rendered-string assertion would be vacuous${bootNote}${phaseNote()}`);
    }
    const shown = refusalLedger.filter((entry) => entry.fromRoute && entry.rendered.includes(entry.fromRoute));
    const distinct = new Set(shown.map((entry) => entry.rendered));
    if (distinct.size < 3) {
      throw new Error(`this fence asserted ${distinct.size} distinct RENDERED refusal string(s) across ${refusalLedger.length} specimens: ${JSON.stringify(refusalLedger)}`);
    }
    const fromForce = new Set(shown.filter((entry) => entry.surface === 'force').map((entry) => entry.rendered));
    if (fromForce.size < 2) {
      throw new Error(`only ${fromForce.size} distinct rendered refusal(s) came from the FORCE surface; the pre-existing normal-Off refusal alone does not show that the force flow renders what the route said: ${JSON.stringify(refusalLedger)}`);
    }
  }));

  // L9d — zero wake calls anywhere on a fake-fleet power fence.
  results.push(await guardedCheck('L9d', COVERED.L9d, async () => {
    const rows = spyRows(log);
    const spyLive = rows.some((row) => row.command === 'ping' && row.argv.includes(SELFTEST_MARKER));
    if (!spyLive) {
      throw new Error(`the gateway spy recorded no self-test row, so "zero wake calls" would be vacuous — the spy was never on PATH (rows=${rows.length})${bootNote}`);
    }
    const strayBinaries = rows.filter((row) => row.command === 'wakeonlan' || row.command === 'xmac');
    if (strayBinaries.length > 0) {
      throw new Error(`the journey reached a non-gateway power binary: ${JSON.stringify(strayBinaries.slice(0, 3))}`);
    }
    const gateway = gatewayRows(log);
    const forbidden = gateway.filter((row) => ['up', 'run', 'claim', 'release', 'wake'].includes(row.argv[0] ?? ''));
    if (forbidden.length > 0) {
      throw new Error(`a force fence issued wake or lease verbs: ${JSON.stringify(forbidden.map((r) => r.argv))}`);
    }
    const offFleet = gateway.filter((row) => !FLEET.some((machine) => machine.name === row.argv[1]));
    if (offFleet.length > 0) {
      throw new Error(`a gateway call addressed something outside the fake fleet: ${JSON.stringify(offFleet.map((r) => r.argv))}`);
    }
  }));

  // L9e — a mock-spawned argv assertion alone cannot pass a power fence.
  results.push(await guardedCheck('L9e', COVERED.L9e, async () => {
    const trail = transitionRows(transitions).filter((row) => row.machine === FORGE).map((row) => row.state);
    const stoppingAt = trail.indexOf('STOPPING');
    const downAt = trail.indexOf('DOWN');
    if (stoppingAt === -1 || downAt === -1 || downAt < stoppingAt) {
      throw new Error(`no observed UP-to-STOPPING-to-DOWN host transition for ${FORGE}: trail=${JSON.stringify(trail)}${bootNote}${phaseNote()}`);
    }
    const host = hostStateOf(statusPath, FORGE);
    if (host !== 'DOWN') {
      throw new Error(`the host state for ${FORGE} reads ${JSON.stringify(host)} after the consumed force; an argv row is not proof that a machine powered off`);
    }
    if (!forgeStateAfter) {
      throw new Error(`the product rendered no state for ${FORGE} after the host reached DOWN`);
    }
    if (/\bup\b/.test(forgeStateAfter)) {
      throw new Error(`the app still renders ${FORGE} as ${JSON.stringify(forgeStateAfter.slice(0, 80))} after the host reached DOWN, so nothing read the host state back`);
    }
  }, 'host-state'));

  // L15b — every power POST requires an idempotency key.
  results.push(await guardedCheck('L15b', COVERED.L15b, async () => {
    if (allPowerCalls.length === 0) {
      throw new Error(`the force flow issued no power POST at all, so its idempotency-key discipline is unobservable${bootNote}${phaseNote()}`);
    }
    const fromPage = allPowerCalls.filter((call) => call.idempotencyKey.trim() === '');
    if (fromPage.length > 0) {
      throw new Error(`${fromPage.length} power POST(s) from the product flow carried no Idempotency-Key: ${JSON.stringify(fromPage.map((c) => ({ url: c.url, status: c.status })).slice(0, 4))}`);
    }
    if (!forgeConfirmCall) {
      throw new Error(`no consumed-challenge POST was observed, so the key on the confirm request is unasserted`);
    }
    if (!keyless) {
      throw new Error(`the keyless control never reached the route`);
    }
    if (keyless.status !== 400 || reasonOf(keyless) !== 'idempotency-key-required') {
      throw new Error(`a force POST with no idempotency key was answered ${keyless.status} reason=${JSON.stringify(reasonOf(keyless))}, expected 400 idempotency-key-required`);
    }
  }, 'http-matrix'));

  finish('E8/D8', results, 15);
});
