import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E9 — INTEGRATION: production ON, normal-OFF and force attempts against
// a fake fleet create complete, append-only audit rows, and the OWNER-ONLY
// power audit view renders every outcome class — allowed (on / off / force),
// denied, replayed and rate-limited — with the complete stored details.
//
// Contributor: D9 alone ("render the owner-only power audit view after
// production ON, normal-OFF and force attempts, including complete details for
// allowed, denied, replayed and rate-limited outcomes"). Its path transitively
// exercises C3 (the ON route), C4 (the normal-OFF route), C5/the force
// rejection path and C6 (the owner-only audit read route), which is why one
// contributor carries the whole row.
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E9 and
// implements none of it; it contains no product code. It is red today because
// D9 has not landed:
//   * There is NO power audit view anywhere in the product. `src/web/public/`
//     contains exactly one xmachines module, `xmachines-cost-view.js`, which
//     renders the fleet overview and the machine detail (readout, GPU rows,
//     cost, WoL safety, Off / Force controls, refusal blocks) and nothing
//     audit-shaped — grep it for `audit`: zero hits.
//   * `src/web/public/app.js` routes only `/xmachines` (fleet) and
//     `/xmachines/<name>` (detail). `#/xmachines/audit` therefore mounts
//     `XmachinesDetailPage` for a machine literally named "audit" and asks
//     `/api/xmachines/machines/audit` for it. The app's only audit surfaces are
//     `/api/audit` (generic) and `/api/mcp/audit` (MCP), neither of which is
//     the owner power-audit view this row is about.
//   * The backend half already exists and is deliberately NOT what is missing:
//     A16 classifies every attempt (`on`, `off`, `force`, `denied`, `replayed`,
//     `rate-limited`) and C6 serves them at `GET /api/xmachines/audit` behind
//     `requireOwner`. This journey uses that route as the STORED-ROW ORACLE and
//     asserts the VIEW against it. Nothing here can be satisfied by the routes
//     alone: every acceptance id below is decided on rendered content.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR. This fence has exactly one
// contributor, so there is exactly one test, and every [FENCE-REJECT-V1] line
// it can emit names `unit=D9`. A red CLOSE therefore attributes to D9 and the
// fence can requeue.
//   test_d9_...  D3c D4a D4b D4c D4d H1d L6i L7n L7o L7p L7r L7s L9b L9d L9e
//
// THE FAKE FLEET IS THIS JOURNEY'S OWN SERVER, NOT THE DEPLOYED APP. The
// journey spawns the real `createApiServer` (through tsx, against src/, so a
// stale dist/ cannot make it red for a build reason) with a real
// `AuditService` over a scratch database, an xmac `status` fixture, a
// `machines.conf` fixture, an `XMAC_LOG` WoL fixture, a protected-role fixture
// and a PATH gateway-spy that IS the fake host: the spy records every argv and
// XMAC_CALLER **and mutates the status fixture**, so DOWN-to-UP and
// UP-to-DOWN are observed host-state changes rather than claims about a mock.
// Every fixture address is TEST-NET-1 (192.0.2.0/24); no real box is
// addressable. FENCE_ORIGIN is deliberately ignored — a deployed origin could
// not be armed, spied, or given fixtures, so nothing on this row would be
// observable there.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. HOW THE ATTEMPTS ARE MADE. D9's deliverable is the VIEW. The six
//     specimen attempts are therefore issued against the PRODUCTION power
//     routes from the owner's / viewer's own authenticated session over the
//     same tunnel-shaped proxy the browser uses — not by clicking D7's and
//     D8's controls. Driving them through another contributor's buttons would
//     make a D7 regression red on D9's row and mis-attribute the fence. The
//     composition this row proves is attempt -> audit row -> rendered view, and
//     all three links are exercised at full strength.
//  2. NO CANONICAL DOM CONTRACT for D9 exists yet, so the view is looked for
//     across a set of candidate routes and the rows across an alias set of
//     testids / data-attributes / table rows. That broadens WHERE the evidence
//     may appear; it does not weaken WHAT must be true — every row assertion
//     compares rendered text against the values the C6 route returned for the
//     SAME stored row, so the journey never invents copy.
//  3. OUTCOME LABELS. `on` / `off` / `force` rows are accepted when the row
//     renders the stored classification OR the word "allowed" (the contract row
//     words those three as "allowed"). `denied`, `replayed` and `rate-limited`
//     must render their literal classification (a space in "rate limited" is
//     accepted). A view that shows no outcome at all fails.
//  4. L7s COMPLETENESS is satisfied EITHER by a node under the row whose text
//     parses as JSON deep-equal to the stored `details`, OR by leaf-value
//     containment: every one of the fourteen required keys is represented in
//     the row's rendered text. Two carve-outs, recorded rather than hidden:
//     `session_id` may be rendered in full or masked to its last four
//     characters, and a timestamp may be rendered as the stored ISO string, its
//     date, or its HH:MM — a localized clock is not a completeness failure.
//  5. RATE-LIMIT SPECIMEN. The 429 is produced by a SECOND owner identity
//     (id 2) posting eleven keyless OFFs at one machine: keyless is rejected
//     before any gateway argv exists, so the burst audits ten `denied` rows and
//     one `rate-limited` row without actuating anything, and it cannot exhaust
//     the primary owner's own per-owner bucket. The limiter itself is A6's and
//     is asserted on E11, not here.
//  6. THE FORCE SPECIMEN is the force-confirmation rejection on the normal OFF
//     route (`{force:true, force_reason}`), which A16 classifies as `force` and
//     which reaches no gateway. The full C5 consume path is E8's row; here the
//     point is that a force ATTEMPT is audited, owner-attributed, rendered, and
//     emitted no `--force`.
//  7. XMACHINES_ARM=1. The power routes answer 403 `unarmed` otherwise, so an
//     unarmed E9 would audit six `denied` rows and could not observe a single
//     outcome class. Arming here reaches the PATH spy on a TEST-NET address,
//     never a machine.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E9';
const UNIT = 'D9';
const ACCEPTANCE_IDS = [
  'D3c', 'D4a', 'D4b', 'D4c', 'D4d',
  'H1d', 'L6i',
  'L7n', 'L7o', 'L7p', 'L7r', 'L7s',
  'L9b', 'L9d', 'L9e',
];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_HOST = 'agjasst.silverjrom.app';

