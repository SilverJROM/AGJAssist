import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E10 — INTEGRATION: an owner's double-click, two open tabs, a timed-out
// request that is retried, and an ON pressed while an OFF is still running all
// produce ONE serialized gateway state transition per machine and a rendered
// in-progress state. Contributor: D7 alone, because the A10 coordinator only
// becomes observable to an owner through D7's own controls on both production
// power routes (`/power/on` and `/power/off`).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E10 and
// implements none of it; it contains no product code. It is red today because
// D7 has not landed:
//   * `src/web/public/xmachines-cost-view.js` renders a single "Turn Off"
//     button and a refusal block, and NOTHING else on the power surface. There
//     is no ON control anywhere (so an ON cannot even be submitted while an OFF
//     runs), no in-progress state after a 202 — `handleMachineDetailClick`
//     returns the payload UNCHANGED when `res.ok`, so an accepted action is
//     invisible to the owner — and no retry of a power POST that timed out, let
//     alone one that reuses the original Idempotency-Key.
//   * `e2e/xmachines-power-controls.spec.ts`, D7's own gate, does not exist.
// The A10 coordinator underneath (`src/services/xmachines/action-coordinator.ts`)
// HAS landed: it coalesces a duplicate same-action request into the in-flight
// operation, replays a repeated idempotency key onto the same operationId, and
// refuses the opposite action with `machine-busy`. So the gateway-side half of
// every id below can go green the moment D7 exposes it; what is missing is the
// owner-visible half, which is exactly D7's deliverable.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR. E10 has exactly one contributor,
// so there is exactly one acceptance test plus a structural guard on the split.
// A red CLOSE therefore names D7 in `failing_units` for every rejected id.
//
// Attribution (req-matrix.md): L15g/L15h/L15i/L15j ORIGINATE on A10, which has
// landed and is green at unit level. On THIS fence every one of them is
// asserted through the owner's rendered control surface: a coordinator that
// coalesces correctly while the page shows the owner nothing, or a surface that
// cannot submit the second half of the race at all, is a D7 defect even when
// the HTTP body is right. L9b/L9d/L9e are the fake-fleet fence class asserted
// over the same render. Exactly ONE distinct unit appears across every possible
// rejection, so a red report stays `missing_acceptance` and can never trip the
// J1c >2-unit plan_defect rule. The contract's negative control
// (FENCE_STUB=D7 --expect-red L15g) discriminates D7 through L15g.
//
// THE FAKE FLEET IS THIS JOURNEY'S OWN SERVER, NOT THE DEPLOYED APP. The
// journey spawns the real `createApiServer` in a child process with an xmac
// `status` fixture, a machines.conf fixture, an XMAC_LOG WoL fixture and a PATH
// gateway-spy that IS the fake host: the spy records every argv AND mutates the
// status fixture, so UP-to-STOPPING-to-DOWN is an observed host-state change,
// not a claim about a mock. Every fixture address is in TEST-NET-1
// (192.0.2.0/24), so no real box can be addressed. FENCE_ORIGIN is deliberately
// ignored: a fence that read a deployed origin could not arm the runtime,
// install a spy or author the WoL fixture, so nothing on this row would be
// observable.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. XMACHINES_ARM=1. The power routes answer 403 `unarmed` otherwise, so an
//     unarmed E10 could not observe a single one of its ids. Arming here reaches
//     the PATH spy on a TEST-NET address, never a machine.
//  2. L9d ("zero wake calls"). Read on this row as: the spy is proven live by a
//     self-test row; `wakeonlan`, bare `xmac`, and the `run`/`claim`/`release`/
//     `wake` gateway verbs are all zero; no gateway call addresses anything
//     outside the fake fleet; and no `up` is issued for any machine except the
//     ONE the owner explicitly submitted an ON for (E10's L15j specimen). A
//     literal zero-`up` reading would make L15j unsatisfiable by serialization,
//     which L15j's own text ("refused OR serialized") admits — so the wake
//     budget is exactly the owner's one submitted ON and nothing else. Today
//     the count is zero because no ON control exists at all.
//  3. L15j accepts EITHER outcome its acceptance text allows: a refusal
//     (`machine-busy`, rendered exactly as the route stated it) or a genuine
//     serialization. Serialization is judged on the host's own transition log:
//     the ON's STARTING entry must appear only AFTER the OFF's DOWN entry, so
//     "without overlap" is an observed ordering rather than a promise. What is
//     NOT accepted is silence — an ON control that issues no POST at all.
//  4. L15g. A double-click is dispatched as two real clicks ~250ms apart. If
//     D7's first click disables or removes the control, the second click cannot
//     land; that is a legitimate in-progress affordance, so the specimen
//     records `control-unavailable-after-first` and the id still requires (a)
//     exactly one gateway action and (b) a rendered in-progress state. If a
//     second POST IS issued it must be answered 202 and must not have spawned a
//     second gateway action. The id is red today for the rendering half.
//  5. L15i. A timed-out power POST is produced by delivering the request
//     upstream and then failing the browser's own fetch as `timedout`, which is
//     what a tunnel-dropped response looks like to the page: the server really
//     has the operation in flight, the page really saw no answer. The id then
//     requires the retry to carry the SAME Idempotency-Key (the only thing that
//     makes a retry a rejoin rather than a second action) and the gateway to
//     have recorded exactly one action. No retry at all is the failure this id
//     reports today.
//  6. L9b. This row's natural refusal specimens are the two the concurrency
//     path produces: `machine-busy` (ON during OFF) and `cooldown` (a second
//     OFF inside A10's 30s post-action cooldown). Neither carries a `detail`,
//     so "rendered exactly" is compared against the `reason` the same exchange
//     returned. Two specimens, two distinct rendered strings — asserted at that
//     strength rather than inflated with a third specimen belonging to another
//     row's guards.
//  7. No canonical DOM contract for D7 exists yet, so each control, refusal and
//     in-progress affordance is looked for across an alias set (testids,
//     data-attributes, and an accessible-text fallback inside the detail
//     section). That broadens WHERE evidence may appear; it does not weaken
//     WHAT must be true — a rendered refusal is compared for EQUALITY against
//     the string the route itself returned in the same exchange, so the journey
//     never invents copy.
//  8. Four owner identities (ids 1-4, four tokens on the same stub authService)
//     spread the specimens across the route's own per-owner 10-per-minute power
//     rate limit, so no id is red for a throttle rather than for a capability.
//     The limit itself is A6's and is asserted on E11, not here.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E10';
const ACCEPTANCE_IDS = ['L9b', 'L9d', 'L9e', 'L15g', 'L15h', 'L15i', 'L15j'];
// id -> the contributor blamed when it rejects. Exactly one distinct unit.
const COVERED: Record<string, string> = {
  L9b: 'D7', L9d: 'D7', L9e: 'D7',
  L15g: 'D7', L15h: 'D7', L15i: 'D7', L15j: 'D7',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const SELFTEST_MARKER = 'e10-spy-selftest';

// Four owner sessions on the same stub authService (ambiguity 8).
const OWNERS = {
  one: { token: 'e10-fence-owner-1', id: 1 },
  two: { token: 'e10-fence-owner-2', id: 2 },
  three: { token: 'e10-fence-owner-3', id: 3 },
  four: { token: 'e10-fence-owner-4', id: 4 },
} as const;

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media, signal, glimmer) so no assertion here can be aimed at, or
// accidentally satisfied by, a real box. Every address is TEST-NET-1.
const LATCH = 'e10-latch';    // the double-clicked OFF, then the cooldown refusal
const TANDEM = 'e10-tandem';  // the two-tab OFF
const RELAY = 'e10-relay';    // the timed-out OFF that is retried
const GATE = 'e10-gate';      // the OFF that an ON is pressed during

