import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E4 — INTEGRATION: an owner power journey on a fake fleet spawns zero
// `down` for stale or never-verified WoL evidence until an A3 challenge is
// consumed, causes a real UP-to-STOPPING-to-DOWN host transition, and renders
// the exact lease, busy-fail-closed, protected-role and stale-WoL refusals.
// An argv-only `down` assertion is a FAILING proof, not a pass.
// Contributors: D7 (normal ON/Off controls, in-progress state, exact guard
// refusals, stale/never-verified challenge routing) and D8 (the separate
// number-match confirmation surface that consumes the challenge).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E4 and
// implements none of it; it contains no product code. It is red today because
// D7 and D8 have not landed:
//   * D7 — `src/web/public/xmachines-cost-view.js` renders an Off button and a
//     refusal block (C4's route work) but there is NO ON control anywhere, no
//     in-progress state after a 202, and no error-state rendering for a
//     transition that timed out (e2e/xmachines-power-controls.spec.ts does not
//     exist).
//   * D8 — nothing renders a number-match challenge: the never-verified Off
//     refusal body already carries `challengeId` and `displayNumber`, and the
//     UI drops both on the floor, so no owner can consume a challenge from the
//     product surface (e2e/run-xmachines-force-ui.mjs does not exist).
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. A single test asserting all
// twenty-two ids is unattributable — the validator would have to answer
// fault_class=plan failing_units=(none) and the fence could never requeue.
//   test_d7_...  D1a D2b D2c D2d D2e I5c L1b L1c L1d L1e L2a L2b L2c
//                L4a L4b L4c L8h L9b L9d L9e                      (unit D7)
//   test_d8_...  L2d L15b                                         (unit D8)
//
// Attribution of the ids whose ORIGINATING slice is not an E4 contributor
// (req-matrix.md): D2b/D2c/D2e/L1b-L1e/L2a-L2c/L4a-L4c/L15b originate on
// A1/A2/A4/A13/C4, but on THIS fence every one of them is asserted through the
// owner's rendered control surface — a refusal the route produced and the view
// does not show, or shows inexactly, is a D7 regression even when the HTTP body
// is correct. I5c sits with D7 because D7's row is the one that owns
// "stale/never-verified challenge ROUTING": the click must reach the challenge
// instead of the gateway. L8h/L9b/L9d/L9e are the fake-fleet fence class
// asserted over the same render. L2d and L15b sit with D8 because they are
// asserted over D8's OWN outbound POST — the number-match confirm is exactly
// where a naive implementation reaches for `--force` or forgets the
// idempotency key. Only TWO distinct units appear across every rejection, so a
// red report stays `missing_acceptance` and never trips the J1c >2-unit
// plan_defect rule. The contract's negative control
// (FENCE_STUB=D7 --expect-red I5c) discriminates D7 through I5c, which is why
// I5c must be, and is, a D7-attributed id here.
//
// THE FAKE FLEET IS THIS JOURNEY'S OWN SERVER, NOT THE DEPLOYED APP. The
// journey spawns the real `createApiServer` in a child process with an xmac
// `status` fixture, a machines.conf fixture, a protected-role fixture, an
// XMAC_LOG WoL fixture and a PATH gateway-spy that IS the fake host: the spy
// records every argv AND mutates the status fixture, so UP-to-STOPPING-to-DOWN
// is an observed host-state change, not a claim about a mock. The real fleet is
// unreachable (every fixture IP is in TEST-NET-1 192.0.2.0/24) and no real box
// can be addressed. FENCE_ORIGIN is deliberately ignored: a fence that read a
// deployed origin could not arm the runtime, install a spy or author lease and
// role fixtures, so nothing on this row would be observable.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. XMACHINES_ARM=1. The power routes answer 403 `unarmed` otherwise, so an
//     unarmed E4 could not observe a single one of its ids. Arming here reaches
//     the PATH spy on a TEST-NET address, never a machine — the A0.3 boundary
//     is what makes that safe, and the C4 route suite arms the same way.
//     L9d is therefore read on this row as: every gateway invocation is
//     spy-recorded against the fake fleet, no wake addresses anything except
//     the one machine the owner submitted an ON for (D1a's target), and
//     `wakeonlan`, bare `xmac`, `run`, `claim` and `release` are all zero. A
//     literal zero-wake-calls reading would contradict D1a, which the same
//     contract row demands; conversely L9d does not assert that the ON control
//     exists — D1a owns that, so a wake-free run satisfies L9d.
//  2. No canonical DOM contract for D7/D8 exists yet, so each control and each
//     refusal is looked for across an alias set (testids, data-attributes, and
//     an accessible-text fallback inside the detail section). That broadens
//     WHERE the evidence may appear; it does not weaken WHAT must be true — the
//     rendered refusal is compared for EQUALITY against the string the route
//     itself returned in the same exchange, so the journey never invents copy.
//  3. L8h. No landed route exposes the A9 oracle, so "a power transition
//     timeout ends in ERROR rather than DOWN" is asserted as: the spy records
//     the timed-out `down`, writes {"state":"DOWN","timeout":true} into the
//     scratch oracle fixture (PowerOracle maps timeout to ERROR) and leaves the
//     host UP; the rendered state for that machine must then read `error` and
//     must not read `down`/`offline`. If D7 cannot surface that without a
//     C-row field, this id is the one that says so — it is asserted at full
//     strength rather than weakened into something already green.
//  4. Three owner identities (ids 1/2/3, three tokens on the same stub
//     authService) spread the specimens across the route's own per-owner
//     10-per-minute power rate limit. A single owner would be 429'd partway
//     through and the later ids would be red for a throttle rather than for a
//     capability. The limit itself is A6's and is asserted on E11, not here.
//  5. The owner session is a stub authService inside the scratch server (the
//     C1/C4 pattern). These are render-and-gateway assertions, not the auth
//     matrix, which A2c/L6* own elsewhere.
//  6. BASELINE NOTE, recorded rather than engineered away: the Off button and
//     the refusal block that C4 landed already satisfy several of the rendered
//     refusal ids. D7 will not turn those from red to green. They are asserted
//     here at full strength anyway, because this fence is where they must keep
//     being true once D7 re-renders the controls, and the negative control
//     still discriminates D7 through I5c.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E4';
const ACCEPTANCE_IDS = [
  'D1a', 'D2b', 'D2c', 'D2d', 'D2e', 'I5c',
  'L1b', 'L1c', 'L1d', 'L1e',
  'L2a', 'L2b', 'L2c', 'L2d',
  'L4a', 'L4b', 'L4c',
  'L8h', 'L9b', 'L9d', 'L9e', 'L15b',
];
// id -> the contributor blamed when it rejects. Exactly two distinct units.
const COVERED: Record<string, string> = {
  D1a: 'D7', D2b: 'D7', D2c: 'D7', D2d: 'D7', D2e: 'D7', I5c: 'D7',
  L1b: 'D7', L1c: 'D7', L1d: 'D7', L1e: 'D7',
  L2a: 'D7', L2b: 'D7', L2c: 'D7',
  L4a: 'D7', L4b: 'D7', L4c: 'D7',
  L8h: 'D7', L9b: 'D7', L9d: 'D7', L9e: 'D7',
  L2d: 'D8', L15b: 'D8',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const SELFTEST_MARKER = 'e4-spy-selftest';

// Three owner sessions on the same stub authService. Each one has its own
// per-owner power rate-limit bucket (ambiguity 4).
const OWNERS = {
  one: { token: 'e4-fence-owner-1', id: 1 },
  two: { token: 'e4-fence-owner-2', id: 2 },
  three: { token: 'e4-fence-owner-3', id: 3 },
} as const;

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media, signal, glimmer) so no assertion here can be aimed at, or
// accidentally satisfied by, a real box. Every address is TEST-NET-1.
const ANVIL = 'e4-anvil';       // UP, verified, idle    -> the clean owner-Off
const EMBER = 'e4-ember';       // DOWN, verified        -> the ON target
const CLAMP = 'e4-clamp';       // UP, lease held        -> lease refusal
const VISE = 'e4-vise';         // UP, GPU process busy  -> busy refusal
const TORQUE = 'e4-torque';     // UP, ssh hangs         -> timeout is BUSY
const SPANNER = 'e4-spanner';   // UP, ssh exit 1 empty  -> error-empty is BUSY
const RIVET = 'e4-rivet';       // UP, ssh exit 255      -> unreachable is BUSY
const STALL = 'e4-stall';       // UP, down times out    -> ERROR, not DOWN
const DRIFT = 'e4-drift';       // UP, never-verified    -> challenge routing
const BEACON = 'e4-beacon';     // .174 while signal live
const SHIMMER = 'e4-shimmer';   // .179 while glimmer live
const VAULT = 'e4-vault';       // .169 during the archive lease