// Three identities on the same stub authService. Owner TWO exists only to own
// its own per-owner rate-limit bucket (ambiguity 5).
const OWNER = { token: 'e9-fence-owner-1', id: 1 };
const OWNER_TWO = { token: 'e9-fence-owner-2', id: 2 };
const VIEWER = { token: 'e9-fence-viewer-3', id: 3 };

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media) so no assertion here can be aimed at, or accidentally satisfied
// by, a real box. Every address is TEST-NET-1 and none ends .174/.179/.169.
const FORGE = 'e9-forge';       // DOWN -> the ON target, and the replay target
const KILN = 'e9-kiln';         // UP, idle, WoL-verified -> the normal OFF
const CRUCIBLE = 'e9-crucible'; // UP -> the force attempt (never actuated)
const ANVIL = 'e9-anvil';       // UP -> owner two's keyless burst -> 429
const SHARD = 'e9-shard';       // UP -> the viewer's denied attempt
const SLAG = 'e9-slag';         // DOWN, never targeted -> the zero-wake control

type Row = { name: string; ip: string; state: 'UP' | 'DOWN'; role: string };
const FLEET: Row[] = [
  { name: FORGE, ip: '192.0.2.90', state: 'DOWN', role: 'compute' },
  { name: KILN, ip: '192.0.2.91', state: 'UP', role: 'compute' },
  { name: CRUCIBLE, ip: '192.0.2.92', state: 'UP', role: 'compute' },
  { name: ANVIL, ip: '192.0.2.93', state: 'UP', role: 'compute' },
  { name: SHARD, ip: '192.0.2.94', state: 'UP', role: 'compute' },
  { name: SLAG, ip: '192.0.2.95', state: 'DOWN', role: 'storage' },
];

const ON_KEY = 'e9-on-forge';        // reused for the replay specimen
const OFF_KEY = 'e9-off-kiln';
const FORCE_KEY = 'e9-force-crucible';
const FORCE_REASON = 'e9 fence force reason: operator override rehearsal';

// The keys the A16 attempt record must carry, and C6 must return, for EVERY
// audited attempt. L7s is decided over exactly this list.
const REQUIRED_KEYS = [
  'request', 'authorization', 'pre_state', 'guards', 'force_reason', 'target',
  'action', 'gateway_status', 'final_state', 'actor_id', 'session_id',
  'request_id', 'request_source', 'timestamps',
] as const;

// Candidate entry points for a view that does not exist yet (ambiguity 2).
const AUDIT_HASHES = [
  '/xmachines/audit',
  '/xmachines-audit',
  '/xmachines/power-audit',
  '/xmachines/audit-log',
];
const AUDIT_LINK_SEL = [
  '[data-testid="xmachines-audit-link"]',
  '[data-testid="xmachines-power-audit-link"]',
  '[data-testid="xmachines-audit-nav"]',
  'a[href*="xmachines"][href*="audit"]',
].join(', ');
const AUDIT_VIEW_SEL = [
  '[data-testid="xmachines-power-audit"]',
  '[data-testid="xmachines-audit"]',
  '[data-testid="xmachines-audit-view"]',
  '[data-testid="xmachines-power-audit-view"]',
  '.xm-audit',
  '[data-audit-view]',
].join(', ');
const AUDIT_ROW_SEL = [
  '[data-testid="xmachines-audit-row"]',
  '[data-testid="xmachines-power-audit-row"]',
  '.xm-audit-row',
  '[data-audit-row]',
  'tbody tr',
].join(', ');
const EXPAND_SEL = [
  'summary',
  '[data-testid*="expand"]',
  '[data-testid*="toggle"]',
  '[aria-expanded="false"]',
].join(', ');
const MORE_SEL = [
  '[data-testid="xmachines-audit-load-more"]',
  '[data-testid*="load-more"]',
  'button[data-more]',
].join(', ');

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

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
// `xmac.sh` here is BOTH the gateway-spy and the fake host.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  bin: string;
  spyLog: string;
  statusPath: string;
  transitions: string;
  env: NodeJS.ProcessEnv;
};

const RECORDING_SPIES = ['ping', 'wakeonlan', 'nvidia-smi', 'smartctl', 'upsc', 'sensors'];

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

// The gateway-spy that is also the fake host: it records argv AND the caller
// identity, then mutates the status fixture under a lock so the journey can
// read the host's state back instead of trusting an argv row.
function gatewayScript(): string {
  return `#!/bin/bash
set -u
log="\${E9_SPY_LOG}"
status="\${E9_STATUS_FIXTURE}"
trans="\${E9_TRANSITIONS_LOG}"
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
  (
    flock 9
    tmp="$status.\$\$"
    awk -v m="$machine" -v s="$1" '{ if (\$1 == m) { \$3 = s } ; print }' "$status" > "$tmp" && mv "$tmp" "$status"
  ) 9> "$status.lock"
}

case "$verb" in
  up)
    note STARTING
    # The ON target's wake is deliberately slow so the replay specimen lands
    # while the operation is still in flight (that is what makes it a replay
    # rather than a second action).
    if [ "$machine" = "\${E9_SLOW_UP_MACHINE}" ]; then sleep 6; else sleep 0.3; fi
    set_state UP
    note UP
    ;;
  down)
    note STOPPING
    sleep 0.6
    set_state DOWN
    note DOWN
    ;;
esac
exit 0
`;
}

// The busy preflight's ssh. A1/A13 run `bash -c "ssh ... user@ip bash -c '...'"`.
// Every fake box answers idle (exit 0, no output), so the fail-closed preflight
// really runs and really passes for the OFF specimen.
function sshScript(): string {
  return `#!/bin/bash
set -u
{
  printf '%s' 'ssh'
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> "\${E9_SSH_LOG}"
exit 0
`;
}

function statusLines(rows: Row[]): string {
  return `${rows.map((row) => `${row.name} ${row.ip} ${row.state} leases=() ${row.role}`).join('\n')}\n`;
}