type Row = { name: string; ip: string; state: 'UP' | 'DOWN'; role: string };
const FLEET: Row[] = [
  { name: LATCH, ip: '192.0.2.60', state: 'UP', role: 'compute' },
  { name: TANDEM, ip: '192.0.2.61', state: 'UP', role: 'compute' },
  { name: RELAY, ip: '192.0.2.62', state: 'UP', role: 'compute' },
  { name: GATE, ip: '192.0.2.63', state: 'UP', role: 'compute' },
];

// Control, refusal and in-progress surfaces. Alias sets, not a prescribed DOM
// (ambiguity 7).
const DETAIL_SEL = '[data-testid="xmachines-machine-detail"], .xm-detail, .xmachines-view';
const OFF_SEL = [
  '[data-testid="xmachines-off-button"]',
  '[data-testid="xmachines-power-off"]',
  '[data-testid="xmachines-power-off-button"]',
  '[data-action="power-off"]',
  'button[data-power="off"]',
].join(', ');
const ON_SEL = [
  '[data-testid="xmachines-on-button"]',
  '[data-testid="xmachines-power-on"]',
  '[data-testid="xmachines-power-on-button"]',
  '[data-action="power-on"]',
  'button[data-power="on"]',
].join(', ');
const REFUSAL_SEL = [
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
const PROGRESS_SEL = [
  '[data-testid="xmachines-power-progress"]',
  '[data-testid="xmachines-power-inprogress"]',
  '[data-testid="xmachines-action-status"]',
  '[data-testid="xmachines-power-pending"]',
  '[data-power-progress]',
  '[data-status="in-progress"]',
].join(', ');

const OFF_TEXT = /^(turn off|power off|off|shut ?down)$/i;
const ON_TEXT = /^(turn on|power on|on|start|wake)$/i;
const PROGRESS_TEXT = /in[\s-]?progress|starting|stopping|pending|working/i;

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
// then mutates the status fixture and the transition log, so a power action has
// an observable HOST-STATE consequence. That is what makes L9e's `via` honest —
// the journey reads the host's state back, it does not read a mock's argv and
// declare the machine off. Each transition is deliberately SLOW (seconds), so
// the second half of every race below really does arrive while the first action
// is still in flight.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  bin: string;
  spyLog: string;
  sshLog: string;
  statusPath: string;
  confPath: string;
  metricsPath: string;
  stateDir: string;
  xmacLog: string;
  transitions: string;
  protectedDir: string;
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

// The gateway-spy that is also the fake host. A transition takes seconds and
// writes STOPPING/DOWN (or STARTING/UP) into the transition log, so "one
// serialized state transition" is a property of the observed host.
function gatewayScript(): string {
  return `#!/bin/bash
set -u
log="\${E10_SPY_LOG}"
status="\${E10_STATUS_FIXTURE}"
trans="\${E10_TRANSITIONS_LOG}"
slow="\${E10_SLOW_MACHINE}"
{
  printf '%s' 'xmac.sh'
  printf '\\t%s' "\${XMAC_CALLER-}"
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> "$log"

verb="\${1-}"
machine="\${2-}"

note() { printf '%s\\t%s\\t%s\\t%s\\n' "$machine" "$1" "$(date -u +%FT%T.%NZ)" "$verb" >> "$trans"; }
set_state() {
  tmp="$status.\$\$"
  awk -v m="$machine" -v s="$1" '{ if (\$1 == m) { \$3 = s } ; print }' "$status" > "$tmp" && mv "$tmp" "$status"
}

dwell=4
if [ "$machine" = "$slow" ]; then dwell=8; fi

case "$verb" in
  up)
    note STARTING
    sleep "$dwell"
    set_state UP
    note UP
    ;;
  down)
    note STOPPING
    sleep "$dwell"
    set_state DOWN
    note DOWN
    ;;
esac
exit 0
`;
}

// The busy preflight's ssh. A1/A13 run `bash -c "ssh ... user@ip bash -c '...'"`.
// Every machine on this fence is idle: empty stdout, exit 0, which is the only
// shape the fail-closed preflight accepts. The busy/timeout/unreachable shapes
// belong to E4, not here — a refusal before launch would leave this row with no
// concurrency to observe.
function sshScript(): string {
  return `#!/bin/bash
set -u
log="\${E10_SSH_LOG}"
{
  printf '%s' 'ssh'
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> "$log"
exit 0
`;
}

function statusLines(rows: Row[]): string {
  return `${rows.map((row) => `${row.name} ${row.ip} ${row.state} leases=() ${row.role}`).join('\n')}\n`;
}

function confLines(rows: Row[]): string {
  // A non-empty busy-check on every row, so the fail-closed preflight really
  // runs before every OFF instead of being skipped as unconfigured.
  return `${rows
    .map((row, i) => `${row.name}|${row.ip}|02:00:00:00:00:${60 + i}|agjrom|${row.role}|echo e10-fixture-busy-check`)
    .join('\n')}\n`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Verified WoL evidence (a WAKE followed by a later UP) for every machine, so
// no OFF on this fence is routed into a force challenge — that is E4/E8's row.
function wolLog(): string {
  const now = Date.now();
  const lines: string[] = [];
  for (const row of FLEET) {
    lines.push(`${stamp(now - 30 * 60 * 1000)} WAKE ${row.name} 1`);
    lines.push(`${stamp(now - 20 * 60 * 1000)} UP ${row.name} 1`);
  }
  return `${lines.join('\n')}\n`;
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e10-concurrency-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const spyLog = path.join(dir, 'gateway-argv.log');
  const sshLog = path.join(dir, 'ssh-argv.log');
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
  const transitions = path.join(dir, 'transitions.log');
  const protectedDir = path.join(dir, 'protected');

  fs.writeFileSync(statusPath, statusLines(FLEET));
  fs.writeFileSync(confPath, confLines(FLEET));
  fs.writeFileSync(
    metricsPath,
    JSON.stringify(Object.fromEntries(FLEET.map((row) => [row.name, {
      gpuTempsC: [52], gpuPowerWatts: [90], uptime: '2d 3h 4m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '20s', cpuTemp: 41,
    }]))),
  );
  fs.writeFileSync(transitions, '');
  fs.writeFileSync(xmacLog, wolLog());
  fs.mkdirSync(path.join(stateDir, 'leases'), { recursive: true });

  // No machine on this fence is leased or protected: a guard refusal before
  // launch would leave the concurrency race with nothing to serialize.
  fs.mkdirSync(protectedDir, { recursive: true });
  fs.writeFileSync(
    path.join(protectedDir, 'status.json'),
    JSON.stringify(Object.fromEntries(FLEET.map((row) => [row.name, { ip: row.ip }]))),
  );
  fs.writeFileSync(path.join(protectedDir, 'roles.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(protectedDir, 'leases.json'), JSON.stringify({ names: [] }));
  fs.writeFileSync(path.join(protectedDir, 'schedule.json'), JSON.stringify({}));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_ARM: '1',
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMACHINES_PROTECTED_FIXTURE_DIR: protectedDir,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    XMAC_LOG: xmacLog,
    XMAC_USER: 'agjrom',
    XMACHINES_UP_SECONDS: '3600',
    E10_SPY_LOG: spyLog,
    E10_SSH_LOG: sshLog,
    E10_STATUS_FIXTURE: statusPath,
    E10_TRANSITIONS_LOG: transitions,
    E10_SLOW_MACHINE: RELAY,
    E10_OWNER_TOKEN_ONE: OWNERS.one.token,
    E10_OWNER_TOKEN_TWO: OWNERS.two.token,
    E10_OWNER_TOKEN_THREE: OWNERS.three.token,
    E10_OWNER_TOKEN_FOUR: OWNERS.four.token,
  };
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  return { dir, bin, spyLog, sshLog, statusPath, confPath, metricsPath, stateDir, xmacLog, transitions, protectedDir, env };
}

type SpyRow = { command: string; caller: string; argv: string[] };

function spyRows(log: string): SpyRow[] {
  if (!log || !fs.existsSync(log)) return [];
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

function verbRowsFor(log: string, verb: string, machine: string): SpyRow[] {
  return gatewayRows(log).filter((row) => row.argv[0] === verb && row.argv[1] === machine);
}

type Transition = { machine: string; state: string; at: string; verb: string };

function transitionRows(file: string): Transition[] {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [machine, state, at, verb] = line.split('\t');
      return { machine: machine ?? '', state: state ?? '', at: at ?? '', verb: verb ?? '' };
    });
}

function trailFor(file: string, machine: string): Transition[] {
  return transitionRows(file).filter((row) => row.machine === machine);
}

function hostStateOf(statusPath: string, machine: string): string {
  const text = statusPath && fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8') : '';
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] === machine) return (tokens[2] ?? '').toUpperCase();
  }
  return '';
}