const LEASE_HOLDER = 'xmac-claim-e4-mill-render';
const ARCHIVE_LEASE = 'xmac-claim-hdd-17-transcript-archive';
const GPU_BUSY = 'gpu-process-busy';

type Row = { name: string; ip: string; state: 'UP' | 'DOWN'; role: string };
const FLEET: Row[] = [
  { name: ANVIL, ip: '192.0.2.40', state: 'UP', role: 'compute' },
  { name: CLAMP, ip: '192.0.2.41', state: 'UP', role: 'compute' },
  { name: VISE, ip: '192.0.2.42', state: 'UP', role: 'compute' },
  { name: TORQUE, ip: '192.0.2.43', state: 'UP', role: 'compute' },
  { name: SPANNER, ip: '192.0.2.44', state: 'UP', role: 'compute' },
  { name: RIVET, ip: '192.0.2.45', state: 'UP', role: 'compute' },
  { name: STALL, ip: '192.0.2.46', state: 'UP', role: 'compute' },
  { name: DRIFT, ip: '192.0.2.47', state: 'UP', role: 'media' },
  { name: EMBER, ip: '192.0.2.48', state: 'DOWN', role: 'compute' },
  { name: BEACON, ip: '192.0.2.174', state: 'UP', role: 'signal' },
  { name: SHIMMER, ip: '192.0.2.179', state: 'UP', role: 'glimmer' },
  { name: VAULT, ip: '192.0.2.169', state: 'UP', role: 'storage' },
];

// The exact refusal details the landed routes produce for each specimen. The
// journey never authors UI copy: it compares the rendered node against the
// string the SAME exchange returned, and against these route-owned literals.
const EXACT = {
  lease: `active lease: ${LEASE_HOLDER}`,
  busy: `cannot confirm idle: ${GPU_BUSY}`,
  errorEmpty: 'cannot confirm idle: ssh-error-empty',
};

// Control and refusal surfaces. Alias sets, not a prescribed DOM (ambiguity 2).
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
const CHALLENGE_SEL = [
  '[data-testid="xmachines-force-challenge"]',
  '[data-testid="xmachines-number-match"]',
  '[data-testid="xmachines-off-challenge"]',
  '[data-testid="xmachines-challenge"]',
  '[data-challenge]',
].join(', ');

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
// then mutates the status fixture and an oracle fixture, so a power action has
// an observable HOST-STATE consequence. That is what makes L9e's `via` honest —
// the journey reads the host's state back, it does not read a mock's argv and
// declare the machine off.
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
  oracleDir: string;
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

// The gateway-spy that is also the fake host.
function gatewayScript(): string {
  return `#!/bin/bash
set -u
log="\${E4_SPY_LOG}"
status="\${E4_STATUS_FIXTURE}"
trans="\${E4_TRANSITIONS_LOG}"
oracle="\${E4_ORACLE_DIR}"
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
    printf '%s' '{"state":"STARTING"}' > "$oracle/$machine.json"
    sleep 0.3
    set_state UP
    note UP
    printf '%s' '{"state":"UP","observations":[{"method":"ping","up":true},{"method":"ssh","up":true}]}' > "$oracle/$machine.json"
    ;;
  down)
    note STOPPING
    printf '%s' '{"state":"STOPPING"}' > "$oracle/$machine.json"
    if [ "$machine" = "\${E4_STALL_MACHINE}" ]; then
      # The transition never completes: the host stays UP and the oracle records
      # a timed-out transition, which PowerOracle maps to ERROR (never DOWN).
      printf '%s' '{"state":"DOWN","timeout":true}' > "$oracle/$machine.json"
      note TIMEOUT
      exit 0
    fi
    sleep 0.6
    set_state DOWN
    note DOWN
    printf '%s' '{"state":"DOWN"}' > "$oracle/$machine.json"
    ;;
esac
exit 0
`;
}