function confLines(rows: Row[]): string {
  // A non-empty busy-check on every row, so the fail-closed preflight is
  // exercised rather than skipped as unconfigured.
  return `${rows
    .map((row, i) => `${row.name}|${row.ip}|02:00:00:00:00:${90 + i}|agjrom|${row.role}|echo e9-fixture-busy-check`)
    .join('\n')}\n`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Verified WoL evidence (a WAKE followed by a later UP) for every machine, so
// the normal OFF is a normal OFF and not a stale-WoL challenge (that routing is
// E4's row, not this one).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e9-audit-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const spyLog = path.join(dir, 'gateway-argv.log');
  const sshLog = path.join(dir, 'ssh-argv.log');
  installRecordingSpies(bin, spyLog);
  fs.writeFileSync(path.join(bin, 'xmac.sh'), gatewayScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'xmac.sh'), 0o755);
  // A bare `xmac` spy as well: an auto-waking `xmac run` would be recorded.
  fs.writeFileSync(path.join(bin, 'xmac'), gatewayScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'xmac'), 0o755);
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
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(transitions, '');
  fs.writeFileSync(xmacLog, wolLog());

  // No protected role is live on the fake fleet: the protected-role refusal is
  // E4's row, and a refusal here would replace the OFF specimen with a denial.
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
    E9_SPY_LOG: spyLog,
    E9_SSH_LOG: sshLog,
    E9_STATUS_FIXTURE: statusPath,
    E9_TRANSITIONS_LOG: transitions,
    E9_SLOW_UP_MACHINE: FORGE,
    E9_OWNER_TOKEN: OWNER.token,
    E9_OWNER_TWO_TOKEN: OWNER_TWO.token,
    E9_VIEWER_TOKEN: VIEWER.token,
  };
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  return { dir, bin, spyLog, statusPath, transitions, env };
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

function hostStateOf(statusPath: string, machine: string): string {
  const text = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8') : '';
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] === machine) return (tokens[2] ?? '').toUpperCase();
  }
  return '';
}