async function waitForHostState(statusPath: string, machine: string, want: string, timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hostStateOf(statusPath, machine) === want) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function waitForGatewayRow(log: string, predicate: (row: SpyRow) => boolean, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gatewayRows(log).some(predicate)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
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
  [process.env.E10_OWNER_TOKEN_ONE, { id: 1, role: 'owner', username: 'owner' }],
  [process.env.E10_OWNER_TOKEN_TWO, { id: 2, role: 'owner', username: 'owner2' }],
  [process.env.E10_OWNER_TOKEN_THREE, { id: 3, role: 'owner', username: 'owner3' }],
  [process.env.E10_OWNER_TOKEN_FOUR, { id: 4, role: 'owner', username: 'owner4' }],
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
console.log('E10-SERVER-READY ' + app.server.address().port);
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
    const match = out.match(/E10-SERVER-READY (\d+)/);
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
  action: string;
  method: string;
  status: number;
  body: Record<string, unknown> | null;
  idempotencyKey: string;
};

type Detail = {
  page: import('@playwright/test').Page;
  close: () => Promise<void>;
  calls: PowerCall[];
};

const POWER_URL_RE = /\/api\/xmachines\/machines\/[^/]+\/power\/(on|off|force)$/;

let base = '';
let bootError = '';

function actionOf(url: string): string {
  const match = url.match(POWER_URL_RE);
  return match ? match[1] : '';
}

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
    if (!POWER_URL_RE.test(url)) return;
    const request = response.request();
    const headers = await request.allHeaders().catch(() => ({} as Record<string, string>));
    let body: Record<string, unknown> | null = null;
    try { body = (await response.json()) as Record<string, unknown>; } catch { body = null; }
    calls.push({
      url,
      action: actionOf(url),
      method: request.method(),
      status: response.status(),
      body,
      idempotencyKey: headers['idempotency-key'] ?? headers['x-idempotency-key'] ?? '',
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
  await page.waitForTimeout(800);
  return { page, close: () => context.close(), calls };
}

// The visible, pressable control — an alias selector first, then an
// accessible-text fallback inside the detail section (ambiguity 7).
async function findControl(
  page: import('@playwright/test').Page,
  selector: string,
  textRe: RegExp,
): Promise<{ node: import('@playwright/test').Locator; how: string } | null> {
  const direct = page.locator(selector);
  const count = await direct.count();
  for (let i = 0; i < count; i++) {
    const node = direct.nth(i);
    if (await node.isVisible().catch(() => false)) return { node, how: 'selector' };
  }
  const buttons = page.locator(`${DETAIL_SEL} button, ${DETAIL_SEL} [role="button"]`);
  const buttonCount = await buttons.count();
  for (let i = 0; i < buttonCount; i++) {
    const node = buttons.nth(i);
    if (!(await node.isVisible().catch(() => false))) continue;
    const label = ((await node.textContent().catch(() => '')) || '').trim();
    const aria = (await node.getAttribute('aria-label').catch(() => '')) || '';
    if (textRe.test(label) || textRe.test(aria)) return { node, how: `text:${label || aria}` };
  }
  return null;
}

async function clickControl(
  page: import('@playwright/test').Page,
  selector: string,
  textRe: RegExp,
): Promise<string> {
  const found = await findControl(page, selector, textRe);
  if (!found) return '';
  await found.node.click({ timeout: 5_000 });
  return found.how;
}

async function texts(page: import('@playwright/test').Page, selector: string): Promise<string[]> {
  return page.$$eval(selector, (nodes) => nodes.map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()));
}