// The busy preflight's ssh. A1/A13 run `bash -c "ssh ... user@ip bash -c '...'"`,
// so the scenario is chosen by the TARGET ADDRESS, never by a flag this journey
// passes — each machine's preflight behaviour is a property of the fake fleet.
function sshScript(): string {
  return `#!/bin/bash
set -u
log="\${E4_SSH_LOG}"
{
  printf '%s' 'ssh'
  for arg in "$@"; do printf '\\t%s' "$arg"; done
  printf '\\n'
} >> "$log"
target=""
for arg in "$@"; do
  case "$arg" in
    *@*) target="$arg" ;;
  esac
done
case "$target" in
  *192.0.2.42) printf '%s\\n' '${GPU_BUSY}'; exit 0 ;;
  *192.0.2.43) sleep 12; exit 0 ;;
  *192.0.2.44) exit 1 ;;
  *192.0.2.45) exit 255 ;;
  *) exit 0 ;;
esac
`;
}

function statusLines(rows: Row[]): string {
  return `${rows.map((row) => `${row.name} ${row.ip} ${row.state} leases=() ${row.role}`).join('\n')}\n`;
}

function confLines(rows: Row[]): string {
  // A non-empty busy-check on every row, so the fail-closed preflight really
  // runs for every Off specimen instead of being skipped as unconfigured.
  return `${rows
    .map((row, i) => `${row.name}|${row.ip}|02:00:00:00:00:${40 + i}|agjrom|${row.role}|echo e4-fixture-busy-check`)
    .join('\n')}\n`;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Verified WoL evidence (a WAKE followed by a later UP) for every machine
// except DRIFT, which has no WAKE at all and is therefore never-verified.
function wolLog(): string {
  const now = Date.now();
  const lines: string[] = [];
  for (const row of FLEET) {
    if (row.name === DRIFT) continue;
    lines.push(`${stamp(now - 30 * 60 * 1000)} WAKE ${row.name} 1`);
    lines.push(`${stamp(now - 20 * 60 * 1000)} UP ${row.name} 1`);
  }
  return `${lines.join('\n')}\n`;
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e4-power-'));
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
  const oracleDir = path.join(dir, 'oracle');
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
  fs.mkdirSync(oracleDir, { recursive: true });
  fs.writeFileSync(transitions, '');
  fs.writeFileSync(xmacLog, wolLog());

  // The lease CLAMP is held under, read from the real lease location A13 and
  // the A10 coordinator both read: $XMAC_STATE/leases/<machine>/<holder>.
  fs.mkdirSync(path.join(stateDir, 'leases', CLAMP), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'leases', CLAMP, LEASE_HOLDER), '');

  // Protected roles, by observed address: .174 while signal is live, .179 while
  // glimmer is live, .169 while the transcript-archive lease is held.
  fs.mkdirSync(protectedDir, { recursive: true });
  fs.writeFileSync(
    path.join(protectedDir, 'status.json'),
    JSON.stringify(Object.fromEntries(FLEET.map((row) => [row.name, { ip: row.ip }]))),
  );
  fs.writeFileSync(path.join(protectedDir, 'roles.json'), JSON.stringify({ signal: 'live', glimmer: 'live' }));
  fs.writeFileSync(path.join(protectedDir, 'leases.json'), JSON.stringify({ names: [ARCHIVE_LEASE] }));
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
    XMAC_ORACLE_FIXTURE_DIR: oracleDir,
    E4_SPY_LOG: spyLog,
    E4_SSH_LOG: sshLog,
    E4_STATUS_FIXTURE: statusPath,
    E4_TRANSITIONS_LOG: transitions,
    E4_ORACLE_DIR: oracleDir,
    E4_STALL_MACHINE: STALL,
    E4_OWNER_TOKEN_ONE: OWNERS.one.token,
    E4_OWNER_TOKEN_TWO: OWNERS.two.token,
    E4_OWNER_TOKEN_THREE: OWNERS.three.token,
  };
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  return {
    dir, bin, spyLog, sshLog, statusPath, confPath, metricsPath,
    stateDir, xmacLog, oracleDir, transitions, protectedDir, env,
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

function downRowsFor(log: string, machine: string): SpyRow[] {
  return gatewayRows(log).filter((row) => row.argv[0] === 'down' && row.argv[1] === machine);
}

function forceRows(log: string): SpyRow[] {
  return spyRows(log).filter((row) => row.argv.includes('--force'));
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

function oracleFixture(oracleDir: string, machine: string): Record<string, unknown> | null {
  const file = path.join(oracleDir, `${machine}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function waitForGatewayRow(log: string, predicate: (row: SpyRow) => boolean, timeoutMs = 6_000): Promise<boolean> {
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
  [process.env.E4_OWNER_TOKEN_ONE, { id: 1, role: 'owner', username: 'owner' }],
  [process.env.E4_OWNER_TOKEN_TWO, { id: 2, role: 'owner', username: 'owner2' }],
  [process.env.E4_OWNER_TOKEN_THREE, { id: 3, role: 'owner', username: 'owner3' }],
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
console.log('E4-SERVER-READY ' + app.server.address().port);
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
    const match = out.match(/E4-SERVER-READY (\d+)/);
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

// A visible, pressable control: an alias selector first, then an
// accessible-text fallback inside the detail section (ambiguity 2).
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

async function detailBodyText(page: import('@playwright/test').Page): Promise<string> {
  const body = (await page.locator('body').textContent().catch(() => '')) || '';
  return body.replace(/\s+/g, ' ').trim();
}

// One Off specimen: press the product Off control and report what the route
// answered and what the page then showed.
type OffOutcome = {
  clicked: string;
  calls: PowerCall[];
  refusals: string[];
  bodyText: string;
  state: string;
};

async function pressOff(
  browser: import('@playwright/test').Browser,
  machine: string,
  owner: { token: string; id: number },
  settleMs = 2_500,
): Promise<OffOutcome> {
  const detail = await openDetail(browser, machine, owner);
  try {
    const clicked = await clickControl(detail.page, OFF_SEL, /^(turn off|power off|off|shut ?down)$/i);
    if (clicked) await detail.page.waitForTimeout(settleMs);
    return {
      clicked,
      calls: [...detail.calls],
      refusals: await texts(detail.page, REFUSAL_SEL),
      bodyText: await detailBodyText(detail.page),
      state: await renderedState(detail.page),
    };
  } finally {
    await detail.close();
  }
}

// The state the product shows on a FRESH load, i.e. after the host has moved.
async function reloadState(
  browser: import('@playwright/test').Browser,
  machine: string,
  owner: { token: string; id: number },
): Promise<{ state: string; bodyText: string }> {
  const detail = await openDetail(browser, machine, owner);
  try {
    return { state: await renderedState(detail.page), bodyText: await detailBodyText(detail.page) };
  } finally {
    await detail.close();
  }
}

function offCall(outcome: OffOutcome): PowerCall | undefined {
  return outcome.calls.filter((call) => /\/power\/off$/.test(call.url)).pop();
}

function rendersExactly(outcome: OffOutcome, exact: string): boolean {
  return outcome.refusals.some((text) => text === exact);
}

// The timeout specimen's detail names the platform's own timeout error
// (`spawnSync bash ETIMEDOUT`), so the literal is the ROUTE's, not this
// journey's: the rendered node must equal whatever the route said in that
// exchange, which is the same exactness rule D2e applies.
function rendersRouteDetail(outcome: OffOutcome): { ok: boolean; fromRoute: string } {
  const fromRoute = String(offCall(outcome)?.body?.detail ?? '');
  return { ok: Boolean(fromRoute) && outcome.refusals.some((text) => text === fromRoute), fromRoute };
}

// Every rendered refusal the D7 test observed, with the string the route
// returned in the SAME exchange. L9b is asserted over this ledger.
const refusalLedger: Array<{ machine: string; rendered: string; fromRoute: string }> = [];

function recordRefusal(machine: string, outcome: OffOutcome): string {
  const call = offCall(outcome);
  const fromRoute = typeof call?.body?.detail === 'string'
    ? (call!.body!.detail as string)
    : typeof call?.body?.reason === 'string' ? (call!.body!.reason as string) : '';
  const rendered = outcome.refusals.find((text) => text.length > 0 && fromRoute && text === fromRoute)
    ?? outcome.refusals.find((text) => fromRoute && text.includes(fromRoute))
    ?? '';
  refusalLedger.push({ machine, rendered, fromRoute });
  return fromRoute;
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
// D7 — the owner's normal ON and Off controls, driven through the production
// routes: one clean owner-Off that really moves the host, every guard refusal
// rendered exactly as the route stated it, and a never-verified box routed to a
// challenge instead of the gateway.
// Owns: D1a D2b D2c D2d D2e I5c L1b L1c L1d L1e L2a L2b L2c L4a L4b L4c
//       L8h L9b L9d L9e
// ---------------------------------------------------------------------------
test('test_d7_owner_power_controls_drive_production_routes_and_render_every_exact_guard_refusal', async ({ browser }) => {
  test.setTimeout(150_000);
  const results: boolean[] = [];
  const log = scratch?.spyLog ?? '';
  const statusPath = scratch?.statusPath ?? '';
  const transitions = scratch?.transitions ?? '';
  const oracleDir = scratch?.oracleDir ?? '';
  const bootNote = bootError ? ` [${bootError}]` : '';

  // ---- D1a: the ON control submits an ON through the gateway ---------------
  let onOutcome: { clicked: string; calls: PowerCall[]; progress: string[]; bodyText: string } = {
    clicked: '', calls: [], progress: [], bodyText: '',
  };
  let emberUpArgv = false;
  if (!bootError) {
    const detail = await openDetail(browser, EMBER, OWNERS.two);
    try {
      onOutcome.clicked = await clickControl(detail.page, ON_SEL, ON_TEXT);
      if (onOutcome.clicked) await detail.page.waitForTimeout(1_500);
      onOutcome.progress = await texts(detail.page, PROGRESS_SEL);
      onOutcome.bodyText = await detailBodyText(detail.page);
      onOutcome.calls = [...detail.calls];
    } finally {
      await detail.close();
    }
    emberUpArgv = await waitForGatewayRow(log, (row) => row.argv[0] === 'up' && row.argv[1] === EMBER);
  }

  results.push(await guardedCheck('D1a', COVERED.D1a, async () => {
    if (!onOutcome.clicked) {
      throw new Error(`no visible ON control on the ${EMBER} detail page (tried ${ON_SEL} and a ${ON_TEXT} text fallback); an owner cannot submit an ON action at all${bootNote}`);
    }
    const call = onOutcome.calls.filter((c) => /\/power\/on$/.test(c.url)).pop();
    if (!call) {
      throw new Error(`the ON control issued no POST to the production power/on route (power calls=${JSON.stringify(onOutcome.calls.map((c) => c.url))})`);
    }
    if (call.status !== 202) {
      throw new Error(`power/on answered ${call.status} ${JSON.stringify(call.body)}, expected 202 in-progress`);
    }
    if (!emberUpArgv) {
      throw new Error(`the gateway spy recorded no 'up ${EMBER}' invocation, so the ON never reached the xmac gateway (rows=${JSON.stringify(gatewayRows(log).map((r) => r.argv))})`);
    }
    const shownProgress = onOutcome.progress.some((text) => text.length > 0)
      || PROGRESS_TEXT.test(onOutcome.bodyText);
    if (!shownProgress) {
      throw new Error(`the 202 in-progress ON rendered no in-progress state (tried ${PROGRESS_SEL} and a ${PROGRESS_TEXT} text fallback)`);
    }
    if (hostStateOf(statusPath, EMBER) !== 'UP') {
      throw new Error(`the fake host never came up: status fixture still reports ${EMBER}=${hostStateOf(statusPath, EMBER)}`);
    }
  }));

  // ---- the lease specimen -------------------------------------------------
  const lease = bootError ? null : await pressOff(browser, CLAMP, OWNERS.one);
  if (lease) recordRefusal(CLAMP, lease);

  results.push(await guardedCheck('D2b', COVERED.D2b, async () => {
    if (!lease) throw new Error(`no lease specimen was observed${bootNote}`);
    if (!lease.clicked) throw new Error(`no visible Off control on the ${CLAMP} detail page (tried ${OFF_SEL})`);
    const call = offCall(lease);
    if (call?.body?.reason !== 'active-lease') {
      throw new Error(`power/off on a leased machine answered ${call?.status} ${JSON.stringify(call?.body)}, expected reason=active-lease`);
    }
    if (!rendersExactly(lease, EXACT.lease)) {
      throw new Error(`the leased-machine refusal was not rendered exactly: expected a node reading ${JSON.stringify(EXACT.lease)}, rendered ${JSON.stringify(lease.refusals)}`);
    }
  }));

  results.push(await guardedCheck('L2b', COVERED.L2b, async () => {
    if (!lease) throw new Error(`no lease specimen was observed${bootNote}`);
    const spawned = downRowsFor(log, CLAMP);
    if (spawned.length !== 0) {
      throw new Error(`a lease did not block normal owner Off: the gateway spy recorded ${JSON.stringify(spawned.map((r) => r.argv))}`);
    }
  }));

  // ---- the busy specimen --------------------------------------------------
  const busy = bootError ? null : await pressOff(browser, VISE, OWNERS.one);
  if (busy) recordRefusal(VISE, busy);

  results.push(await guardedCheck('D2c', COVERED.D2c, async () => {
    if (!busy) throw new Error(`no busy specimen was observed${bootNote}`);
    if (!busy.clicked) throw new Error(`no visible Off control on the ${VISE} detail page (tried ${OFF_SEL})`);
    const call = offCall(busy);
    if (call?.body?.reason !== 'cannot-confirm-idle') {
      throw new Error(`power/off on a GPU-busy machine answered ${call?.status} ${JSON.stringify(call?.body)}, expected reason=cannot-confirm-idle`);
    }
    if (!rendersExactly(busy, EXACT.busy)) {
      throw new Error(`the GPU-process refusal was not rendered exactly: expected ${JSON.stringify(EXACT.busy)}, rendered ${JSON.stringify(busy.refusals)}`);
    }
  }));

  results.push(await guardedCheck('L2c', COVERED.L2c, async () => {
    if (!busy) throw new Error(`no busy specimen was observed${bootNote}`);
    const spawned = downRowsFor(log, VISE);
    if (spawned.length !== 0) {
      throw new Error(`the busy preflight did not block normal owner Off: spy recorded ${JSON.stringify(spawned.map((r) => r.argv))}`);
    }
  }));

  results.push(await guardedCheck('L1e', COVERED.L1e, async () => {
    if (!busy) throw new Error(`no busy specimen was observed${bootNote}`);
    const call = offCall(busy);
    const detailText = typeof call?.body?.detail === 'string' ? (call!.body!.detail as string) : '';
    if (!detailText.includes('cannot confirm idle')) {
      throw new Error(`the fail-closed refusal body does not say 'cannot confirm idle': ${JSON.stringify(call?.body)}`);
    }
    if (!busy.refusals.some((text) => text.includes('cannot confirm idle'))) {
      throw new Error(`'cannot confirm idle' never reached the owner's screen: rendered ${JSON.stringify(busy.refusals)}`);
    }
  }));

  // ---- the three fail-closed preflight failures ---------------------------
  const timeout = bootError ? null : await pressOff(browser, TORQUE, OWNERS.one, 13_000);
  if (timeout) recordRefusal(TORQUE, timeout);
  const errorEmpty = bootError ? null : await pressOff(browser, SPANNER, OWNERS.one);
  if (errorEmpty) recordRefusal(SPANNER, errorEmpty);
  const unreachable = bootError ? null : await pressOff(browser, RIVET, OWNERS.one);
  if (unreachable) recordRefusal(RIVET, unreachable);

  results.push(await guardedCheck('L1b', COVERED.L1b, async () => {
    if (!timeout) throw new Error(`no busy-timeout specimen was observed${bootNote}`);
    const call = offCall(timeout);
    const detail = String(call?.body?.detail ?? '');
    if (call?.body?.reason !== 'cannot-confirm-idle' || !detail.includes('cannot confirm idle')) {
      throw new Error(`a busy-check timeout was not treated as BUSY: ${call?.status} ${JSON.stringify(call?.body)}`);
    }
    if (!/tim(e|ed)?.?out/i.test(detail)) {
      throw new Error(`the fail-closed refusal does not attribute the timeout: ${JSON.stringify(detail)}`);
    }
    if (downRowsFor(log, TORQUE).length !== 0) {
      throw new Error(`a timed-out busy check still spawned a gateway Off for ${TORQUE}`);
    }
    const rendered = rendersRouteDetail(timeout);
    if (!rendered.ok) {
      throw new Error(`the timeout refusal was not rendered exactly: route said ${JSON.stringify(rendered.fromRoute)}, rendered ${JSON.stringify(timeout.refusals)}`);
    }
  }));

  results.push(await guardedCheck('L1c', COVERED.L1c, async () => {
    if (!errorEmpty) throw new Error(`no error-empty specimen was observed${bootNote}`);
    const call = offCall(errorEmpty);
    if (call?.body?.reason !== 'cannot-confirm-idle' || !String(call?.body?.detail ?? '').includes('ssh-error-empty')) {
      throw new Error(`empty output from a failed busy check was not treated as BUSY: ${call?.status} ${JSON.stringify(call?.body)}`);
    }
    if (downRowsFor(log, SPANNER).length !== 0) {
      throw new Error(`an errored busy check still spawned a gateway Off for ${SPANNER}`);
    }
    if (!rendersExactly(errorEmpty, EXACT.errorEmpty)) {
      throw new Error(`the error-empty refusal was not rendered exactly: expected ${JSON.stringify(EXACT.errorEmpty)}, rendered ${JSON.stringify(errorEmpty.refusals)}`);
    }
  }));

  results.push(await guardedCheck('L1d', COVERED.L1d, async () => {
    if (!unreachable) throw new Error(`no unreachable specimen was observed${bootNote}`);
    const call = offCall(unreachable);
    if (call?.body?.reason !== 'cannot-confirm-idle') {
      throw new Error(`an unreachable host was not treated as BUSY: ${call?.status} ${JSON.stringify(call?.body)}`);
    }
    if (downRowsFor(log, RIVET).length !== 0) {
      throw new Error(`an unreachable busy check still spawned a gateway Off for ${RIVET}`);
    }
    if (!rendersExactly(unreachable, EXACT.errorEmpty)) {
      throw new Error(`the unreachable refusal was not rendered exactly: expected ${JSON.stringify(EXACT.errorEmpty)}, rendered ${JSON.stringify(unreachable.refusals)}`);
    }
  }));

  // ---- the clean owner-Off that really moves the host ---------------------
  const clean = bootError ? null : await pressOff(browser, ANVIL, OWNERS.two);
  const cleanLanded = bootError ? false : await waitForGatewayRow(log, (row) => row.argv[0] === 'down' && row.argv[1] === ANVIL);
  if (cleanLanded) await new Promise((resolve) => setTimeout(resolve, 1_500));
  const anvilAfter = bootError ? null : await reloadState(browser, ANVIL, OWNERS.two);

  results.push(await guardedCheck('D2d', COVERED.D2d, async () => {
    if (!clean) throw new Error(`no clean owner-Off specimen was observed${bootNote}`);
    if (!clean.clicked) throw new Error(`no visible Off control on the ${ANVIL} detail page (tried ${OFF_SEL})`);
    const call = offCall(clean);
    if (call?.status !== 202) {
      throw new Error(`a clear owner Off answered ${call?.status} ${JSON.stringify(call?.body)}, expected 202 in-progress`);
    }
    const rows = downRowsFor(log, ANVIL);
    if (rows.length !== 1 || JSON.stringify(rows[0].argv) !== JSON.stringify(['down', ANVIL, '--owner-off'])) {
      throw new Error(`the owner Off argv was ${JSON.stringify(rows.map((r) => r.argv))}, expected exactly one ['down','${ANVIL}','--owner-off'] — only guard 3 may be bypassed`);
    }
  }));

  results.push(await guardedCheck('L2a', COVERED.L2a, async () => {
    if (!clean) throw new Error(`no clean owner-Off specimen was observed${bootNote}`);
    const rows = downRowsFor(log, ANVIL);
    if (!rows.some((row) => row.argv.includes('--owner-off'))) {
      throw new Error(`no --owner-off invocation for ${ANVIL}: ${JSON.stringify(rows.map((r) => r.argv))}`);
    }
    const forced = forceRows(log);
    if (forced.length !== 0) {
      throw new Error(`guard 3 was bypassed with blanket force: ${JSON.stringify(forced.map((r) => r.argv))}`);
    }
  }));

  results.push(await guardedCheck('D2e', COVERED.D2e, async () => {
    // The exactness contract: some rendered node must EQUAL the string the
    // route itself returned in that exchange, for every refusal specimen.
    const inexact = refusalLedger.filter((entry) => entry.fromRoute && entry.rendered !== entry.fromRoute);
    const missing = refusalLedger.filter((entry) => !entry.fromRoute);
    if (refusalLedger.length === 0) {
      throw new Error(`no refusal was observed at all, so exactness is unobservable${bootNote}`);
    }
    if (missing.length > 0) {
      throw new Error(`these specimens produced no route-side refusal string: ${JSON.stringify(missing.map((e) => e.machine))}`);
    }
    if (inexact.length > 0) {
      throw new Error(`the UI did not render the exact normal-Off refusal reason for ${JSON.stringify(inexact.map((e) => ({ machine: e.machine, route: e.fromRoute, rendered: e.rendered })))}`);
    }
  }));

  // ---- the three protected roles -----------------------------------------
  const signalRefusal = bootError ? null : await pressOff(browser, BEACON, OWNERS.two);
  if (signalRefusal) recordRefusal(BEACON, signalRefusal);
  const glimmerRefusal = bootError ? null : await pressOff(browser, SHIMMER, OWNERS.two);
  if (glimmerRefusal) recordRefusal(SHIMMER, glimmerRefusal);
  const archiveRefusal = bootError ? null : await pressOff(browser, VAULT, OWNERS.two);
  if (archiveRefusal) recordRefusal(VAULT, archiveRefusal);

  async function protectedCheck(
    id: string,
    machine: string,
    role: string,
    outcome: OffOutcome | null,
  ): Promise<boolean> {
    return guardedCheck(id, COVERED[id], async () => {
      if (!outcome) throw new Error(`no protected-role specimen was observed for ${machine}${bootNote}`);
      if (!outcome.clicked) throw new Error(`no visible Off control on the ${machine} detail page (tried ${OFF_SEL})`);
      const call = offCall(outcome);
      if (call?.body?.reason !== 'protected-role' || call?.body?.role !== role) {
        throw new Error(`${machine} was not refused as the protected ${role} role: ${call?.status} ${JSON.stringify(call?.body)}`);
      }
      if (downRowsFor(log, machine).length !== 0) {
        throw new Error(`a protected-role refusal still spawned a gateway Off for ${machine}`);
      }
      if (!outcome.refusals.some((text) => text.includes(role)) && !outcome.bodyText.includes(role)) {
        throw new Error(`the ${role} protection was never named on the owner's screen: rendered ${JSON.stringify(outcome.refusals)}`);
      }
    });
  }

  results.push(await protectedCheck('L4a', BEACON, 'signal', signalRefusal));
  results.push(await protectedCheck('L4b', SHIMMER, 'glimmer', glimmerRefusal));
  results.push(await protectedCheck('L4c', VAULT, 'transcript-archive', archiveRefusal));

  // ---- the never-verified box is routed to a challenge, not the gateway ---
  const drift = bootError ? null : await pressOff(browser, DRIFT, OWNERS.one);

  results.push(await guardedCheck('I5c', COVERED.I5c, async () => {
    if (!drift) throw new Error(`no never-verified specimen was observed${bootNote}`);
    if (!drift.clicked) throw new Error(`no visible Off control on the ${DRIFT} detail page (tried ${OFF_SEL})`);
    const call = offCall(drift);
    if (call?.body?.reason !== 'force-confirmation-required') {
      throw new Error(`a never-verified Off was not routed through the force challenge: ${call?.status} ${JSON.stringify(call?.body)}`);
    }
    if (typeof call?.body?.challengeId !== 'string' || typeof call?.body?.displayNumber !== 'number') {
      throw new Error(`the challenge route answered without a usable challenge: ${JSON.stringify(call?.body)}`);
    }
    if (downRowsFor(log, DRIFT).length !== 0) {
      throw new Error(`a never-verified Off spawned a gateway Off before any challenge was consumed: ${JSON.stringify(downRowsFor(log, DRIFT).map((r) => r.argv))}`);
    }
    const shown = drift.refusals.some((text) => text.length > 0) || /confirm|challenge|unverified/i.test(drift.bodyText);
    if (!shown) {
      throw new Error(`the owner was given no visible sign that Off now needs a confirmation: rendered ${JSON.stringify(drift.refusals)}`);
    }
  }));

  // ---- the transition that timed out -------------------------------------
  const stalled = bootError ? null : await pressOff(browser, STALL, OWNERS.two);
  const stalledLanded = bootError ? false : await waitForGatewayRow(log, (row) => row.argv[0] === 'down' && row.argv[1] === STALL);
  if (stalledLanded) await new Promise((resolve) => setTimeout(resolve, 800));
  const stallAfter = bootError ? null : await reloadState(browser, STALL, OWNERS.two);

  results.push(await guardedCheck('L8h', COVERED.L8h, async () => {
    if (!stalled) throw new Error(`no timed-out transition specimen was observed${bootNote}`);
    const call = offCall(stalled);
    if (call?.status !== 202) {
      throw new Error(`the Off that should time out never started: ${call?.status} ${JSON.stringify(call?.body)}`);
    }
    if (!stalledLanded) {
      throw new Error(`the gateway spy recorded no 'down ${STALL}', so no transition was started to time out`);
    }
    const fixture = oracleFixture(oracleDir, STALL);
    if (fixture?.timeout !== true) {
      throw new Error(`the fake host did not record a timed-out transition for ${STALL}: oracle fixture=${JSON.stringify(fixture)}`);
    }
    const state = stallAfter?.state ?? '';
    if (/\bdown\b|offline/.test(state)) {
      throw new Error(`a timed-out transition was rendered as ${JSON.stringify(state)}; a timeout must end in ERROR, never DOWN`);
    }
    if (!/error/i.test(state) && !/error/i.test(stallAfter?.bodyText ?? '')) {
      throw new Error(`a timed-out transition was rendered as ${JSON.stringify(state)}; the owner is never shown the ERROR outcome`);
    }
  }));

  // ---- the fence-class assertions over the same render --------------------
  results.push(await guardedCheck('L9b', COVERED.L9b, async () => {
    const shown = refusalLedger.filter((entry) => entry.fromRoute && entry.rendered.includes(entry.fromRoute));
    const distinct = new Set(shown.map((entry) => entry.rendered));
    if (refusalLedger.length < 3) {
      throw new Error(`only ${refusalLedger.length} refusal specimen(s) were observed, so a rendered-string assertion would be vacuous${bootNote}`);
    }
    if (distinct.size < 3) {
      throw new Error(`this fence asserted ${distinct.size} distinct RENDERED refusal string(s) across ${refusalLedger.length} specimens: ${JSON.stringify(refusalLedger)}`);
    }
  }));

  results.push(await guardedCheck('L9d', COVERED.L9d, async () => {
    const rows = spyRows(log);
    const spyLive = rows.some((row) => row.command === 'ping' && row.argv.includes(SELFTEST_MARKER));
    if (!spyLive) {
      throw new Error(`the gateway spy recorded no self-test row, so "no forbidden calls" would be vacuous — the spy was never on PATH (rows=${rows.length})${bootNote}`);
    }
    const wakeonlan = rows.filter((row) => row.command === 'wakeonlan' || row.command === 'xmac');
    if (wakeonlan.length > 0) {
      throw new Error(`the journey reached a non-gateway power binary: ${JSON.stringify(wakeonlan.slice(0, 3))}`);
    }
    const gateway = gatewayRows(log);
    const forbidden = gateway.filter((row) => ['run', 'claim', 'release', 'wake'].includes(row.argv[0] ?? ''));
    if (forbidden.length > 0) {
      throw new Error(`the journey issued forbidden gateway verbs: ${JSON.stringify(forbidden.map((r) => r.argv))}`);
    }
    const strayWakes = gateway.filter((row) => row.argv[0] === 'up' && row.argv[1] !== EMBER);
    if (strayWakes.length > 0) {
      throw new Error(`this fence woke a machine it never asked for: ${JSON.stringify(strayWakes.map((r) => r.argv))} — the only admissible wake is the owner-submitted ON of ${EMBER}`);
    }
    const offFleet = gateway.filter((row) => !FLEET.some((machine) => machine.name === row.argv[1]));
    if (offFleet.length > 0) {
      throw new Error(`a gateway call addressed something outside the fake fleet: ${JSON.stringify(offFleet.map((r) => r.argv))}`);
    }
  }));

  results.push(await guardedCheck('L9e', COVERED.L9e, async () => {
    // The point of this id: the proof that the machine went off is the HOST's
    // own state, read back after the action. An argv row alone is refused.
    const trail = transitionRows(transitions).filter((row) => row.machine === ANVIL).map((row) => row.state);
    const stoppingAt = trail.indexOf('STOPPING');
    const downAt = trail.indexOf('DOWN');
    if (stoppingAt === -1 || downAt === -1 || downAt < stoppingAt) {
      throw new Error(`no observed UP-to-STOPPING-to-DOWN host transition for ${ANVIL}: trail=${JSON.stringify(trail)}${bootNote}`);
    }
    const host = hostStateOf(statusPath, ANVIL);
    if (host !== 'DOWN') {
      throw new Error(`the host state for ${ANVIL} reads ${JSON.stringify(host)} after the Off; an argv row is not proof that a machine powered off`);
    }
    const state = anvilAfter?.state ?? '';
    if (!state || /\bup\b/.test(state)) {
      throw new Error(`the app still renders ${ANVIL} as ${JSON.stringify(state)} after the host reached DOWN, so nothing read the host state back`);
    }
  }, 'host-state'));

  finish('E4/D7', results, 20);
});