async function waitForHostState(statusPath: string, machine: string, want: string, timeoutMs = 25_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = hostStateOf(statusPath, machine);
  while (seen !== want && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    seen = hostStateOf(statusPath, machine);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// The scratch app server: the REAL createApiServer, run through tsx against
// src/, with a REAL AuditService over a scratch database so the audit rows this
// fence reads are the ones production writes.
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');
const { AuditService } = await import('__SRC__/services/audit-service.js');

const TOKENS = new Map([
  [process.env.E9_OWNER_TOKEN, { id: 1, role: 'owner', username: 'owner-1' }],
  [process.env.E9_OWNER_TWO_TOKEN, { id: 2, role: 'owner', username: 'owner-2' }],
  [process.env.E9_VIEWER_TOKEN, { id: 3, role: 'viewer', username: 'viewer-3' }],
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

const db = new DatabaseService(':memory:');
const insert = db.prepare('INSERT INTO users (id, telegram_id, username, role, active) VALUES (?, ?, ?, ?, 1)');
insert.run(1, 900001, 'owner-1', 'owner');
insert.run(2, 900002, 'owner-2', 'owner');
insert.run(3, 900003, 'viewer-3', 'viewer');

const services = {
  authService: {
    verifyToken: (token) => TOKENS.get(token) ?? null,
    is2FAEnabled: () => false,
  },
  projectService: {}, safetyService: {}, tmuxService: {}, tmuxStreamManager: {},
  auditService: new AuditService(db),
  db,
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
console.log('E9-SERVER-READY ' + app.server.address().port);
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
    const match = out.match(/E9-SERVER-READY (\d+)/);
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
// first. This reproduces that header shape for a server on an ephemeral port
// and relaxes no check.
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

type HttpResult = { status: number; json: Record<string, unknown> | null; text: string };

function httpJson(
  base: string,
  method: 'GET' | 'POST',
  pathname: string,
  options: { token: string; key?: string; body?: unknown } ,
): Promise<HttpResult> {
  const url = new URL(pathname, base);
  const payload = options.body === undefined ? null : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.token}`,
    origin: `https://${CANONICAL_HOST}`,
  };
  if (options.key) headers['idempotency-key'] = options.key;
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: Number(url.port), method, path: `${url.pathname}${url.search}`, headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => {
          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = null; }
          resolve({ status: res.statusCode ?? 0, json: parsed, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stored rows, read back through the production owner-only C6 route. This is
// the EXPECTED value the rendered view is compared against; it is never itself
// accepted as the render.
// ---------------------------------------------------------------------------
type StoredRow = { id: number; user_id: number | null; details: Record<string, unknown> };

async function readStoredRows(base: string, token: string): Promise<StoredRow[]> {
  const res = await httpJson(base, 'GET', '/api/xmachines/audit?limit=500', { token });
  if (res.status !== 200) throw new Error(`GET /api/xmachines/audit answered ${res.status}: ${res.text.slice(0, 200)}`);
  const entries = (res.json?.entries ?? []) as Array<Record<string, unknown>>;
  return entries.map((entry) => {
    let details: Record<string, unknown> = {};
    try { details = JSON.parse(String(entry.details ?? '{}')) as Record<string, unknown>; } catch { details = {}; }
    return { id: Number(entry.id), user_id: entry.user_id === null ? null : Number(entry.user_id), details };
  }).sort((a, b) => a.id - b.id);
}

function classOf(row: StoredRow): string {
  const value = row.details.classification;
  return typeof value === 'string' ? value : '';
}

function targetOf(row: StoredRow): string {
  const value = row.details.target;
  return typeof value === 'string' ? value : '';
}

function pickStored(rows: StoredRow[], target: string, classification: string): StoredRow {
  const found = rows.filter((row) => targetOf(row) === target && classOf(row) === classification);
  assert(
    found.length > 0,
    `no stored audit row for target=${target} classification=${classification}; stored=${JSON.stringify(rows.map((r) => `${targetOf(r)}:${classOf(r)}`))}`,
  );
  return found[found.length - 1];
}

// ---------------------------------------------------------------------------
// The owner's browser on the product audit view.
// ---------------------------------------------------------------------------
type RenderedView = { rows: string[]; bodyText: string; hash: string };

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function harvestRows(page: import('@playwright/test').Page): Promise<string[]> {
  // Open anything collapsed first: complete details are frequently behind a
  // disclosure, and a closed disclosure is not a rendering failure.
  const toggles = await page.$$(`${AUDIT_VIEW_SEL} ${EXPAND_SEL}`).catch(() => []);
  for (const toggle of toggles.slice(0, 40)) {
    await toggle.click({ timeout: 800 }).catch(() => undefined);
  }
  for (let i = 0; i < 5; i += 1) {
    const more = await page.$(MORE_SEL);
    if (!more) break;
    await more.click({ timeout: 800 }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(300);
  return page.$$eval(AUDIT_ROW_SEL, (elements) =>
    elements.map((element) => {
      const own = Array.from(element.attributes).map((attribute) => `${attribute.name}=${attribute.value}`);
      const nested = Array.from(element.querySelectorAll('*'))
        .flatMap((node) => Array.from(node.attributes).map((attribute) => attribute.value));
      return `${(element as HTMLElement).innerText || element.textContent || ''} ${own.join(' ')} ${nested.join(' ')}`;
    }),
  );
}

// JSON blobs rendered anywhere under a row, so an implementation that shows the
// stored `details` verbatim satisfies L7s directly.
async function harvestJsonBlobs(page: import('@playwright/test').Page): Promise<Record<string, unknown>[]> {
  const texts = await page.$$eval(`${AUDIT_ROW_SEL} pre, ${AUDIT_ROW_SEL} code, ${AUDIT_ROW_SEL} [data-details]`, (elements) =>
    elements.map((element) => element.textContent || ''),
  ).catch(() => [] as string[]);
  const blobs: Record<string, unknown>[] = [];
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text.trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) blobs.push(parsed as Record<string, unknown>);
    } catch { /* not a JSON node */ }
  }
  return blobs;
}

async function openAuditView(
  browser: import('@playwright/test').Browser,
  base: string,
  identity: { token: string; id: number },
  role: string,
): Promise<{ view: RenderedView; close: () => Promise<void>; page: import('@playwright/test').Page }> {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  const page = await context.newPage();
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript(([token, id, userRole]) => {
    try {
      localStorage.setItem('agj_token', token as string);
      localStorage.setItem('agj_user', JSON.stringify({ id, name: 'e9', username: 'e9', role: userRole }));
    } catch { /* ignore */ }
  }, [identity.token, identity.id, role] as [string, number, string]);

  const attempts: string[] = [...AUDIT_HASHES];
  let best: RenderedView = { rows: [], bodyText: '', hash: '' };

  // A link from the fleet page is the first-class entry point if one exists.
  await page.goto(`${base}/index.html#/xmachines`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const link = await page.$(AUDIT_LINK_SEL);
  if (link) {
    await link.click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const container = await page.$(AUDIT_VIEW_SEL);
    if (container) {
      const rows = await harvestRows(page);
      const bodyText = normalize(await page.innerText('body').catch(() => ''));
      if (rows.length > 0) return { view: { rows, bodyText, hash: page.url() }, close: () => context.close(), page };
      best = { rows, bodyText, hash: page.url() };
    }
  }

  for (const hash of attempts) {
    await page.goto(`${base}/index.html#${hash}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const bodyText = normalize(await page.innerText('body').catch(() => ''));
    const container = await page.$(AUDIT_VIEW_SEL);
    if (!container) {
      if (best.bodyText === '') best = { rows: [], bodyText, hash };
      continue;
    }
    const rows = await harvestRows(page);
    if (rows.length > 0) return { view: { rows, bodyText, hash }, close: () => context.close(), page };
    best = { rows, bodyText, hash };
  }
  return { view: best, close: () => context.close(), page };
}

function requireView(view: RenderedView | null): RenderedView {
  assert(
    view !== null && view.rows.length > 0,
    `no owner power-audit view rendered any audit row at any of ${JSON.stringify(AUDIT_HASHES)} ` +
    `(container aliases ${AUDIT_VIEW_SEL}); D9 has not landed. last body=${(view?.bodyText || '').slice(0, 220)}`,
  );
  return view as RenderedView;
}

const ALLOWED_LABEL = /\ballowed\b/i;

function classificationRendered(rowText: string, classification: string): boolean {
  const lower = rowText.toLowerCase();
  if (classification === 'rate-limited') return /rate[\s-]?limited/.test(lower);
  if (classification === 'on' || classification === 'off' || classification === 'force') {
    return new RegExp(`\\b${classification}\\b`).test(lower) || ALLOWED_LABEL.test(rowText);
  }
  return new RegExp(`\\b${classification}\\b`).test(lower);
}

// The rendered row for a stored row: it must name the same target AND render
// the same outcome (ambiguity 3).
function renderedRowFor(view: RenderedView, stored: StoredRow): string {
  const target = targetOf(stored);
  const classification = classOf(stored);
  const candidates = view.rows
    .map(normalize)
    .filter((row) => row.includes(target) && classificationRendered(row, classification));
  assert(
    candidates.length > 0,
    `the audit view rendered no row for target=${target} classification=${classification}; ` +
    `rendered ${view.rows.length} rows: ${JSON.stringify(view.rows.map((r) => normalize(r).slice(0, 90)).slice(0, 12))}`,
  );
  // The richest candidate: details are what this fence is about.
  return candidates.sort((a, b) => b.length - a.length)[0];
}

function scalarLeaves(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(scalarLeaves);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [key, ...scalarLeaves(nested)]);
  }
  return [];
}

function timestampRendered(rowText: string, timestamps: unknown): boolean {
  const values = scalarLeaves(timestamps).filter((value) => /\d{4}-\d{2}-\d{2}T/.test(value));
  if (values.length === 0) return false;
  return values.some((iso) => {
    if (rowText.includes(iso)) return true;
    const date = iso.slice(0, 10);
    const hhmm = iso.slice(11, 16);
    return rowText.includes(date) || rowText.includes(hhmm);
  });
}

function sessionRendered(rowText: string, sessionId: unknown): boolean {
  const value = typeof sessionId === 'string' ? sessionId : '';
  if (value === '') return true; // nothing was stored, so nothing can be missing
  return rowText.includes(value) || rowText.includes(value.slice(-4));
}

// L7s: the row exposes the COMPLETE stored details — either as a JSON node
// deep-equal to what C6 returned, or by leaf-value containment (ambiguity 4).
function completenessProblems(rowText: string, stored: StoredRow, blobs: Record<string, unknown>[]): string[] {
  const details = stored.details;
  const exact = blobs.some((blob) => JSON.stringify(blob) === JSON.stringify(details));
  if (exact) return [];
  const missing: string[] = [];
  for (const key of REQUIRED_KEYS) {
    assert(
      Object.prototype.hasOwnProperty.call(details, key),
      `the stored row itself is missing required key ${key}; the audit contract is broken upstream of the view`,
    );
    const value = details[key];
    if (key === 'timestamps') {
      if (!timestampRendered(rowText, value)) missing.push('timestamps');
      continue;
    }
    if (key === 'session_id') {
      if (!sessionRendered(rowText, value)) missing.push('session_id');
      continue;
    }
    const leaves = scalarLeaves(value).filter((leaf) => leaf !== '' && leaf !== 'undefined');
    if (leaves.length === 0) continue; // an empty stored value cannot be rendered
    if (!leaves.some((leaf) => rowText.includes(leaf))) missing.push(`${key}(${leaves.slice(0, 3).join('|')})`);
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Evidence: the fake fleet, the six specimen attempts, the stored rows and the
// rendered view. Everything that can go wrong is RECORDED, never thrown at
// module scope — a collect error would be red for the wrong reason and would
// name no unit.
// ---------------------------------------------------------------------------
type Evidence = {
  scratch: Scratch | null;
  storedMid: StoredRow[];
  stored: StoredRow[];
  view: RenderedView | null;
  blobs: Record<string, unknown>[];
  viewerView: RenderedView | null;
  viewerAuditStatus: number;
  viewerAuditBody: string;
  attempts: Array<{ label: string; status: number }>;
  hostBefore: Record<string, string>;
  hostAfter: Record<string, string>;
  problems: string[];
};

let evidencePromise: Promise<Evidence> | null = null;

function evidence(): Promise<Evidence> {
  if (!evidencePromise) evidencePromise = collect();
  return evidencePromise;
}

let browserRef: import('@playwright/test').Browser | null = null;
const closers: Array<() => Promise<void>> = [];

async function collect(): Promise<Evidence> {
  const problems: string[] = [];
  const result: Evidence = {
    scratch: null,
    storedMid: [],
    stored: [],
    view: null,
    blobs: [],
    viewerView: null,
    viewerAuditStatus: 0,
    viewerAuditBody: '',
    attempts: [],
    hostBefore: {},
    hostAfter: {},
    problems,
  };

  let scratch: Scratch | null = null;
  let server: Server | null = null;
  try {
    scratch = newScratch();
    result.scratch = scratch;
    for (const row of FLEET) result.hostBefore[row.name] = hostStateOf(scratch.statusPath, row.name);

    server = await startServer(scratch);
    const proxy = await startProxy(server.port);
    const base = proxy.base;
    const child = server.child;
    closers.push(async () => { await proxy.close(); child.kill('SIGTERM'); });

    // 1. Owner two's keyless burst: ten denied rows, then one rate-limited row.
    //    Keyless is rejected before any gateway argv exists (ambiguity 5).
    for (let i = 0; i < 11; i += 1) {
      const res = await httpJson(base, 'POST', `/api/xmachines/machines/${ANVIL}/power/off`, { token: OWNER_TWO.token });
      result.attempts.push({ label: `burst-${i + 1}`, status: res.status });
    }

    // 2. The viewer's denied attempt.
    const denied = await httpJson(base, 'POST', `/api/xmachines/machines/${SHARD}/power/on`, { token: VIEWER.token });
    result.attempts.push({ label: 'viewer-denied', status: denied.status });

    // 3. The production ON of a DOWN machine.
    const on = await httpJson(base, 'POST', `/api/xmachines/machines/${FORGE}/power/on`, { token: OWNER.token, key: ON_KEY });
    result.attempts.push({ label: 'on', status: on.status });

    // 4. The production normal OFF of an idle, WoL-verified UP machine.
    const off = await httpJson(base, 'POST', `/api/xmachines/machines/${KILN}/power/off`, { token: OWNER.token, key: OFF_KEY });
    result.attempts.push({ label: 'off', status: off.status });

    // A mid-run snapshot, so append-only can be judged as a prefix (H1d).
    result.storedMid = await readStoredRows(base, OWNER.token);

    // 5. The force attempt: rejected for confirmation, audited, no --force.
    const force = await httpJson(base, 'POST', `/api/xmachines/machines/${CRUCIBLE}/power/off`, {
      token: OWNER.token,
      key: FORCE_KEY,
      body: { force: true, force_reason: FORCE_REASON },
    });
    result.attempts.push({ label: 'force', status: force.status });

    // 6. The replay: the same key while the ON is still in flight.
    const replay = await httpJson(base, 'POST', `/api/xmachines/machines/${FORGE}/power/on`, { token: OWNER.token, key: ON_KEY });
    result.attempts.push({ label: 'replay', status: replay.status });

    // The host really moves: DOWN -> UP for the ON target, UP -> DOWN for the
    // OFF target. This is what makes L9e's provenance host-state.
    await waitForHostState(scratch.statusPath, KILN, 'DOWN');
    await waitForHostState(scratch.statusPath, FORGE, 'UP');
    for (const row of FLEET) result.hostAfter[row.name] = hostStateOf(scratch.statusPath, row.name);

    result.stored = await readStoredRows(base, OWNER.token);

    // The owner's view of the rendered audit.
    if (browserRef) {
      const owned = await openAuditView(browserRef, base, OWNER, 'owner');
      closers.push(owned.close);
      result.view = owned.view;
      result.blobs = owned.view.rows.length > 0 ? await harvestJsonBlobs(owned.page) : [];

      // The non-owner's attempt at the same surface (L7r).
      const viewed = await openAuditView(browserRef, base, VIEWER, 'viewer');
      closers.push(viewed.close);
      result.viewerView = viewed.view;
    } else {
      problems.push('no browser handle was available to open the audit view');
    }

    const viewerAudit = await httpJson(base, 'GET', '/api/xmachines/audit?limit=5', { token: VIEWER.token });
    result.viewerAuditStatus = viewerAudit.status;
    result.viewerAuditBody = viewerAudit.text.slice(0, 200);
  } catch (error) {
    problems.push(`evidence collection failed: ${(error as Error)?.message ?? String(error)}`);
    if (server) problems.push(`server stderr: ${server.stderr()}`);
  }

  return result;
}

function requireStored(ev: Evidence): StoredRow[] {
  assert(ev.stored.length > 0, `no stored audit rows were readable: ${ev.problems.join('; ') || 'unknown'}`);
  return ev.stored;
}

// ---------------------------------------------------------------------------
// D9 — the owner-only power audit view.
// Owns every id on this row: D3c D4a D4b D4c D4d H1d L6i L7n L7o L7p L7r L7s
//                            L9b L9d L9e
// ---------------------------------------------------------------------------
test('test_d9_power_audit_view_renders_allowed_denied_replayed_and_rate_limited_outcomes_with_complete_details', async ({ browser }) => {
  test.setTimeout(150_000);
  browserRef = browser;
  const ev = await evidence();
  const results: boolean[] = [];

  // D4a — the production ON writes an owner-attributed audit row and the owner
  // view renders it against the machine the owner actually powered on.
  results.push(await guardedCheck('D4a', UNIT, async () => {
    const stored = pickStored(requireStored(ev), FORGE, 'on');
    assert(stored.user_id === OWNER.id, `the ON row is attributed to user_id=${stored.user_id}, not owner ${OWNER.id}`);
    assert(stored.details.action === 'on', `the ON row records action=${JSON.stringify(stored.details.action)}`);
    const rendered = renderedRowFor(requireView(ev.view), stored);
    assert(rendered.includes(FORGE), `the rendered ON row does not name ${FORGE}: ${rendered.slice(0, 200)}`);
    assert(
      rendered.includes(String(OWNER.id)) || rendered.includes('owner-1'),
      `the rendered ON row carries no owner attribution: ${rendered.slice(0, 200)}`,
    );
  }, 'ui-screenshot'));

  // D4b — the production normal OFF writes an owner-attributed audit row and
  // the owner view renders it.
  results.push(await guardedCheck('D4b', UNIT, async () => {
    const stored = pickStored(requireStored(ev), KILN, 'off');
    assert(stored.user_id === OWNER.id, `the OFF row is attributed to user_id=${stored.user_id}, not owner ${OWNER.id}`);
    assert(stored.details.action === 'off', `the OFF row records action=${JSON.stringify(stored.details.action)}`);
    const rendered = renderedRowFor(requireView(ev.view), stored);
    assert(rendered.includes(KILN), `the rendered OFF row does not name ${KILN}: ${rendered.slice(0, 200)}`);
    assert(
      rendered.includes(String(OWNER.id)) || rendered.includes('owner-1'),
      `the rendered OFF row carries no owner attribution: ${rendered.slice(0, 200)}`,
    );
  }, 'ui-screenshot'));

  // D4c — the force ATTEMPT is audited, owner-attributed, and rendered with the
  // reason the owner gave. An audited force that the view drops is a fail.
  results.push(await guardedCheck('D4c', UNIT, async () => {
    const stored = pickStored(requireStored(ev), CRUCIBLE, 'force');
    assert(stored.user_id === OWNER.id, `the force row is attributed to user_id=${stored.user_id}, not owner ${OWNER.id}`);
    assert(
      stored.details.force_reason === FORCE_REASON,
      `the force row stored force_reason=${JSON.stringify(stored.details.force_reason)}`,
    );
    const rendered = renderedRowFor(requireView(ev.view), stored);
    assert(
      rendered.includes(FORCE_REASON) || rendered.includes(FORCE_REASON.slice(0, 40)),
      `the rendered force row does not show the stored force reason: ${rendered.slice(0, 240)}`,
    );
  }, 'ui-screenshot'));

  // D3c — a force attempt is owner-attributed AND reached no gateway: no
  // `--force` argv exists at all and the target is still UP on the fake host.
  results.push(await guardedCheck('D3c', UNIT, async () => {
    const scratch = ev.scratch;
    assert(scratch !== null, `no fake fleet was created: ${ev.problems.join('; ') || 'unknown'}`);
    const forced = spyRows((scratch as Scratch).spyLog).filter((row) => row.argv.includes('--force'));
    assert(forced.length === 0, `--force reached the gateway: ${JSON.stringify(forced.map((row) => row.argv))}`);
    assert(
      ev.hostAfter[CRUCIBLE] === 'UP',
      `the force attempt moved the host: ${CRUCIBLE} is ${ev.hostAfter[CRUCIBLE]}, expected it to stay UP`,
    );
    const stored = pickStored(requireStored(ev), CRUCIBLE, 'force');
    assert(stored.details.actor_id === String(OWNER.id), `force row actor_id=${JSON.stringify(stored.details.actor_id)}`);
    const rendered = renderedRowFor(requireView(ev.view), stored);
    assert(
      rendered.includes(String(OWNER.id)) || rendered.includes('owner-1'),
      `the rendered force row carries no actor attribution: ${rendered.slice(0, 200)}`,
    );
  }, 'gateway-spy'));

  // D4d — the owner can view the power audit: every specimen outcome class the
  // route stored has a rendered counterpart in the owner's view.
  results.push(await guardedCheck('D4d', UNIT, async () => {
    const stored = requireStored(ev);
    const view = requireView(ev.view);
    const specimens: Array<[string, string]> = [
      [FORGE, 'on'], [KILN, 'off'], [CRUCIBLE, 'force'],
      [FORGE, 'replayed'], [SHARD, 'denied'], [ANVIL, 'rate-limited'],
    ];
    const missing: string[] = [];
    for (const [target, classification] of specimens) {
      const row = pickStored(stored, target, classification);
      try { renderedRowFor(view, row); } catch { missing.push(`${target}:${classification}`); }
    }
    assert(missing.length === 0, `the owner audit view rendered no row for ${JSON.stringify(missing)}`);
  }, 'ui-screenshot'));

  // L7s — the rendered row carries the COMPLETE stored details, not a summary.
  results.push(await guardedCheck('L7s', UNIT, async () => {
    const view = requireView(ev.view);
    const stored = requireStored(ev);
    const problems: string[] = [];
    for (const [target, classification] of [[FORGE, 'on'], [KILN, 'off'], [SHARD, 'denied']] as Array<[string, string]>) {
      const row = pickStored(stored, target, classification);
      const rendered = renderedRowFor(view, row);
      const missing = completenessProblems(rendered, row, ev.blobs);
      if (missing.length > 0) problems.push(`${target}:${classification} missing ${JSON.stringify(missing)}`);
    }
    assert(problems.length === 0, `the audit view renders incomplete details — ${problems.join(' | ')}`);
  }, 'ui-screenshot'));

  // L7n — a non-owner power request is audited as denied and the owner view
  // renders that denial, with the denying authorization result visible.
  results.push(await guardedCheck('L7n', UNIT, async () => {
    const stored = pickStored(requireStored(ev), SHARD, 'denied');
    assert(stored.user_id === VIEWER.id, `the denied row is attributed to user_id=${stored.user_id}, not the viewer ${VIEWER.id}`);
    const authorization = stored.details.authorization as { ok?: boolean } | undefined;
    assert(authorization?.ok === false, `the denied row records authorization=${JSON.stringify(authorization)}`);
    const rendered = renderedRowFor(requireView(ev.view), stored);
    assert(/denied/i.test(rendered), `the rendered row does not read as denied: ${rendered.slice(0, 200)}`);
    assert(
      rendered.includes(String(VIEWER.id)) || rendered.includes('viewer-3'),
      `the rendered denied row does not name the actor who was refused: ${rendered.slice(0, 200)}`,
    );
  }, 'ui-screenshot'));

  // L7o — a second POST with the same idempotency key is audited as replayed,
  // and the view renders it as a replay rather than as a second action.
  results.push(await guardedCheck('L7o', UNIT, async () => {
    const stored = pickStored(requireStored(ev), FORGE, 'replayed');
    const request = stored.details.request as { idempotencyKey?: string } | undefined;
    assert(request?.idempotencyKey === ON_KEY, `the replayed row stored idempotencyKey=${JSON.stringify(request?.idempotencyKey)}`);
    const rendered = renderedRowFor(requireView(ev.view), stored);
    assert(/replay/i.test(rendered), `the rendered row does not read as replayed: ${rendered.slice(0, 200)}`);
    assert(rendered.includes(ON_KEY), `the rendered replay row does not show the idempotency key: ${rendered.slice(0, 200)}`);
  }, 'ui-screenshot'));

  // L7p — the 429 from the power limiter is audited as rate-limited and the
  // view renders that outcome; a throttled owner must be able to see why.
  results.push(await guardedCheck('L7p', UNIT, async () => {
    const burst = ev.attempts.filter((attempt) => attempt.label.startsWith('burst-'));
    assert(
      burst.some((attempt) => attempt.status === 429),
      `no burst request was rate-limited: ${JSON.stringify(burst.map((a) => a.status))}`,
    );
    const stored = pickStored(requireStored(ev), ANVIL, 'rate-limited');
    assert(stored.user_id === OWNER_TWO.id, `the rate-limited row is attributed to user_id=${stored.user_id}`);
    const rendered = renderedRowFor(requireView(ev.view), stored);
    assert(/rate[\s-]?limited/i.test(rendered), `the rendered row does not read as rate-limited: ${rendered.slice(0, 200)}`);
  }, 'ui-screenshot'));

  // L7r — the power-audit surface is owner-only: the read route refuses a
  // non-owner AND the non-owner's browser renders no audit row.
  results.push(await guardedCheck('L7r', UNIT, async () => {
    assert(
      ev.viewerAuditStatus === 403,
      `GET /api/xmachines/audit answered ${ev.viewerAuditStatus} for a viewer, expected 403: ${ev.viewerAuditBody}`,
    );
    requireView(ev.view); // the surface must exist before "hidden from a viewer" means anything
    const viewerRows = ev.viewerView?.rows ?? [];
    assert(
      viewerRows.length === 0,
      `a non-owner session rendered ${viewerRows.length} audit rows: ${JSON.stringify(viewerRows.slice(0, 3).map((r) => normalize(r).slice(0, 90)))}`,
    );
    const body = ev.viewerView?.bodyText ?? '';
    assert(
      /owner role required|not authori|forbidden/i.test(body),
      `a non-owner session was not told the surface is owner-only: ${body.slice(0, 200)}`,
    );
  }, 'http-auth-matrix'));

  // H1d — every control attempt writes exactly ONE audit row, and the log is
  // append-only: the mid-run snapshot survives unchanged as a prefix.
  results.push(await guardedCheck('H1d', UNIT, async () => {
    const stored = requireStored(ev);
    assert(
      stored.length === ev.attempts.length,
      `${ev.attempts.length} control attempts produced ${stored.length} audit rows`,
    );
    const counts = new Map<string, number>();
    for (const row of stored) counts.set(classOf(row), (counts.get(classOf(row)) ?? 0) + 1);
    const expected: Array<[string, number]> = [
      ['on', 1], ['off', 1], ['force', 1], ['replayed', 1], ['rate-limited', 1], ['denied', 11],
    ];
    for (const [classification, want] of expected) {
      assert(
        counts.get(classification) === want,
        `expected ${want} ${classification} rows, found ${counts.get(classification) ?? 0} (all: ${JSON.stringify([...counts])})`,
      );
    }
    assert(ev.storedMid.length > 0, 'no mid-run snapshot was taken, so append-only cannot be judged');
    assert(
      stored.length > ev.storedMid.length,
      `the log did not grow after the snapshot (${ev.storedMid.length} -> ${stored.length})`,
    );
    for (let i = 0; i < ev.storedMid.length; i += 1) {
      assert(
        stored[i].id === ev.storedMid[i].id &&
        JSON.stringify(stored[i].details) === JSON.stringify(ev.storedMid[i].details),
        `audit row ${ev.storedMid[i].id} changed after it was written; the log is not append-only`,
      );
    }
    const view = requireView(ev.view);
    assert(
      view.rows.length >= 6,
      `the owner view rendered ${view.rows.length} rows for ${stored.length} stored attempts; the log is not shown completely`,
    );
  }, 'db-schema-check'));

  // L6i — XMAC_CALLER is the owner plus the session, and the audit row agrees
  // with what the gateway saw: audit_log and xmac.log name the same actor.
  results.push(await guardedCheck('L6i', UNIT, async () => {
    const scratch = ev.scratch;
    assert(scratch !== null, `no fake fleet was created: ${ev.problems.join('; ') || 'unknown'}`);
    const gateway = spyRows((scratch as Scratch).spyLog).filter((row) => row.argv[0] === 'up' || row.argv[0] === 'down');
    assert(gateway.length >= 2, `expected the ON and the OFF to reach the gateway, saw ${JSON.stringify(gateway.map((r) => r.argv))}`);
    const expectedCaller = `${OWNER.id}+${OWNER.token}`;
    for (const row of gateway) {
      assert(
        row.caller === expectedCaller,
        `gateway argv ${JSON.stringify(row.argv)} carried XMAC_CALLER=${JSON.stringify(row.caller)}, expected ${expectedCaller}`,
      );
    }
    const onRow = pickStored(requireStored(ev), FORGE, 'on');
    assert(
      onRow.details.actor_id === String(OWNER.id) && onRow.details.session_id === OWNER.token,
      `the audit row (actor=${JSON.stringify(onRow.details.actor_id)} session=${JSON.stringify(onRow.details.session_id)}) ` +
      `does not agree with XMAC_CALLER=${expectedCaller}`,
    );
    const rendered = renderedRowFor(requireView(ev.view), onRow);
    assert(
      rendered.includes(String(OWNER.id)) || rendered.includes('owner-1'),
      `the rendered row does not carry the actor the gateway was told about: ${rendered.slice(0, 200)}`,
    );
  }, 'gateway-spy'));

  // L9b — fake-fleet fence class: the proof is RENDERED CONTENT that matches
  // the stored row and the real host, not an argv row. A "the mock was spawned
  // with `down`" assertion would be a specified FAIL, so it is not made here.
  results.push(await guardedCheck('L9b', UNIT, async () => {
    const view = requireView(ev.view);
    const stored = requireStored(ev);
    for (const [target, classification, preState] of [
      [FORGE, 'on', 'down'], [KILN, 'off', 'up'],
    ] as Array<[string, string, string]>) {
      const row = pickStored(stored, target, classification);
      assert(
        String(row.details.pre_state).toLowerCase() === preState,
        `${target} stored pre_state=${JSON.stringify(row.details.pre_state)}, expected ${preState}`,
      );
      assert(
        ev.hostBefore[target] === preState.toUpperCase(),
        `${target} was ${ev.hostBefore[target]} on the fake host, but the row says ${preState}`,
      );
      const rendered = renderedRowFor(view, row);
      assert(
        rendered.toLowerCase().includes(preState),
        `the rendered ${classification} row does not show the pre-action state ${preState}: ${rendered.slice(0, 200)}`,
      );
      assert(
        rendered.includes(String(row.details.request_id)),
        `the rendered ${classification} row does not carry the stored request id: ${rendered.slice(0, 200)}`,
      );
    }
  }, 'cli-to-ui-compare'));

  // L9d — zero wakes beyond the single ON the owner submitted: no wakeonlan at
  // all, no auto-waking xmac subcommand, and the untouched DOWN box stays DOWN.
  results.push(await guardedCheck('L9d', UNIT, async () => {
    const scratch = ev.scratch;
    assert(scratch !== null, `no fake fleet was created: ${ev.problems.join('; ') || 'unknown'}`);
    const rows = spyRows((scratch as Scratch).spyLog);
    const wol = rows.filter((row) => row.command === 'wakeonlan');
    assert(wol.length === 0, `wakeonlan was invoked ${wol.length} times: ${JSON.stringify(wol.map((r) => r.argv))}`);
    const autoWaking = rows.filter((row) => ['run', 'claim', 'release'].includes(row.argv[0] ?? ''));
    assert(autoWaking.length === 0, `an auto-waking gateway subcommand ran: ${JSON.stringify(autoWaking.map((r) => r.argv))}`);
    const ups = rows.filter((row) => row.argv[0] === 'up');
    assert(
      ups.length > 0 && ups.every((row) => row.argv[1] === FORGE),
      `the only wake permitted is the owner's ON of ${FORGE}; saw ${JSON.stringify(ups.map((r) => r.argv))}`,
    );
    assert(
      ev.hostAfter[SLAG] === 'DOWN',
      `the untargeted DOWN box ${SLAG} is now ${ev.hostAfter[SLAG]}; reading the audit must never wake a box`,
    );
  }, 'gateway-spy'));

  // L9e — host-state provenance for both power proofs on this row: the ON and
  // the OFF are believed because the fake HOST changed state and logged the
  // transition, never because an argv row was seen. This id is deliberately
  // decided on host state ALONE: the runner keys the whole report's
  // fault_class on L9e's provenance, so coupling it to the missing view would
  // rewrite every D9 rejection into `argv_only_power_proof` and leave
  // `failing_units` empty — the report could then name nobody. The rendered
  // audit of these same two transitions is asserted by L9b and L9d.
  results.push(await guardedCheck('L9e', UNIT, async () => {
    const scratch = ev.scratch;
    assert(scratch !== null, `no fake fleet was created: ${ev.problems.join('; ') || 'unknown'}`);
    assert(
      ev.hostBefore[FORGE] === 'DOWN' && ev.hostAfter[FORGE] === 'UP',
      `${FORGE} did not transition DOWN->UP on the fake host: ${ev.hostBefore[FORGE]} -> ${ev.hostAfter[FORGE]}`,
    );
    assert(
      ev.hostBefore[KILN] === 'UP' && ev.hostAfter[KILN] === 'DOWN',
      `${KILN} did not transition UP->DOWN on the fake host: ${ev.hostBefore[KILN]} -> ${ev.hostAfter[KILN]}`,
    );
    const transitions = fs.existsSync((scratch as Scratch).transitions)
      ? fs.readFileSync((scratch as Scratch).transitions, 'utf8')
      : '';
    assert(
      new RegExp(`^${FORGE}\\tUP\\t`, 'm').test(transitions),
      `the host recorded no UP transition for ${FORGE}: ${transitions.slice(0, 200)}`,
    );
    assert(
      new RegExp(`^${KILN}\\tDOWN\\t`, 'm').test(transitions),
      `the host recorded no DOWN transition for ${KILN}: ${transitions.slice(0, 200)}`,
    );
  }, 'host-state'));

  finish(`${FENCE_ID}/${UNIT}`, results, ACCEPTANCE_IDS.length);
});

test.afterAll(async () => {
  for (const close of closers) {
    await close().catch(() => undefined);
  }
});