async function renderedState(page: import('@playwright/test').Page): Promise<string> {
  const found = await texts(page, STATE_SEL);
  return (found[0] ?? '').toLowerCase();
}

async function detailBodyText(page: import('@playwright/test').Page): Promise<string> {
  const body = (await page.locator('body').textContent().catch(() => '')) || '';
  return body.replace(/\s+/g, ' ').trim();
}

async function progressShown(page: import('@playwright/test').Page): Promise<{ shown: boolean; nodes: string[]; body: string }> {
  const nodes = (await texts(page, PROGRESS_SEL).catch(() => [] as string[])).filter((text) => text.length > 0);
  const body = await detailBodyText(page);
  return { shown: nodes.length > 0 || PROGRESS_TEXT.test(body), nodes, body };
}

// Every rendered refusal this fence observed, with the string the route
// returned in the SAME exchange. L9b is asserted over this ledger.
const refusalLedger: Array<{ machine: string; action: string; rendered: string; fromRoute: string }> = [];

function routeRefusalString(call: PowerCall | undefined): string {
  if (!call) return '';
  const body = call.body ?? {};
  if (typeof body.detail === 'string' && body.detail.length > 0) return body.detail;
  if (typeof body.reason === 'string' && body.reason.length > 0) return body.reason;
  return '';
}

function recordRefusal(machine: string, call: PowerCall | undefined, refusals: string[]): string {
  const fromRoute = routeRefusalString(call);
  const rendered = refusals.find((text) => fromRoute && text === fromRoute)
    ?? refusals.find((text) => fromRoute && text.includes(fromRoute))
    ?? '';
  refusalLedger.push({ machine, action: call?.action ?? '', rendered, fromRoute });
  return fromRoute;
}

function lastCall(calls: PowerCall[], action: string): PowerCall | undefined {
  return calls.filter((call) => call.action === action).pop();
}

// ---------------------------------------------------------------------------
// One server for the whole fence. Boot failure is CAPTURED, not thrown: a throw
// here would abort collection and the driver would see an env error instead of
// a proving assertion failure.
// ---------------------------------------------------------------------------
let scratch: Scratch | null = null;
let server: Server | null = null;
let proxy: { base: string; close: () => Promise<void> } | null = null;