// ---------------------------------------------------------------------------
// D8 — the separate confirmation surface: a never-verified Off is completed
// only by consuming the number-match challenge from the product UI, the launch
// it produces is `--owner-off` and never `--force`, and every power POST the
// flow issues carries an idempotency key.
// Owns: L2d L15b
// ---------------------------------------------------------------------------
test('test_d8_number_match_confirmation_consumes_the_challenge_without_force_and_with_an_idempotency_key', async ({ browser }) => {
  test.setTimeout(120_000);
  const results: boolean[] = [];
  const log = scratch?.spyLog ?? '';
  const bootNote = bootError ? ` [${bootError}]` : '';

  let calls: PowerCall[] = [];
  let challengeShown = false;
  let numberClicked = '';
  let renderedConfirmation = '';
  let routeConfirmation = '';
  let keylessStatus = 0;
  let keylessReason = '';
  let consumed = false;

  if (!bootError) {
    const detail = await openDetail(browser, DRIFT, OWNERS.three);
    try {
      // 1. Press Off. The route answers with a challenge instead of acting.
      const clicked = await clickControl(detail.page, OFF_SEL, /^(turn off|power off|off|shut ?down)$/i);
      if (clicked) await detail.page.waitForTimeout(2_000);
      const opening = detail.calls.filter((call) => /\/power\/off$/.test(call.url)).pop();
      routeConfirmation = typeof opening?.body?.confirmation === 'string' ? (opening.body.confirmation as string) : '';
      const displayNumber = typeof opening?.body?.displayNumber === 'number' ? opening.body.displayNumber : null;

      // 2. The confirmation surface: a challenge block and a pressable number.
      challengeShown = (await detail.page.locator(CHALLENGE_SEL).count()) > 0;
      const shownTexts = await texts(detail.page, `${CHALLENGE_SEL}, ${REFUSAL_SEL}`);
      renderedConfirmation = shownTexts.find((text) => routeConfirmation && text.includes(routeConfirmation.split('\n')[0])) ?? '';

      if (displayNumber !== null) {
        const buttons = detail.page.locator('button, [role="button"]');
        const count = await buttons.count();
        for (let i = 0; i < count; i++) {
          const node = buttons.nth(i);
          if (!(await node.isVisible().catch(() => false))) continue;
          const label = ((await node.textContent().catch(() => '')) || '').trim();
          if (label === String(displayNumber)) {
            await node.click({ timeout: 5_000 });
            numberClicked = label;
            break;
          }
        }
      }
      if (numberClicked) await detail.page.waitForTimeout(2_500);

      // 3. The keyless control, from the page's own origin and session: the
      //    route must refuse a power POST that carries no idempotency key.
      const keyless = await detail.page.evaluate(async (machine) => {
        const token = localStorage.getItem('agj_token') || '';
        const res = await fetch(`/api/xmachines/machines/${encodeURIComponent(machine)}/power/off`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        let body: unknown = null;
        try { body = await res.json(); } catch { body = null; }
        return { status: res.status, body };
      }, DRIFT);
      keylessStatus = keyless.status;
      keylessReason = String((keyless.body as { reason?: string } | null)?.reason ?? '');

      calls = [...detail.calls];
    } finally {
      await detail.close();
    }
    consumed = await waitForGatewayRow(log, (row) => row.argv[0] === 'down' && row.argv[1] === DRIFT);
  }

  const confirmCall = calls
    .filter((call) => /\/power\/(off|force)$/.test(call.url) && call.status === 202)
    .pop();

  results.push(await guardedCheck('L2d', COVERED.L2d, async () => {
    if (!challengeShown && !numberClicked) {
      throw new Error(`the never-verified Off exposed no number-match confirmation surface (tried ${CHALLENGE_SEL} and a pressable number matching the route's displayNumber); with no way to consume a challenge the refusal can only ever be escalated${bootNote}`);
    }
    if (!numberClicked) {
      throw new Error(`no pressable button carried the route's displayNumber, so the challenge cannot be consumed from the product surface`);
    }
    if (!renderedConfirmation) {
      throw new Error(`the confirmation text the route returned was never rendered: route said ${JSON.stringify(routeConfirmation.slice(0, 120))}`);
    }
    if (!confirmCall) {
      throw new Error(`consuming the challenge produced no accepted power POST (calls=${JSON.stringify(calls.map((c) => ({ url: c.url, status: c.status })))})`);
    }
    if (/\/power\/force$/.test(confirmCall.url)) {
      throw new Error(`a guard-3 refusal was rewritten into the force route: ${confirmCall.url}`);
    }
    if (!consumed) {
      throw new Error(`the consumed challenge never reached the gateway: rows=${JSON.stringify(gatewayRows(log).map((r) => r.argv))}`);
    }
    const rows = downRowsFor(log, DRIFT);
    if (!rows.some((row) => row.argv.includes('--owner-off'))) {
      throw new Error(`the consumed Off did not use --owner-off: ${JSON.stringify(rows.map((r) => r.argv))}`);
    }
    const forced = forceRows(log);
    if (forced.length !== 0) {
      throw new Error(`a guard-3 refusal was rewritten into --force: ${JSON.stringify(forced.map((r) => r.argv))}`);
    }
  }));

  results.push(await guardedCheck('L15b', COVERED.L15b, async () => {
    if (calls.length === 0) {
      throw new Error(`the confirmation flow issued no power POST at all, so its idempotency-key discipline is unobservable${bootNote}`);
    }
    const keyless = calls.filter((call) => call.idempotencyKey.trim() === '');
    if (keyless.length > 0) {
      throw new Error(`${keyless.length} power POST(s) from the confirmation flow carried no Idempotency-Key: ${JSON.stringify(keyless.map((c) => c.url))}`);
    }
    if (!confirmCall) {
      throw new Error(`no consumed-challenge POST was observed, so the key on the confirm request is unasserted`);
    }
    if (keylessStatus !== 400 || keylessReason !== 'idempotency-key-required') {
      throw new Error(`a power POST with no idempotency key was answered ${keylessStatus} reason=${JSON.stringify(keylessReason)}, expected 400 idempotency-key-required`);
    }
  }));

  finish('E4/D8', results, 2);
});