test.beforeAll(async () => {
  try {
    scratch = newScratch();
    // Spy self-test BEFORE anything is served, so "zero forbidden calls" is a
    // real observation and not an artefact of a spy that was never on PATH.
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
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (scratch) fs.rmSync(scratch.dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Structural guard on the split itself: the per-contributor test below must
// cover exactly the row's acceptance ids, each once, naming exactly the one
// contributor the contract lists.
// ---------------------------------------------------------------------------
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
  const units = new Set(Object.values(COVERED));
  if (units.size !== 1 || !units.has('D7')) {
    throw new Error(`fence ${FENCE_ID}: rejections must name exactly the 1 contributor D7, found ${JSON.stringify([...units])}`);
  }
});

// ---------------------------------------------------------------------------
// D7 — the owner's power controls under concurrency, driven through the
// production on/off routes: a double-click, two open tabs, a timed-out request
// that is retried, and an ON pressed during an OFF each collapse to ONE
// serialized host transition, with the in-progress state and every refusal
// rendered for the owner.
// Owns: L9b L9d L9e L15g L15h L15i L15j
// ---------------------------------------------------------------------------
test('test_d7_concurrent_power_presses_serialize_to_one_gateway_action_and_render_in_progress', async ({ browser }) => {
  test.setTimeout(150_000);
  const results: boolean[] = [];
  const log = scratch?.spyLog ?? '';
  const statusPath = scratch?.statusPath ?? '';
  const transitions = scratch?.transitions ?? '';
  const bootNote = bootError ? ` [${bootError}]` : '';

  // ---- L15g: the double-clicked OFF ---------------------------------------
  type DoubleClick = {
    first: string;
    second: string;
    calls: PowerCall[];
    progress: { shown: boolean; nodes: string[]; body: string };
  };
  let dbl: DoubleClick | null = null;
  let latchStopping = false;
  if (!bootError) {
    try {
      const detail = await openDetail(browser, LATCH, OWNERS.one);
      try {
        const found = await findControl(detail.page, OFF_SEL, OFF_TEXT);
        const first = found ? found.how : '';
        if (found) await found.node.click({ timeout: 5_000 });
        let second = '';
        if (found) {
          await detail.page.waitForTimeout(250);
          try {
            // force:true so an overlay or a re-render does not silently swallow
            // the second press; a control D7 removed or disabled on the first
            // click is recorded as such (ambiguity 4), not as a missing press.
            await found.node.click({ timeout: 3_000, force: true });
            second = 'clicked';
          } catch {
            second = 'control-unavailable-after-first';
          }
        }
        await detail.page.waitForTimeout(1_500);
        dbl = {
          first,
          second,
          calls: [...detail.calls],
          progress: await progressShown(detail.page),
        };
      } finally {
        await detail.close();
      }
    } catch (error) {
      dbl = null;
      if (!bootError) bootError = `double-click specimen unavailable: ${(error as Error).message}`;
    }
    latchStopping = await waitForGatewayRow(log, (row) => row.argv[0] === 'down' && row.argv[1] === LATCH);
  }

  results.push(await guardedCheck('L15g', COVERED.L15g, async () => {
    if (!dbl) throw new Error(`no double-click specimen was observed${bootNote}`);
    if (!dbl.first) {
      throw new Error(`no visible Off control on the ${LATCH} detail page (tried ${OFF_SEL} and an ${OFF_TEXT} text fallback); a double-click cannot be submitted at all`);
    }
    const offCalls = dbl.calls.filter((call) => call.action === 'off');
    if (offCalls.length === 0) {
      throw new Error(`the double-clicked Off issued no POST to the production power/off route (calls=${JSON.stringify(dbl.calls.map((c) => c.url))})`);
    }
    if (offCalls[0].status !== 202) {
      throw new Error(`the first Off answered ${offCalls[0].status} ${JSON.stringify(offCalls[0].body)}, expected 202 in-progress`);
    }
    const rows = verbRowsFor(log, 'down', LATCH);
    if (rows.length !== 1) {
      throw new Error(`a double-click produced ${rows.length} gateway actions for ${LATCH}, expected exactly 1: ${JSON.stringify(rows.map((r) => r.argv))}`);
    }
    if (offCalls.length > 1) {
      const dupes = offCalls.slice(1);
      const notCoalesced = dupes.filter((call) => call.status !== 202);
      if (notCoalesced.length > 0) {
        throw new Error(`the duplicate click was not coalesced into the in-flight action: ${JSON.stringify(notCoalesced.map((c) => ({ status: c.status, body: c.body })))}`);
      }
      const keys = new Set(offCalls.map((call) => call.idempotencyKey.trim()));
      if (keys.has('')) {
        throw new Error(`a double-clicked power POST carried no Idempotency-Key, so coalescing rests on timing alone: ${JSON.stringify(offCalls.map((c) => c.idempotencyKey))}`);
      }
    }
    if (!dbl.progress.shown) {
      throw new Error(`the accepted Off rendered no in-progress state for the owner, so a second click is invited by the UI itself (tried ${PROGRESS_SEL} and a ${PROGRESS_TEXT} text fallback; second press was ${JSON.stringify(dbl.second)})`);
    }
  }));

  // ---- L9e / L9b: the host really moves, then refuses a second Off ---------
  const latchReachedDown = bootError ? false : await waitForHostState(statusPath, LATCH, 'DOWN');
  let latchAfter: { state: string; bodyText: string } | null = null;
  let cooldown: { clicked: string; calls: PowerCall[]; refusals: string[] } | null = null;
  if (!bootError) {
    try {
      const detail = await openDetail(browser, LATCH, OWNERS.one);
      try {
        latchAfter = { state: await renderedState(detail.page), bodyText: await detailBodyText(detail.page) };
        // A second Off inside A10's 30s post-action cooldown: the route's own
        // refusal, which the owner must be shown.
        const clicked = await clickControl(detail.page, OFF_SEL, OFF_TEXT);
        if (clicked) await detail.page.waitForTimeout(2_000);
        cooldown = { clicked, calls: [...detail.calls], refusals: await texts(detail.page, REFUSAL_SEL) };
      } finally {
        await detail.close();
      }
    } catch {
      cooldown = null;
    }
  }
  if (cooldown) recordRefusal(LATCH, lastCall(cooldown.calls, 'off'), cooldown.refusals);

  // ---- L15h: two tabs on the same machine ---------------------------------
  type TwoTab = {
    clicks: string[];
    calls: PowerCall[];
    progress: Array<{ shown: boolean; nodes: string[]; body: string }>;
  };
  let tabs: TwoTab | null = null;
  if (!bootError) {
    try {
      const left = await openDetail(browser, TANDEM, OWNERS.two);
      const right = await openDetail(browser, TANDEM, OWNERS.two);
      try {
        const clicks = await Promise.all([
          clickControl(left.page, OFF_SEL, OFF_TEXT),
          clickControl(right.page, OFF_SEL, OFF_TEXT),
        ]);
        await left.page.waitForTimeout(1_800);
        tabs = {
          clicks,
          calls: [...left.calls, ...right.calls],
          progress: [await progressShown(left.page), await progressShown(right.page)],
        };
      } finally {
        await left.close();
        await right.close();
      }
    } catch (error) {
      tabs = null;
      bootError = bootError || `two-tab specimen unavailable: ${(error as Error).message}`;
    }
  }

  results.push(await guardedCheck('L15h', COVERED.L15h, async () => {
    if (!tabs) throw new Error(`no two-tab specimen was observed${bootNote}`);
    const pressed = tabs.clicks.filter((how) => how.length > 0);
    if (pressed.length < 2) {
      throw new Error(`only ${pressed.length} of 2 tabs had a pressable Off control for ${TANDEM} (tried ${OFF_SEL}); two tabs cannot race if only one can act`);
    }
    const offCalls = tabs.calls.filter((call) => call.action === 'off');
    if (offCalls.length < 2) {
      throw new Error(`the two tabs issued ${offCalls.length} power/off POST(s), expected 2 (calls=${JSON.stringify(tabs.calls.map((c) => ({ url: c.url, status: c.status })))})`);
    }
    const rows = verbRowsFor(log, 'down', TANDEM);
    if (rows.length !== 1) {
      throw new Error(`two tabs produced ${rows.length} gateway actions for ${TANDEM}, expected exactly 1: ${JSON.stringify(rows.map((r) => r.argv))}`);
    }
    const refused = offCalls.filter((call) => call.status !== 202);
    if (refused.length > 0) {
      throw new Error(`a second tab's Off was answered ${JSON.stringify(refused.map((c) => ({ status: c.status, body: c.body })))}; the coordinator serializes same-action requests into the in-flight operation, it does not reject the other tab`);
    }
    const operationIds = new Set(offCalls.map((call) => String(call.body?.operationId ?? '')));
    if (operationIds.has('') || operationIds.size !== 1) {
      throw new Error(`the two tabs were not joined to one operation: operationIds=${JSON.stringify([...operationIds])}`);
    }
    const blind = tabs.progress.filter((entry) => !entry.shown);
    if (blind.length > 0) {
      throw new Error(`${blind.length} of 2 tabs rendered no in-progress state for the action they joined (tried ${PROGRESS_SEL} and a ${PROGRESS_TEXT} text fallback)`);
    }
  }));

  // ---- L15i: the timed-out POST that is retried ---------------------------
  type Intercepted = { url: string; action: string; key: string; status: number; body: Record<string, unknown> | null; outcome: string };
  let retry: { clicked: string; intercepted: Intercepted[] } | null = null;
  if (!bootError) {
    try {
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      const page = await context.newPage();
      const intercepted: Intercepted[] = [];
      let firstSeen = false;
      await page.route(/telegram-web-app\.js/, (route) => route.abort());
      await page.route(POWER_URL_RE, async (route) => {
        const request = route.request();
        const headers = await request.allHeaders().catch(() => ({} as Record<string, string>));
        const key = headers['idempotency-key'] ?? headers['x-idempotency-key'] ?? '';
        const isFirst = !firstSeen;
        firstSeen = true;
        let status = 0;
        let body: Record<string, unknown> | null = null;
        let response: import('@playwright/test').APIResponse | null = null;
        try {
          response = await route.fetch();
          status = response.status();
          try { body = (await response.json()) as Record<string, unknown>; } catch { body = null; }
        } catch { /* delivery itself failed; recorded as status 0 */ }
        intercepted.push({
          url: request.url(),
          action: actionOf(request.url()),
          key,
          status,
          body,
          outcome: isFirst ? 'timedout' : 'delivered',
        });
        if (isFirst) {
          // The request really reached the server; the page really never saw an
          // answer. That is what a tunnel-dropped response looks like to the UI.
          await route.abort('timedout');
          return;
        }
        if (response) await route.fulfill({ response });
        else await route.abort('failed');
      });
      await page.addInitScript(([token, id]) => {
        try {
          localStorage.setItem('agj_token', token as string);
          localStorage.setItem('agj_user', JSON.stringify({ id, name: 'owner', username: 'owner', role: 'owner' }));
        } catch { /* ignore */ }
      }, [OWNERS.three.token, OWNERS.three.id] as [string, number]);
      await page.goto(`${base}/index.html#/xmachines/${RELAY}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(DETAIL_SEL, { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(800);
      const clicked = await clickControl(page, OFF_SEL, OFF_TEXT);
      // Long enough for a retry the UI schedules after the failed fetch to land
      // while the 8s RELAY transition is still in flight.
      if (clicked) await page.waitForTimeout(6_000);
      retry = { clicked, intercepted: [...intercepted] };
      await context.close();
    } catch (error) {
      retry = null;
      bootError = bootError || `timeout-retry specimen unavailable: ${(error as Error).message}`;
    }
  }

  results.push(await guardedCheck('L15i', COVERED.L15i, async () => {
    if (!retry) throw new Error(`no timeout-retry specimen was observed${bootNote}`);
    if (!retry.clicked) {
      throw new Error(`no visible Off control on the ${RELAY} detail page (tried ${OFF_SEL}); a retry cannot be observed if the first attempt cannot be made`);
    }
    const offs = retry.intercepted.filter((row) => row.action === 'off');
    if (offs.length === 0) {
      throw new Error(`the Off issued no power/off POST at all (intercepted=${JSON.stringify(retry.intercepted)})`);
    }
    if (offs[0].status !== 202) {
      throw new Error(`the first Off was answered ${offs[0].status} ${JSON.stringify(offs[0].body)} before its response was dropped, expected 202 in-progress`);
    }
    if (!offs[0].key.trim()) {
      throw new Error(`the first Off carried no Idempotency-Key, so no retry could ever rejoin it`);
    }
    if (offs.length < 2) {
      throw new Error(`the owner's Off timed out and the UI never retried it: only ${offs.length} power/off POST was issued, so a dropped response leaves the owner with no way to rejoin an action that IS already running`);
    }
    const retried = offs[1];
    if (retried.key.trim() !== offs[0].key.trim()) {
      throw new Error(`the retry carried a NEW Idempotency-Key (${JSON.stringify(offs[0].key)} then ${JSON.stringify(retried.key)}); a fresh key is a second action request, not a rejoin`);
    }
    if (retried.status !== 202) {
      throw new Error(`the retry was answered ${retried.status} ${JSON.stringify(retried.body)}, expected 202 in-progress rejoining the existing action`);
    }
    const firstOp = String(offs[0].body?.operationId ?? '');
    const retriedOp = String(retried.body?.operationId ?? '');
    if (!firstOp || retriedOp !== firstOp) {
      throw new Error(`the retry did not rejoin the existing operation: first operationId=${JSON.stringify(firstOp)}, retry operationId=${JSON.stringify(retriedOp)}`);
    }
    const rows = verbRowsFor(log, 'down', RELAY);
    if (rows.length !== 1) {
      throw new Error(`a retried Off produced ${rows.length} gateway actions for ${RELAY}, expected exactly 1: ${JSON.stringify(rows.map((r) => r.argv))}`);
    }
  }));

  // ---- L15j: ON pressed while the OFF is still running --------------------
  type OnDuringOff = {
    offClicked: string;
    onClicked: string;
    calls: PowerCall[];
    refusals: string[];
    bodyText: string;
  };
  let overlap: OnDuringOff | null = null;
  if (!bootError) {
    try {
      const detail = await openDetail(browser, GATE, OWNERS.four);
      try {
        const offClicked = await clickControl(detail.page, OFF_SEL, OFF_TEXT);
        if (offClicked) await detail.page.waitForTimeout(700);
        // Still inside GATE's 4s transition: the OFF is genuinely in flight.
        const onClicked = await clickControl(detail.page, ON_SEL, ON_TEXT);
        await detail.page.waitForTimeout(2_000);
        overlap = {
          offClicked,
          onClicked,
          calls: [...detail.calls],
          refusals: await texts(detail.page, REFUSAL_SEL),
          bodyText: await detailBodyText(detail.page),
        };
      } finally {
        await detail.close();
      }
    } catch (error) {
      overlap = null;
      bootError = bootError || `on-during-off specimen unavailable: ${(error as Error).message}`;
    }
  }
  if (overlap?.onClicked) recordRefusal(GATE, lastCall(overlap.calls, 'on'), overlap.refusals);
  // Let any serialized ON finish before the ordering is judged.
  if (!bootError && overlap?.onClicked) {
    await waitForHostState(statusPath, GATE, 'UP', 20_000);
  }

  results.push(await guardedCheck('L15j', COVERED.L15j, async () => {
    if (!overlap) throw new Error(`no ON-during-OFF specimen was observed${bootNote}`);
    if (!overlap.offClicked) {
      throw new Error(`no visible Off control on the ${GATE} detail page (tried ${OFF_SEL}); nothing can be raced against`);
    }
    const offCall = lastCall(overlap.calls, 'off');
    if (offCall?.status !== 202) {
      throw new Error(`the Off that the ON must not overlap answered ${offCall?.status} ${JSON.stringify(offCall?.body)}, expected 202 in-progress`);
    }
    if (!overlap.onClicked) {
      throw new Error(`no visible ON control on the ${GATE} detail page (tried ${ON_SEL} and an ${ON_TEXT} text fallback); an owner cannot press ON during an OFF at all, so the coordinator's machine-busy refusal is unreachable from the product`);
    }
    const onCall = lastCall(overlap.calls, 'on');
    if (!onCall) {
      throw new Error(`the ON control issued no POST to the production power/on route (calls=${JSON.stringify(overlap.calls.map((c) => ({ url: c.url, status: c.status })))})`);
    }
    const trail = trailFor(transitions, GATE);
    const downAt = trail.findIndex((row) => row.state === 'DOWN' && row.verb === 'down');
    const startingAt = trail.findIndex((row) => row.state === 'STARTING' && row.verb === 'up');
    if (onCall.status === 400) {
      // Refused: the exact reason the route gave must be on the owner's screen.
      if (onCall.body?.reason !== 'machine-busy') {
        throw new Error(`the ON during an OFF was refused as ${JSON.stringify(onCall.body)}, expected reason=machine-busy`);
      }
      const fromRoute = routeRefusalString(onCall);
      if (!overlap.refusals.some((text) => text === fromRoute)) {
        throw new Error(`the machine-busy refusal was not rendered exactly: route said ${JSON.stringify(fromRoute)}, rendered ${JSON.stringify(overlap.refusals)}`);
      }
      if (verbRowsFor(log, 'up', GATE).length !== 0) {
        throw new Error(`a refused ON still reached the gateway: ${JSON.stringify(verbRowsFor(log, 'up', GATE).map((r) => r.argv))}`);
      }
      return;
    }
    if (onCall.status === 202) {
      // Serialized: admissible only if the wake began after the OFF finished.
      if (startingAt === -1) {
        throw new Error(`the ON was accepted (202) but the host never started: transition trail for ${GATE} is ${JSON.stringify(trail.map((r) => r.state))}`);
      }
      if (downAt === -1 || startingAt < downAt) {
        throw new Error(`an accepted ON overlapped the running OFF: transition trail for ${GATE} is ${JSON.stringify(trail.map((r) => `${r.verb}:${r.state}`))} — a serialized ON must not start before the OFF reached DOWN`);
      }
      if (verbRowsFor(log, 'up', GATE).length !== 1) {
        throw new Error(`a serialized ON produced ${verbRowsFor(log, 'up', GATE).length} gateway wakes for ${GATE}, expected exactly 1`);
      }
      return;
    }
    throw new Error(`the ON during an OFF was answered ${onCall.status} ${JSON.stringify(onCall.body)}; L15j admits a machine-busy refusal or a serialized 202, nothing else`);
  }));

  // ---- the fence-class assertions over the same render --------------------
  results.push(await guardedCheck('L9b', COVERED.L9b, async () => {
    if (refusalLedger.length < 2) {
      throw new Error(`only ${refusalLedger.length} refusal specimen(s) were observed, so a rendered-string assertion would be vacuous${bootNote} (this row's refusals are the cooldown Off on ${LATCH} and the machine-busy ON on ${GATE})`);
    }
    const noRouteString = refusalLedger.filter((entry) => !entry.fromRoute);
    if (noRouteString.length > 0) {
      throw new Error(`these specimens produced no route-side refusal string at all: ${JSON.stringify(noRouteString.map((e) => `${e.machine}/${e.action}`))}`);
    }
    const inexact = refusalLedger.filter((entry) => entry.rendered !== entry.fromRoute);
    if (inexact.length > 0) {
      throw new Error(`the UI did not render the exact refusal the route returned for ${JSON.stringify(inexact.map((e) => ({ machine: e.machine, action: e.action, route: e.fromRoute, rendered: e.rendered })))}`);
    }
    const distinct = new Set(refusalLedger.map((entry) => entry.rendered));
    if (distinct.size < 2) {
      throw new Error(`this fence asserted ${distinct.size} distinct RENDERED refusal string(s) across ${refusalLedger.length} specimens: ${JSON.stringify(refusalLedger)}`);
    }
  }));

  results.push(await guardedCheck('L9d', COVERED.L9d, async () => {
    const rows = spyRows(log);
    const spyLive = rows.some((row) => row.command === 'ping' && row.argv.includes(SELFTEST_MARKER));
    if (!spyLive) {
      throw new Error(`the gateway spy recorded no self-test row, so "no forbidden calls" would be vacuous — the spy was never on PATH (rows=${rows.length})${bootNote}`);
    }
    const bypass = rows.filter((row) => row.command === 'wakeonlan' || row.command === 'xmac');
    if (bypass.length > 0) {
      throw new Error(`the journey reached a non-gateway power binary: ${JSON.stringify(bypass.slice(0, 3))}`);
    }
    const gateway = gatewayRows(log);
    const forbidden = gateway.filter((row) => ['run', 'claim', 'release', 'wake'].includes(row.argv[0] ?? ''));
    if (forbidden.length > 0) {
      throw new Error(`the journey issued forbidden gateway verbs: ${JSON.stringify(forbidden.map((r) => r.argv))}`);
    }
    // The only admissible wake on this fence is the owner's one submitted ON of
    // GATE, and only if L15j's serialization branch was taken (ambiguity 2).
    const strayWakes = gateway.filter((row) => row.argv[0] === 'up' && row.argv[1] !== GATE);
    if (strayWakes.length > 0) {
      throw new Error(`this fence woke a machine no owner submitted an ON for: ${JSON.stringify(strayWakes.map((r) => r.argv))}`);
    }
    const gateWakes = gateway.filter((row) => row.argv[0] === 'up' && row.argv[1] === GATE);
    if (gateWakes.length > 1) {
      throw new Error(`one submitted ON produced ${gateWakes.length} wakes of ${GATE}: ${JSON.stringify(gateWakes.map((r) => r.argv))}`);
    }
    const offFleet = gateway.filter((row) => !FLEET.some((machine) => machine.name === row.argv[1]));
    if (offFleet.length > 0) {
      throw new Error(`a gateway call addressed something outside the fake fleet: ${JSON.stringify(offFleet.map((r) => r.argv))}`);
    }
  }));

  results.push(await guardedCheck('L9e', COVERED.L9e, async () => {
    // The point of this id: the proof that the machine went off is the HOST's
    // own state, read back after the action. An argv row alone is refused —
    // and on THIS fence the same reading is what makes "one serialized state
    // transition" observable: one STOPPING, one DOWN, from many presses.
    if (!latchStopping) {
      throw new Error(`the gateway spy recorded no 'down ${LATCH}', so no host transition was started to observe${bootNote}`);
    }
    const trail = trailFor(transitions, LATCH).map((row) => row.state);
    const stoppings = trail.filter((state) => state === 'STOPPING').length;
    const downs = trail.filter((state) => state === 'DOWN').length;
    if (stoppings !== 1 || downs !== 1) {
      throw new Error(`the double-clicked Off produced ${stoppings} STOPPING and ${downs} DOWN host transition(s) for ${LATCH}, expected exactly one of each: trail=${JSON.stringify(trail)}`);
    }
    if (trail.indexOf('DOWN') < trail.indexOf('STOPPING')) {
      throw new Error(`no observed UP-to-STOPPING-to-DOWN host transition for ${LATCH}: trail=${JSON.stringify(trail)}`);
    }
    if (!latchReachedDown || hostStateOf(statusPath, LATCH) !== 'DOWN') {
      throw new Error(`the host state for ${LATCH} reads ${JSON.stringify(hostStateOf(statusPath, LATCH))} after the Off; an argv row is not proof that a machine powered off`);
    }
    const state = latchAfter?.state ?? '';
    if (!state || /\bup\b/.test(state)) {
      throw new Error(`the app still renders ${LATCH} as ${JSON.stringify(state)} after the host reached DOWN, so nothing read the host state back`);
    }
  }, 'host-state'));

  finish('E10/D7', results, 7);
});
