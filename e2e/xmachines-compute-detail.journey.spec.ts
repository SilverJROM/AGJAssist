import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E2 — INTEGRATION: selecting ONE fake machine renders that machine's GPU
// edge states plus its CPU, fans, uptime, busy output, leases and protected
// role, with nothing fabricated.
// Contributors: D13 (one row per discovered GPU UUID plus the explicit
// unavailable / no-NVIDIA / driver-timeout / non-NVIDIA / stale states, which
// carries the D4 GPU metrics path transitively) and D5 (CPU, fans, OS uptime,
// proven-or-unknown power session, estimated on-hours, busy output, leases and
// the protected-role explanation).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E2 and
// implements none of it; it contains NO product code. Measured today against
// the landed detail view (src/web/public/xmachines-cost-view.js
// renderMachineCostDetail): a machine detail prints its name, power state, GPU
// temp, watts, uptime, sample age, provenance, busy, leases, role hint, the
// cost block, the WoL block, an Off button — and per-GPU rows carrying only
// name/util/vram/temp/power/fan. It renders NO CPU temperature, NO board fan
// RPMs, NO power-session, NO estimated on-hours, NO protected-role explanation,
// NO disabled Off control, and NO GPU state chip of any kind (the chip that
// gpu-edge-states.ts already computes is dropped on the floor by the route,
// which returns `gpuRows` only and never the surface state).
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE names WHICH
// contributor broke composition in `failing_units`:
//   test_d13_...  C1a C1b C1c C1d C1e C1f C1g L11g L11h L11i L11j L11k
//   test_d5_...   C2a C2b C2c C3a C3b C3c C3d C4a C4b C4c L9a
// Every REJECT line names the owning unit, so the fence can always requeue the
// one slice that owns the gap.
//
// Attribution note (req-matrix.md): C1a-C1f originate on D4, C2a-C2c on B3,
// C3a-C3d on B7 and C4a-C4c on B5, but on THIS fence they are asserted through
// the RENDERED machine detail, which is D13's and D5's own deliverable. A
// backend that computes a fan RPM nobody can see does not satisfy this row.
//
// PATH: the journey spawns the real `createApiServer` in a child process
// against an xmac `status` fixture, a machines.conf fixture, a telemetry
// fixture, a seeded xm_devices/xm_samples store, an xmac.log fixture, a
// protected-role fixture dir, a lease state dir and a PATH spy set, with
// XMACHINES_ARM unset (the non-actuating FakeGateway, L10). The real fleet is
// never contacted and nothing can actuate. FENCE_ORIGIN is deliberately
// ignored: a deployed origin has no fake fleet to select from.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. No canonical DOM contract exists yet for a D5 CPU/fan/session/on-hours
//     surface or a D13 GPU state chip, so each is matched by a UNION of
//     plausible selectors (attribute, data-testid suffix or class) and its
//     value is read from the attribute or the text. That broadens WHERE the
//     evidence may appear; it does not weaken WHAT must be true (the exact
//     fixture literal, on the named machine's detail).
//  2. Per-machine sensor and GPU data is offered on BOTH plausible channels
//     with IDENTICAL literals: the telemetry fixture JSON (the established
//     fake-fleet channel: `cpuTemp`, and the D5 extension keys `fanRPMs`,
//     `powerSessionSeconds`, `onHours`) AND PATH spies for `sensors`,
//     `nvidia-smi` and `ssh` that answer for the machine currently being
//     viewed. Whichever way D5/D13 wire the read, they see the same numbers,
//     so neither wiring can make an id red for a reason that is not theirs.
//  3. `nvidia-smi` is spawned WITHOUT a host by gpu-query.ts, so a spy cannot
//     tell machines apart on its own. The spy therefore reads the
//     currently-viewed machine from a scratch file the journey writes before
//     each navigation. That is a limitation of today's query, not an
//     assertion this journey makes; the DB seed carries the same per-machine
//     condition for a render path that reads stored samples instead.
//  4. The three GPU states that today's read route CANNOT express (no-NVIDIA,
//     driver-timeout, and the chip on a stale row) are asserted on the
//     RENDERED detail only. Whether D13 reaches them by refreshing the poll in
//     the route or by persisting the poll outcome is D13's design choice; the
//     journey prescribes neither and provides both conditions.
//  5. C3b's power-session duration (5400s) is accepted in any of the obvious
//     renderings (`5400`, `90m`, `1h 30m`), and C3d's estimated on-hours is
//     accepted as any number that rounds to the 76 hours the fixture boot
//     implies, provided it is labelled estimated. The exact format is not
//     prescribed; its presence and provenance are.
//  6. C2c ("no fabricated fan and no error") is asserted as a conjunction: the
//     fanless machine's detail must still render ITS OWN sensor reading (the
//     CPU literal), must show no fan RPM number anywhere outside the GPU rows,
//     and must show no error/NaN/undefined text. A detail that renders nothing
//     at all is not graceful absence and does not pass.
//  7. The owner session is a stub authService inside the scratch server (the
//     C1 read-route suite's pattern), reached through a tunnel-shaped reverse
//     proxy that sets x-forwarded-host/proto — the exact header shape
//     Cloudflare delivers in production and what hostFromRequest() reads
//     first. It relaxes no check; A2c owns the auth matrix and is asserted on
//     E11.
//  8. BASELINE NOTE, recorded rather than engineered away and MEASURED by
//     running this journey (11 of the 23 ids are red today): the 12 already
//     green are C1a-C1g (the D4 rows landed and are keyed by UUID), L11g and
//     L11j (a NULL-valued stored sample already renders the literal
//     `unavailable`, and a non-NVIDIA name already renders `not-applicable`),
//     C3a (the OS uptime literal already prints) and C4a/C4b (busy output and
//     leases already print). All of them are asserted here at full strength —
//     against the fixture's own literals, on the named machine — because this
//     fence is where they must KEEP being true once D13 re-renders every GPU
//     row with a state chip and D5 adds the system panel around them. D13/D5
//     do not have to turn them red-to-green; they have to not break them, and the
//     contract's negative control (FENCE_STUB=D13 --expect-red L11i)
//     discriminates D13 through an id that IS red today.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E2';
const ACCEPTANCE_IDS = [
  'C1a', 'C1b', 'C1c', 'C1d', 'C1e', 'C1f', 'C1g',
  'C2a', 'C2b', 'C2c',
  'C3a', 'C3b', 'C3c', 'C3d',
  'C4a', 'C4b', 'C4c',
  'L9a',
  'L11g', 'L11h', 'L11i', 'L11j', 'L11k',
];
// id -> the contributor blamed when it rejects.
const COVERED: Record<string, string> = {
  C1a: 'D13', C1b: 'D13', C1c: 'D13', C1d: 'D13', C1e: 'D13', C1f: 'D13', C1g: 'D13',
  L11g: 'D13', L11h: 'D13', L11i: 'D13', L11j: 'D13', L11k: 'D13',
  C2a: 'D5', C2b: 'D5', C2c: 'D5',
  C3a: 'D5', C3b: 'D5', C3c: 'D5', C3d: 'D5',
  C4a: 'D5', C4b: 'D5', C4c: 'D5',
  L9a: 'D5',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'e2-fence-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const WAKE_VERBS = ['up', 'run', 'claim', 'release', 'wake'];
const SELFTEST_MARKER = 'e2-spy-selftest';

// ---------------------------------------------------------------------------
// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media, signal, glimmer) so no assertion here can accidentally be
// satisfied by, or aimed at, a real box. They carry no hyphen because
// uptime.ts parseXmacLog matches the machine token with \w+ — a hyphenated
// fake name would make the power session unprovable for a reason that is not
// D5's.
// ---------------------------------------------------------------------------
const FORGE = 'e2forge';   // D5: CPU + two fans + proven session + busy + leases + protected role
const QUIET = 'e2quiet';   // D5: CPU only, no fan sensor, no xmac wake record
const TRIO = 'e2trio';     // D13: three discovered UUIDs, all live
const NAGPU = 'e2nagpu';   // D13: NVIDIA [N/A] power and fan
const BARE = 'e2bare';     // D13: no NVIDIA at all
const STALL = 'e2stall';   // D13: driver timeout over last-good history
const ODD = 'e2odd';       // D13: a non-NVIDIA device
const RELIC = 'e2relic';   // D13: an expired sample

const FLEET = [FORGE, QUIET, TRIO, NAGPU, BARE, STALL, ODD, RELIC];

// FORGE sits on .174 so resolveProtectedRole() reaches the `signal` role from
// the protected-role fixture; every other octet is outside 174/179/169 and is
// therefore unprotected.
const OCTET: Record<string, string> = {
  [FORGE]: '174', [QUIET]: '201', [TRIO]: '202', [NAGPU]: '203',
  [BARE]: '204', [STALL]: '205', [ODD]: '206', [RELIC]: '207',
};

const PROTECTED_ROLE = 'signal';
const BUSY_OUTPUT = 'python3 train.py (pid 4242)';
const LEASE_NAMES = ['render-lease', 'sweep-lease'];

// The boot the whole fixture agrees on: 3d 4h 5m = 273900s, i.e. 76.08 on-hours.
const UP_SECONDS = 273900;
const FORGE_OS_UPTIME = '3d 4h 5m';
const EXPECTED_ON_HOURS = UP_SECONDS / 3600; // 76.08…
const FORGE_SESSION_SECONDS = 5400;

const FORGE_CPU_C = 61;
const QUIET_CPU_C = 44;
const FORGE_FAN_RPMS = [1180, 1420];

const PROVENANCE = 'collector-cli';

// ---------------------------------------------------------------------------
// The GPU inventory, expressed once and fed to BOTH channels (ambiguity 2):
// the seeded store the read route renders from, and the nvidia-smi spy a
// refreshing route would poll.
// ---------------------------------------------------------------------------
type Gpu = {
  uuid: string;
  name: string;
  util: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  temp: number | null;
  watts: number | null;
  fan: number | null;
  ageSeconds: number;
};

const TRIO_GPUS: Gpu[] = [
  { uuid: 'GPU-E2-TRIO-1', name: 'NVIDIA RTX PRO 4500', util: 37, vramUsed: 3072, vramTotal: 32768, temp: 61, watts: 143, fan: 44, ageSeconds: 20 },
  { uuid: 'GPU-E2-TRIO-2', name: 'NVIDIA RTX PRO 4000', util: 12, vramUsed: 1024, vramTotal: 24576, temp: 48, watts: 62, fan: 31, ageSeconds: 20 },
  // Same NAME as GPU 2 on purpose: only the UUID tells these two cards apart,
  // so a renderer that de-duplicates on name renders two rows and fails C1g.
  { uuid: 'GPU-E2-TRIO-3', name: 'NVIDIA RTX PRO 4000', util: 88, vramUsed: 20480, vramTotal: 24576, temp: 74, watts: 191, fan: 67, ageSeconds: 20 },
];
// [N/A] in nvidia-smi's CSV, NULL in the store: unavailable, never zero.
const NAGPU_GPUS: Gpu[] = [
  { uuid: 'GPU-E2-NAGPU-1', name: 'NVIDIA RTX A2000', util: 5, vramUsed: 512, vramTotal: 8192, temp: 39, watts: null, fan: null, ageSeconds: 25 },
];
const STALL_GPUS: Gpu[] = [
  { uuid: 'GPU-E2-STALL-1', name: 'NVIDIA GeForce RTX 4090', util: 51, vramUsed: 8192, vramTotal: 24576, temp: 66, watts: 305, fan: 58, ageSeconds: 40 },
];
const ODD_NAME = 'Advanced Micro Devices Radeon RX 6800';
const ODD_GPUS: Gpu[] = [
  { uuid: 'GPU-E2-ODD-1', name: ODD_NAME, util: null, vramUsed: null, vramTotal: null, temp: null, watts: null, fan: null, ageSeconds: 30 },
];
// 1800s old against a 300s freshness window.
const RELIC_GPUS: Gpu[] = [
  { uuid: 'GPU-E2-RELIC-1', name: 'NVIDIA GeForce RTX 3060', util: 22, vramUsed: 2048, vramTotal: 12288, temp: 55, watts: 90, fan: 35, ageSeconds: 1800 },
];

const SEEDED_GPUS: Record<string, Gpu[]> = {
  [TRIO]: TRIO_GPUS,
  [NAGPU]: NAGPU_GPUS,
  [STALL]: STALL_GPUS,
  [ODD]: ODD_GPUS,
  [RELIC]: RELIC_GPUS,
  // BARE, FORGE and QUIET have no devices at all.
};

// How the spy should answer while each machine's detail is being viewed.
const GPU_MODE: Record<string, 'csv' | 'no-nvidia' | 'timeout'> = {
  [TRIO]: 'csv', [NAGPU]: 'csv', [ODD]: 'csv', [RELIC]: 'csv', [STALL]: 'timeout', [BARE]: 'no-nvidia',
  [FORGE]: 'csv', [QUIET]: 'csv',
};

// Exactly what gpu-edge-states.ts renders a stored sample as, so an assertion
// names the string the production path already produces.
function cell(value: number | null, suffix: string, blank: string): string {
  if (value === null) return blank;
  return suffix === '%' ? `${value}%` : `${value} ${suffix}`;
}
function vramCell(gpu: Gpu, blank: string): string {
  if (gpu.vramUsed === null || gpu.vramTotal === null) return blank;
  return `${gpu.vramUsed}/${gpu.vramTotal} MiB`;
}

// ---------------------------------------------------------------------------
// Selector unions (ambiguity 1).
// ---------------------------------------------------------------------------
const DETAIL_SEL = '[data-testid="xmachines-machine-detail"]';
const GPU_ROW_SEL = [
  '[data-testid="xmachines-gpu-row"]',
  '[data-gpu-uuid]',
  '.gpu-row',
].join(', ');
const CPU_SEL = [
  '[data-testid*="cpu-temp"]',
  '[data-testid*="cpu"]',
  '[data-cpu-temp]',
  '.xm-cpu-temp',
  '.xm-cpu',
].join(', ');
const FAN_SEL = [
  '[data-testid*="fan"]',
  '[data-fan]',
  '[data-fan-rpm]',
  '.xm-fan',
].join(', ');
const SESSION_SEL = [
  '[data-testid*="power-session"]',
  '[data-testid*="session"]',
  '[data-power-session]',
  '.xm-power-session',
].join(', ');
const ONHOURS_SEL = [
  '[data-testid*="on-hours"]',
  '[data-testid*="onhours"]',
  '[data-testid*="hours"]',
  '[data-on-hours]',
  '.xm-on-hours',
].join(', ');
const PROTECTED_SEL = [
  '[data-testid*="protected"]',
  '[data-testid*="guard"]',
  '[data-testid*="refusal"]',
  '[data-protected-role]',
  '.xm-protected',
].join(', ');
const CHIP_SEL = [
  '[data-testid*="chip"]',
  '[data-testid*="gpu-state"]',
  '[data-testid*="gpu-status"]',
  '[data-chip]',
  '[data-state]',
  '[data-availability]',
  '[role="status"]',
  '.chip',
].join(', ');
const OFF_SEL = [
  '[data-testid="xmachines-off-button"]',
  '[data-testid*="off-button"]',
  '[data-testid*="power-off"]',
].join(', ');
const UPTIME_SEL = [
  '[data-testid="xmachines-uptime"]',
  '[data-testid*="os-uptime"]',
  '[data-testid*="uptime"]',
].join(', ');
const BUSY_SEL = ['[data-testid="xmachines-busy"]', '[data-testid*="busy"]'].join(', ');
const LEASE_SEL = ['[data-testid="xmachines-leases"]', '[data-testid*="lease"]'].join(', ');
const PROV_SEL = ['[data-testid="xmachines-provenance"]', '[data-testid*="provenance"]', '[data-provenance]'].join(', ');

function finish(fenceTest: string, results: boolean[], expected: number): void {
  if (results.length !== expected) {
    throw new Error(`${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  }
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// ---------------------------------------------------------------------------
// Scratch fake fleet. Every path is under os.tmpdir(); the repository, the real
// ~/.config/agent-protocols/xmac and the real ~/.xmac are untouched.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  bin: string;
  log: string;
  statusPath: string;
  confPath: string;
  metricsPath: string;
  stateDir: string;
  protectedDir: string;
  xmacLogPath: string;
  gpuDir: string;
  seedPath: string;
  env: NodeJS.ProcessEnv;
};

// The command name is a literal baked into each spy script, not read from
// argv[0] at invocation time, so the recorded executable identity cannot be
// spoofed by how the child happened to be invoked (the A14/A15 pattern).
function logPrelude(name: string, log: string): string {
  return `#!/bin/bash\nset -u\n{\n  printf '%s' ${JSON.stringify(name)}\n  for arg in "$@"; do printf '\\t%s' "$arg"; done\n  printf '\\n'\n} >> ${JSON.stringify(log)}\n`;
}

function installSpies(bin: string, log: string, gpuDir: string): void {
  for (const name of ['ping', 'wakeonlan', 'xmac.sh', 'xmac', 'smartctl', 'upsc']) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `${logPrelude(name, log)}exit 0\n`, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }

  // nvidia-smi answers for the machine currently being viewed (ambiguity 3).
  const nvidia = `${logPrelude('nvidia-smi', log)}
DIR=${JSON.stringify(gpuDir)}
M="$(cat "$DIR/current" 2>/dev/null || true)"
MODE="$(cat "$DIR/$M.mode" 2>/dev/null || echo csv)"
case "$MODE" in
  timeout)
    sleep 12
    exit 0
    ;;
  no-nvidia)
    echo "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver. Make sure that the latest NVIDIA driver is installed and running." >&2
    exit 9
    ;;
  *)
    cat "$DIR/$M.csv" 2>/dev/null || true
    exit 0
    ;;
esac
`;
  fs.writeFileSync(path.join(bin, 'nvidia-smi'), nvidia, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'nvidia-smi'), 0o755);

  // lm-sensors, likewise per viewed machine.
  const sensors = `${logPrelude('sensors', log)}
DIR=${JSON.stringify(gpuDir)}
M="$(cat "$DIR/current" 2>/dev/null || true)"
cat "$DIR/$M.sensors" 2>/dev/null || true
exit 0
`;
  fs.writeFileSync(path.join(bin, 'sensors'), sensors, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'sensors'), 0o755);

  // ssh answers read-only probes per HOST, for a reader that shells out per
  // machine instead of reading the fixture. It never runs anything.
  const ssh = `${logPrelude('ssh', log)}
DIR=${JSON.stringify(gpuDir)}
ARGS="$*"
OCTET="$(printf '%s' "$ARGS" | grep -oE '192\\.0\\.2\\.[0-9]+' | head -n1 | awk -F. '{print $4}')"
M="$(cat "$DIR/octet-$OCTET" 2>/dev/null || true)"
case "$ARGS" in
  *sensors*) cat "$DIR/$M.sensors" 2>/dev/null || true ;;
  *uptime*)  cat "$DIR/$M.uptime" 2>/dev/null || true ;;
  *nvidia-smi*) cat "$DIR/$M.csv" 2>/dev/null || true ;;
esac
exit 0
`;
  fs.writeFileSync(path.join(bin, 'ssh'), ssh, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'ssh'), 0o755);
}

function statusLines(): string {
  return `${FLEET.map((name) => {
    const leases = name === FORGE ? `leases=(${LEASE_NAMES.join(' ')})` : 'leases=()';
    return `${name}  192.0.2.${OCTET[name]}  UP  ${leases}  compute`;
  }).join('\n')}\n`;
}

function confLines(): string {
  return `${FLEET.map((name) => {
    const busy = name === FORGE ? `echo '${BUSY_OUTPUT}'` : 'true';
    return `${name}|192.0.2.${OCTET[name]}|02:00:00:00:00:${OCTET[name]}|agjrom|compute|${busy}`;
  }).join('\n')}\n`;
}

// The read-model fixture. `cpuTemp` is read today; `fanRPMs`,
// `powerSessionSeconds` and `onHours` are the D5 extension keys, carrying the
// SAME literals the sensor spy and the xmac log carry (ambiguity 2).
function metricsJson(): string {
  const row = (name: string, extra: Record<string, unknown>) => [name, {
    gpuTempsC: [55],
    gpuPowerWatts: [120],
    uptime: FORGE_OS_UPTIME,
    freshness: 'fresh',
    provenance: PROVENANCE,
    sampleAge: '20s',
    ...extra,
  }] as const;
  const rows = [
    row(FORGE, { cpuTemp: FORGE_CPU_C, fanRPMs: FORGE_FAN_RPMS, powerSessionSeconds: FORGE_SESSION_SECONDS, onHours: EXPECTED_ON_HOURS }),
    row(QUIET, { cpuTemp: QUIET_CPU_C, fanRPMs: [], onHours: EXPECTED_ON_HOURS }),
    row(TRIO, { cpuTemp: 52, fanRPMs: [900] }),
    row(NAGPU, { cpuTemp: 41, fanRPMs: [880] }),
    row(BARE, { cpuTemp: 38, fanRPMs: [770] }),
    row(STALL, { cpuTemp: 49, fanRPMs: [1010] }),
    row(ODD, { cpuTemp: 46, fanRPMs: [960] }),
    row(RELIC, { cpuTemp: 43, fanRPMs: [820] }),
  ];
  return JSON.stringify(Object.fromEntries(rows));
}

function sensorsText(cpuC: number, fanRpms: readonly number[]): string {
  const fans = fanRpms.map((rpm, index) => `fan${index + 1}:        ${rpm} RPM`).join('\n');
  return [
    'k10temp-pci-00c3',
    'Adapter: PCI adapter',
    `Tctl:         +${cpuC}.0°C`,
    '',
    ...(fanRpms.length > 0 ? ['nct6798-isa-0290', 'Adapter: ISA adapter', fans, ''] : []),
  ].join('\n');
}

function csvText(gpus: readonly Gpu[]): string {
  const na = (value: number | null) => (value === null ? '[N/A]' : String(value));
  return `${gpus.map((gpu) => [
    gpu.uuid, gpu.name, na(gpu.util), na(gpu.vramUsed), na(gpu.vramTotal),
    na(gpu.temp), na(gpu.watts), na(gpu.fan),
  ].join(', ')).join('\n')}\n`;
}

// An xmac log whose only WAKE-to-UP record is FORGE's, inside the current boot
// window. QUIET has no record at all, so its power session is unprovable.
function xmacLogText(): string {
  const stamp = (secondsAgo: number) => `${new Date(Date.now() - secondsAgo * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
  return [
    `${stamp(FORGE_SESSION_SECONDS + 60)} WAKE ${FORGE}`,
    `${stamp(FORGE_SESSION_SECONDS)} UP ${FORGE} ${FORGE_SESSION_SECONDS}s`,
    '',
  ].join('\n');
}

function gpuSeedJson(): string {
  const rows: unknown[] = [];
  for (const [machine, gpus] of Object.entries(SEEDED_GPUS)) {
    gpus.forEach((gpu, ordinal) => {
      rows.push({
        machine,
        ordinal,
        uuid: gpu.uuid,
        name: gpu.name,
        ageSeconds: gpu.ageSeconds,
        temperature: gpu.temp,
        powerWatts: gpu.watts,
        utilizationGpu: gpu.util,
        fanSpeed: gpu.fan,
        vramMb: gpu.vramUsed,
        vramTotalMb: gpu.vramTotal,
      });
    });
  }
  return JSON.stringify(rows);
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2-compute-detail-'));
  const bin = path.join(dir, 'bin');
  const gpuDir = path.join(dir, 'gpu');
  const stateDir = path.join(dir, 'xmac-state');
  const protectedDir = path.join(dir, 'protected');
  fs.mkdirSync(bin);
  fs.mkdirSync(gpuDir);
  fs.mkdirSync(protectedDir, { recursive: true });
  fs.mkdirSync(path.join(stateDir, 'leases', FORGE), { recursive: true });
  for (const lease of LEASE_NAMES) {
    fs.writeFileSync(path.join(stateDir, 'leases', FORGE, lease), 'held\n');
  }

  const log = path.join(dir, 'argv.log');
  installSpies(bin, log, gpuDir);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const xmacLogPath = path.join(dir, 'xmac.log');
  const seedPath = path.join(dir, 'gpu-seed.json');
  fs.writeFileSync(statusPath, statusLines());
  fs.writeFileSync(confPath, confLines());
  fs.writeFileSync(metricsPath, metricsJson());
  fs.writeFileSync(xmacLogPath, xmacLogText());
  fs.writeFileSync(seedPath, gpuSeedJson());

  // Per-machine spy answers.
  for (const name of FLEET) {
    fs.writeFileSync(path.join(gpuDir, `${name}.mode`), `${GPU_MODE[name]}\n`);
    fs.writeFileSync(path.join(gpuDir, `${name}.csv`), csvText(SEEDED_GPUS[name] ?? []));
    fs.writeFileSync(path.join(gpuDir, `octet-${OCTET[name]}`), `${name}\n`);
    fs.writeFileSync(path.join(gpuDir, `${name}.uptime`), 'up 3 days, 4 hours, 5 minutes\n');
  }
  fs.writeFileSync(path.join(gpuDir, `${FORGE}.sensors`), sensorsText(FORGE_CPU_C, FORGE_FAN_RPMS));
  fs.writeFileSync(path.join(gpuDir, `${QUIET}.sensors`), sensorsText(QUIET_CPU_C, []));
  for (const name of [TRIO, NAGPU, BARE, STALL, ODD, RELIC]) {
    fs.writeFileSync(path.join(gpuDir, `${name}.sensors`), sensorsText(50, [900]));
  }
  fs.writeFileSync(path.join(gpuDir, 'current'), `${FORGE}\n`);

  // Protected-role fixture: only FORGE's octet (.174) is covered by a live role.
  fs.writeFileSync(
    path.join(protectedDir, 'status.json'),
    JSON.stringify(Object.fromEntries(FLEET.map((name) => [name, { ip: `192.0.2.${OCTET[name]}` }]))),
  );
  fs.writeFileSync(path.join(protectedDir, 'roles.json'), JSON.stringify({ [PROTECTED_ROLE]: 'live' }));
  fs.writeFileSync(path.join(protectedDir, 'leases.json'), JSON.stringify({ names: [] }));
  fs.writeFileSync(path.join(protectedDir, 'schedule.json'), JSON.stringify({}));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMACHINES_PROTECTED_FIXTURE_DIR: protectedDir,
    XMACHINES_UP_SECONDS: String(UP_SECONDS),
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    XMAC_LOG: xmacLogPath,
    E2_OWNER_TOKEN: OWNER_TOKEN,
    E2_GPU_SEED: seedPath,
  };
  // Non-actuating by default (L10): arming is process configuration, and this
  // fence must never be able to reach a real box.
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  return { dir, bin, log, statusPath, confPath, metricsPath, stateDir, protectedDir, xmacLogPath, gpuDir, seedPath, env };
}

function viewing(scratch: Scratch, machine: string): void {
  fs.writeFileSync(path.join(scratch.gpuDir, 'current'), `${machine}\n`);
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
// would make this red for a build reason instead of a capability reason). The
// store is seeded from the fixture BEFORE the server is served, which is how a
// fake fleet gets a per-machine GPU inventory without any real host.
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');

const OWNER_TOKEN = process.env.E2_OWNER_TOKEN;
const db = new DatabaseService(':memory:');
const seed = JSON.parse(fs.readFileSync(process.env.E2_GPU_SEED, 'utf8'));
const raw = db.raw;
const nowMs = Date.now();
const insertDevice = raw.prepare(
  'INSERT INTO xm_devices (machine_name, gpu_uuid, gpu_name, status, ordinal, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insertSample = raw.prepare(
  'INSERT INTO xm_samples (machine_name, gpu_uuid, sample_time, temperature, power_watts, utilization_gpu, utilization_mem, fan_speed, vram_mb, vram_total_mb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
for (const row of seed) {
  const sampleTime = new Date(nowMs - row.ageSeconds * 1000).toISOString();
  insertDevice.run(row.machine, row.uuid, row.name, 'active', row.ordinal, sampleTime, sampleTime);
  insertSample.run(
    row.machine, row.uuid, sampleTime,
    row.temperature, row.powerWatts, row.utilizationGpu, null,
    row.fanSpeed, row.vramMb, row.vramTotalMb
  );
}

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
  db,
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
// Spy self-test BEFORE anything is served, so a later "no wake calls" reading
// is a real observation and not an artefact of a spy that was never on PATH.
// 'ping' is a read verb, never a wake verb.
spawnSync('ping', ['__SELFTEST__'], { encoding: 'utf8' });
console.log('E2-SERVER-READY ' + app.server.address().port);
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
    const match = out.match(/E2-SERVER-READY (\d+)/);
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
// first. It relaxes no check: the route still applies its own allowlist.
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
// owner session, deep-linked to ONE machine's detail — which is the journey's
// subject: "selecting one fake machine".
// ---------------------------------------------------------------------------
type GpuRowView = {
  uuid: string;
  name: string;
  util: string;
  vram: string;
  temp: string;
  power: string;
  fan: string;
  text: string;
  attrs: string[];
  chipTokens: string[];
};

type DetailPayload = {
  armed?: boolean;
  mode?: string;
  machine?: Record<string, unknown> & { busy?: { busyCheckOutput?: string; leaseNames?: string[] } | null };
  gpuRows?: unknown[];
};

type Detail = {
  machine: string;
  present: boolean;
  text: string;
  bodyText: string;
  gpuRows: GpuRowView[];
  cpuTokens: string[];
  fanTokens: string[];
  sessionTokens: string[];
  onHoursTokens: string[];
  protectedTokens: string[];
  chipTokens: string[];
  uptimeTokens: string[];
  busyTokens: string[];
  leaseTokens: string[];
  provenanceTokens: string[];
  off: { found: boolean; disabled: boolean; text: string; attrs: string[] } | null;
  payload: DetailPayload | null;
  status: number | null;
};

type Session = {
  context: import('@playwright/test').BrowserContext;
  page: import('@playwright/test').Page;
  payloads: Record<string, DetailPayload>;
  statuses: Record<string, number>;
};

async function openSession(
  browser: import('@playwright/test').Browser,
  _base: string,
): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const payloads: Record<string, DetailPayload> = {};
  const statuses: Record<string, number> = {};
  page.on('response', async (response) => {
    const match = response.url().match(/\/api\/xmachines\/machines\/([^/?]+)(?:$|\?)/);
    if (!match) return;
    const name = decodeURIComponent(match[1]);
    statuses[name] = response.status();
    try { payloads[name] = (await response.json()) as DetailPayload; } catch { /* non-JSON body */ }
  });
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript((token) => {
    const w = window as unknown as { Telegram?: unknown };
    w.Telegram = {
      WebApp: {
        initData: 'e2-fence',
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
  return { context, page, payloads, statuses };
}

// Selecting ONE machine, as the owner does: deep-link its detail route, then
// read everything the rendered detail claims about it.
async function readDetail(
  session: Session,
  scratch: Scratch,
  base: string,
  machine: string,
): Promise<Detail> {
  viewing(scratch, machine);
  await session.page.goto(`${base}/index.html#/xmachines/${machine}`, { waitUntil: 'domcontentloaded' });
  // Give the detail its own chance to appear; a miss here is an assertion
  // failure below, not a thrown timeout.
  await session.page.waitForSelector(DETAIL_SEL, { timeout: 20_000 }).catch(() => {});
  await session.page.waitForTimeout(400);

  const scraped = await session.page.evaluate((sel) => {
    const [
      detailSel, gpuRowSel, cpuSel, fanSel, sessionSel, onHoursSel,
      protectedSel, chipSel, offSel, uptimeSel, busySel, leaseSel, provSel,
    ] = sel as string[];
    const root = document.querySelector(detailSel);
    const attrsOf = (el: Element): string[] =>
      Array.from(el.attributes).map((attr) => `${attr.name}=${attr.value}`);
    const collect = (scope: Element | null, selector: string, skipGpuRows: boolean): string[] => {
      if (!scope) return [];
      const out: string[] = [];
      for (const found of Array.from(scope.querySelectorAll(selector))) {
        if (skipGpuRows && found.closest(gpuRowSel)) continue;
        out.push(...attrsOf(found));
        out.push((found.textContent || '').trim());
      }
      for (const attr of Array.from(scope.attributes)) {
        if (selector.includes(`[${attr.name}]`)) out.push(`${attr.name}=${attr.value}`);
      }
      return out.filter((token) => token.length > 0);
    };
    const pick = (scope: Element, selector: string): string => {
      const found = scope.querySelector(selector);
      return found ? (found.textContent || '').trim() : '';
    };
    const rows = root
      ? Array.from(root.querySelectorAll(gpuRowSel)).map((el) => ({
        uuid: el.getAttribute('data-gpu-uuid') || pick(el, '[data-testid="xmachines-gpu-uuid"], .gpu-uuid'),
        name: pick(el, '[data-testid="xmachines-gpu-name"], .gpu-name'),
        util: pick(el, '[data-testid="xmachines-gpu-util"], .metric-utilization'),
        vram: pick(el, '[data-testid="xmachines-gpu-vram"], .metric-memory'),
        temp: pick(el, '[data-testid="xmachines-gpu-temp"], .metric-temperature'),
        power: pick(el, '[data-testid="xmachines-gpu-power"], .metric-power'),
        fan: pick(el, '[data-testid="xmachines-gpu-fan"], .metric-fan'),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        attrs: attrsOf(el),
        chipTokens: collect(el, chipSel, false),
      }))
      : [];
    const offEl = root ? root.querySelector(offSel) : null;
    const off = offEl
      ? {
        found: true,
        disabled: (offEl as HTMLButtonElement).disabled === true
          || offEl.getAttribute('aria-disabled') === 'true'
          || offEl.hasAttribute('disabled')
          || offEl.hasAttribute('data-disabled'),
        text: (offEl.textContent || '').trim(),
        attrs: attrsOf(offEl),
      }
      : null;
    return {
      present: !!root,
      text: root ? (root.textContent || '').replace(/\s+/g, ' ').trim() : '',
      bodyText: (document.body.textContent || '').replace(/\s+/g, ' ').trim(),
      gpuRows: rows,
      cpuTokens: collect(root, cpuSel, true),
      fanTokens: collect(root, fanSel, true),
      sessionTokens: collect(root, sessionSel, true),
      onHoursTokens: collect(root, onHoursSel, true),
      protectedTokens: collect(root, protectedSel, true),
      chipTokens: collect(root, chipSel, false),
      uptimeTokens: collect(root, uptimeSel, true),
      busyTokens: collect(root, busySel, true),
      leaseTokens: collect(root, leaseSel, true),
      provenanceTokens: collect(root, provSel, true),
      off,
    };
  }, [
    DETAIL_SEL, GPU_ROW_SEL, CPU_SEL, FAN_SEL, SESSION_SEL, ONHOURS_SEL,
    PROTECTED_SEL, CHIP_SEL, OFF_SEL, UPTIME_SEL, BUSY_SEL, LEASE_SEL, PROV_SEL,
  ]);

  return {
    machine,
    ...scraped,
    payload: session.payloads[machine] ?? null,
    status: session.statuses[machine] ?? null,
  };
}

function numbersIn(tokens: readonly string[]): number[] {
  const out: number[] = [];
  for (const token of tokens) {
    for (const match of token.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Number(match[0]));
  }
  return out;
}

function blobOf(tokens: readonly string[]): string {
  return tokens.join(' ').toLowerCase();
}

function describe(detail: Detail, what: string, tokens: readonly string[], selector: string): string {
  if (!detail.present) {
    return `${detail.machine}'s detail never rendered at all [HTTP ${String(detail.status)}]`;
  }
  if (tokens.length === 0) {
    return `${detail.machine}'s detail renders no ${what} (tried ${selector}); the detail read ${JSON.stringify(detail.text.slice(0, 220))}`;
  }
  return `${detail.machine}'s ${what} tokens were ${JSON.stringify(tokens.slice(0, 8))}`;
}

// ---------------------------------------------------------------------------
// One server, one fake fleet, both contributor tests. The whole fence must fit
// inside the runner's single Playwright spawn, so the scratch app is built once
// in beforeAll; a startup failure is RECORDED rather than thrown, so every
// acceptance id is still reached and named in the report.
// ---------------------------------------------------------------------------
let scratch: Scratch | null = null;
let server: Server | null = null;
let proxy: { base: string; close: () => Promise<void> } | null = null;
let startupError = '';

test.beforeAll(async () => {
  test.setTimeout(70_000);
  try {
    scratch = newScratch();
    server = await startServer(scratch);
    proxy = await startProxy(server.port);
  } catch (error) {
    startupError = (error as Error).message;
  }
});

test.afterAll(async () => {
  if (proxy) await proxy.close();
  if (server) server.child.kill('SIGTERM');
  if (scratch) fs.rmSync(scratch.dir, { recursive: true, force: true });
});

function context(detail?: Detail | null): string {
  if (startupError) return ` [startup: ${startupError}]`;
  const status = detail ? ` [detail HTTP ${String(detail.status)}]` : '';
  const spy = scratch ? forbiddenGatewayCalls(scratch.log) : [];
  const spyNote = spy.length ? ` [WARNING: ${spy.length} gateway call(s) were made: ${JSON.stringify(spy.slice(0, 2))}]` : '';
  return `${status}${spyNote}${server ? ` [server stderr: ${server.stderr().slice(-200)}]` : ''}`;
}

// ---------------------------------------------------------------------------
// Structural guard on the split itself: the per-contributor tests below must
// between them cover exactly the row's acceptance ids, each once, and name only
// this row's two contributors.
// ---------------------------------------------------------------------------
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
  const units = new Set(Object.values(COVERED));
  if (units.size !== 2 || !units.has('D5') || !units.has('D13')) {
    throw new Error(`fence ${FENCE_ID}: rejections must name exactly the 2 contributors D5 and D13, found ${JSON.stringify([...units])}`);
  }
});

// ---------------------------------------------------------------------------
// D13 — selecting a machine renders ONE ROW PER DISCOVERED GPU UUID with that
// card's own live metrics, and renders the explicit unavailable, no-NVIDIA,
// driver-timeout, non-NVIDIA and stale states instead of a blank or a zero.
// Owns: C1a C1b C1c C1d C1e C1f C1g L11g L11h L11i L11j L11k
// ---------------------------------------------------------------------------
test('test_d13_machine_detail_renders_one_row_per_gpu_uuid_and_every_explicit_edge_state', async ({ browser }) => {
  test.setTimeout(75_000);
  const results: boolean[] = [];
  let session: Session | null = null;
  let trio: Detail | null = null;
  let nagpu: Detail | null = null;
  let bare: Detail | null = null;
  let stall: Detail | null = null;
  let odd: Detail | null = null;
  let relic: Detail | null = null;

  try {
    if (scratch && proxy) {
      try {
        session = await openSession(browser, proxy.base);
        trio = await readDetail(session, scratch, proxy.base, TRIO);
        nagpu = await readDetail(session, scratch, proxy.base, NAGPU);
        bare = await readDetail(session, scratch, proxy.base, BARE);
        stall = await readDetail(session, scratch, proxy.base, STALL);
        odd = await readDetail(session, scratch, proxy.base, ODD);
        relic = await readDetail(session, scratch, proxy.base, RELIC);
      } catch (error) {
        startupError = startupError || (error as Error).message;
      }
    }

    const needTrio = (): Detail => {
      if (!trio || !trio.present) throw new Error(`${TRIO}'s machine detail never rendered${context(trio)}`);
      return trio;
    };
    const rowFor = (detail: Detail, uuid: string): GpuRowView | undefined =>
      detail.gpuRows.find((row) => row.uuid === uuid || row.text.includes(uuid));

    // C1a — every discovered card's own live NAME is on its own row. Two of the
    // three share a name, so a row must be found by UUID and then show the name
    // that UUID reported.
    results.push(await guardedCheck('C1a', COVERED.C1a, async () => {
      const detail = needTrio();
      for (const gpu of TRIO_GPUS) {
        const row = rowFor(detail, gpu.uuid);
        if (!row) {
          throw new Error(`${TRIO} discovered ${gpu.uuid} but the detail renders no row for it; rows were ${JSON.stringify(detail.gpuRows.map((r) => r.uuid))}${context(detail)}`);
        }
        if (!row.name.includes(gpu.name) && !row.text.includes(gpu.name)) {
          throw new Error(`${gpu.uuid}'s row renders name ${JSON.stringify(row.name)} but the card reported ${JSON.stringify(gpu.name)}`);
        }
      }
    }));

    // C1b — utilisation percent, per row, as that card's own reading.
    results.push(await guardedCheck('C1b', COVERED.C1b, async () => {
      const detail = needTrio();
      for (const gpu of TRIO_GPUS) {
        const row = rowFor(detail, gpu.uuid);
        const expected = cell(gpu.util, '%', 'unavailable');
        if (!row || (!row.util.includes(expected) && !row.text.includes(expected))) {
          throw new Error(`${gpu.uuid} reported ${expected} utilisation but its row renders ${JSON.stringify(row ? row.util : null)} (row text ${JSON.stringify(row ? row.text.slice(0, 160) : null)})${context(detail)}`);
        }
      }
    }));

    // C1c — VRAM used AND total, not one of the two.
    results.push(await guardedCheck('C1c', COVERED.C1c, async () => {
      const detail = needTrio();
      for (const gpu of TRIO_GPUS) {
        const row = rowFor(detail, gpu.uuid);
        const expected = vramCell(gpu, 'unavailable');
        const blob = row ? `${row.vram} ${row.text}` : '';
        if (!row || !blob.includes(expected)) {
          const usedOnly = row && String(gpu.vramUsed) !== '' && blob.includes(String(gpu.vramUsed)) && !blob.includes(String(gpu.vramTotal));
          throw new Error(`${gpu.uuid} reported ${expected} but its row renders ${JSON.stringify(row ? row.vram : null)}${usedOnly ? ' — used without total is not used/total' : ''}${context(detail)}`);
        }
      }
    }));

    // C1d — temperature, per row.
    results.push(await guardedCheck('C1d', COVERED.C1d, async () => {
      const detail = needTrio();
      for (const gpu of TRIO_GPUS) {
        const row = rowFor(detail, gpu.uuid);
        const expected = cell(gpu.temp, 'C', 'unavailable');
        if (!row || (!row.temp.includes(expected) && !row.text.includes(expected))) {
          throw new Error(`${gpu.uuid} reported ${expected} but its row renders temperature ${JSON.stringify(row ? row.temp : null)}${context(detail)}`);
        }
      }
    }));

    // C1e — measured power draw, per row.
    results.push(await guardedCheck('C1e', COVERED.C1e, async () => {
      const detail = needTrio();
      for (const gpu of TRIO_GPUS) {
        const row = rowFor(detail, gpu.uuid);
        const expected = cell(gpu.watts, 'W', 'unavailable');
        if (!row || (!row.power.includes(expected) && !row.text.includes(expected))) {
          throw new Error(`${gpu.uuid} reported ${expected} but its row renders power ${JSON.stringify(row ? row.power : null)}${context(detail)}`);
        }
      }
    }));

    // C1f — fan percent when the card supplies one. All three do here.
    results.push(await guardedCheck('C1f', COVERED.C1f, async () => {
      const detail = needTrio();
      for (const gpu of TRIO_GPUS) {
        const row = rowFor(detail, gpu.uuid);
        const expected = cell(gpu.fan, '%', 'unavailable');
        if (!row || (!row.fan.includes(expected) && !row.text.includes(expected))) {
          throw new Error(`${gpu.uuid} supplied fan ${expected} but its row renders ${JSON.stringify(row ? row.fan : null)}${context(detail)}`);
        }
      }
    }));

    // C1g — ONE row per discovered UUID: exactly three rows, three distinct
    // UUIDs, on a box whose second and third cards share a model name.
    results.push(await guardedCheck('C1g', COVERED.C1g, async () => {
      const detail = needTrio();
      const uuids = detail.gpuRows.map((row) => row.uuid).filter((uuid) => uuid.length > 0);
      const expected = TRIO_GPUS.map((gpu) => gpu.uuid);
      if (detail.gpuRows.length !== expected.length) {
        throw new Error(`${TRIO} has ${expected.length} discovered GPUs but the detail renders ${detail.gpuRows.length} row(s); rendered uuids ${JSON.stringify(uuids)}${context(detail)}`);
      }
      const missing = expected.filter((uuid) => !uuids.includes(uuid));
      if (missing.length > 0) {
        throw new Error(`${TRIO}'s detail renders no row for ${JSON.stringify(missing)}; rendered uuids ${JSON.stringify(uuids)} — a row must be keyed by UUID, not by model name`);
      }
      if (new Set(uuids).size !== expected.length) {
        throw new Error(`${TRIO}'s detail renders duplicate GPU uuids ${JSON.stringify(uuids)}`);
      }
    }));

    // L11g — an NVIDIA [N/A] reading renders UNAVAILABLE, never 0. The card is
    // present and reporting; only its power and fan came back [N/A].
    results.push(await guardedCheck('L11g', COVERED.L11g, async () => {
      if (!nagpu || !nagpu.present) throw new Error(`${NAGPU}'s machine detail never rendered${context(nagpu)}`);
      const gpu = NAGPU_GPUS[0];
      const row = rowFor(nagpu, gpu.uuid);
      if (!row) {
        throw new Error(`${NAGPU} discovered ${gpu.uuid} but the detail renders no row for it; rows were ${JSON.stringify(nagpu.gpuRows.map((r) => r.uuid))}${context(nagpu)}`);
      }
      for (const [field, rendered] of [['power', row.power], ['fan', row.fan]] as const) {
        if (/(^|\D)0(\D|$)/.test(rendered) || rendered.trim() === '') {
          throw new Error(`${gpu.uuid} reported [N/A] ${field} but its row renders ${JSON.stringify(rendered)}; an absent reading is unavailable, not zero and not blank`);
        }
        if (!/unavail|n\/a|unknown/i.test(rendered)) {
          throw new Error(`${gpu.uuid}'s [N/A] ${field} renders ${JSON.stringify(rendered)} instead of an explicit unavailable${context(nagpu)}`);
        }
      }
      // The readings that DID come back must still be shown, so "unavailable"
      // is a per-value statement rather than a whole-row blackout.
      const tempCell = cell(gpu.temp, 'C', 'unavailable');
      if (!row.temp.includes(tempCell) && !row.text.includes(tempCell)) {
        throw new Error(`${gpu.uuid} reported ${tempCell} alongside its [N/A] values but the row renders temperature ${JSON.stringify(row.temp)}`);
      }
    }));

    // L11h — a machine with no NVIDIA driver at all says so. Not an empty
    // panel, not a zero-GPU silence: the no-NVIDIA state, named.
    results.push(await guardedCheck('L11h', COVERED.L11h, async () => {
      if (!bare || !bare.present) throw new Error(`${BARE}'s machine detail never rendered${context(bare)}`);
      if (bare.gpuRows.length > 0) {
        throw new Error(`${BARE} has no NVIDIA driver but its detail renders ${bare.gpuRows.length} GPU row(s) ${JSON.stringify(bare.gpuRows.map((r) => r.text.slice(0, 60)))} — nothing may be fabricated for a box with no GPUs`);
      }
      const blob = `${blobOf(bare.chipTokens)} ${bare.text.toLowerCase()}`;
      if (!/no.?nvidia|no nvidia|nvidia (driver )?(not|un)available|no gpus?\b/.test(blob)) {
        throw new Error(`${BARE}'s detail never names the no-NVIDIA state — ${describe(bare, 'GPU state chip', bare.chipTokens, CHIP_SEL)}`);
      }
    }));

    // L11i — a driver timeout keeps the LAST-GOOD history on screen and adds an
    // error chip. Dropping the history is as wrong as hiding the error.
    results.push(await guardedCheck('L11i', COVERED.L11i, async () => {
      if (!stall || !stall.present) throw new Error(`${STALL}'s machine detail never rendered${context(stall)}`);
      const gpu = STALL_GPUS[0];
      const row = rowFor(stall, gpu.uuid);
      if (!row) {
        throw new Error(`${STALL}'s driver timed out, but the detail dropped the last-good row for ${gpu.uuid} entirely; rows were ${JSON.stringify(stall.gpuRows.map((r) => r.uuid))} — a timeout is not an empty inventory${context(stall)}`);
      }
      const lastGood = cell(gpu.temp, 'C', 'unavailable');
      if (!row.temp.includes(lastGood) && !row.text.includes(lastGood)) {
        throw new Error(`${gpu.uuid}'s last-good reading ${lastGood} is not on screen after the timeout; the row renders ${JSON.stringify(row.text.slice(0, 160))}`);
      }
      const blob = `${blobOf(row.chipTokens)} ${blobOf(stall.chipTokens)}`;
      if (!/timeout|timed.?out|error/.test(blob)) {
        throw new Error(`${STALL}'s driver timed out but no error chip says so — ${describe(stall, 'GPU state chip', [...row.chipTokens, ...stall.chipTokens], CHIP_SEL)}`);
      }
    }));

    // L11j — a non-NVIDIA device is named, and carries NO fabricated metrics.
    results.push(await guardedCheck('L11j', COVERED.L11j, async () => {
      if (!odd || !odd.present) throw new Error(`${ODD}'s machine detail never rendered${context(odd)}`);
      const gpu = ODD_GPUS[0];
      const row = rowFor(odd, gpu.uuid);
      if (!row) {
        throw new Error(`${ODD} discovered the non-NVIDIA device ${gpu.uuid} but the detail renders no row for it; rows were ${JSON.stringify(odd.gpuRows.map((r) => r.uuid))}${context(odd)}`);
      }
      if (!row.text.includes(ODD_NAME)) {
        throw new Error(`the non-NVIDIA device must be identified by its name ${JSON.stringify(ODD_NAME)}; the row reads ${JSON.stringify(row.text.slice(0, 200))}`);
      }
      for (const [field, rendered] of [['power', row.power], ['temperature', row.temp], ['utilisation', row.util], ['fan', row.fan]] as const) {
        if (/\d/.test(rendered)) {
          throw new Error(`the non-NVIDIA device's ${field} renders ${JSON.stringify(rendered)} — a device NVIDIA cannot read has no metric to show, so any number there is fabricated`);
        }
      }
      const blob = `${blobOf(row.chipTokens)} ${row.text.toLowerCase()}`;
      if (!/non.?nvidia|not.?applicable|n\/a/.test(blob)) {
        throw new Error(`${ODD}'s row never says the device is non-NVIDIA — ${describe(odd, 'GPU state chip', row.chipTokens, CHIP_SEL)}`);
      }
    }));

    // L11k — a sample past the freshness window renders STALE rather than live.
    results.push(await guardedCheck('L11k', COVERED.L11k, async () => {
      if (!relic || !relic.present) throw new Error(`${RELIC}'s machine detail never rendered${context(relic)}`);
      const gpu = RELIC_GPUS[0];
      const row = rowFor(relic, gpu.uuid);
      if (!row) {
        throw new Error(`${RELIC} has a stored sample for ${gpu.uuid} but the detail renders no row for it; rows were ${JSON.stringify(relic.gpuRows.map((r) => r.uuid))}${context(relic)}`);
      }
      const blob = `${blobOf(row.chipTokens)} ${blobOf(relic.chipTokens)} ${row.text.toLowerCase()}`;
      if (!/stale|expired|outdated/.test(blob)) {
        throw new Error(`${gpu.uuid}'s sample is ${gpu.ageSeconds}s old — past the 300s GPU freshness window — but nothing on the row says stale; it renders ${JSON.stringify(row.text.slice(0, 200))} and ${describe(relic, 'GPU state chip', [...row.chipTokens, ...relic.chipTokens], CHIP_SEL)}`);
      }
    }));
  } finally {
    if (session) await session.context.close();
  }

  finish('E2/D13', results, 12);
});

// ---------------------------------------------------------------------------
// D5 — selecting a machine renders its CPU temperature, its board fans (or
// their graceful absence), its OS uptime, a power session only when xmac can
// prove one, its estimated on-hours, what is keeping it busy, the leases held
// on it, and the protected role that disables Off.
// Owns: C2a C2b C2c C3a C3b C3c C3d C4a C4b C4c L9a
// ---------------------------------------------------------------------------
test('test_d5_machine_detail_renders_cpu_fans_uptime_session_busy_leases_and_protected_role', async ({ browser }) => {
  test.setTimeout(75_000);
  const results: boolean[] = [];
  let session: Session | null = null;
  let forge: Detail | null = null;
  let quiet: Detail | null = null;

  try {
    if (scratch && proxy) {
      try {
        session = await openSession(browser, proxy.base);
        forge = await readDetail(session, scratch, proxy.base, FORGE);
        quiet = await readDetail(session, scratch, proxy.base, QUIET);
      } catch (error) {
        startupError = startupError || (error as Error).message;
      }
    }

    const needForge = (): Detail => {
      if (!forge || !forge.present) throw new Error(`${FORGE}'s machine detail never rendered${context(forge)}`);
      return forge;
    };
    const needQuiet = (): Detail => {
      if (!quiet || !quiet.present) throw new Error(`${QUIET}'s machine detail never rendered${context(quiet)}`);
      return quiet;
    };

    // C2a — the CPU temperature sensors expose is on the detail, as the
    // fixture's own number, on the named machine.
    results.push(await guardedCheck('C2a', COVERED.C2a, async () => {
      const detail = needForge();
      const cpuNumbers = numbersIn(detail.cpuTokens);
      if (!cpuNumbers.includes(FORGE_CPU_C)) {
        throw new Error(`${FORGE}'s sensors report CPU ${FORGE_CPU_C}°C but the detail renders no such CPU temperature — ${describe(detail, 'CPU temperature', detail.cpuTokens, CPU_SEL)}${context(detail)}`);
      }
    }));

    // C2b — every board/chassis fan RPM the box exposes, as RPM values, not as
    // the GPU rows' fan percentages.
    results.push(await guardedCheck('C2b', COVERED.C2b, async () => {
      const detail = needForge();
      const shown = numbersIn(detail.fanTokens);
      const missing = FORGE_FAN_RPMS.filter((rpm) => !shown.includes(rpm));
      if (missing.length > 0) {
        throw new Error(`${FORGE}'s board exposes fans ${JSON.stringify(FORGE_FAN_RPMS)} RPM but the detail renders ${JSON.stringify(missing)} nowhere — ${describe(detail, 'board fan', detail.fanTokens, FAN_SEL)}${context(detail)}`);
      }
      if (!/rpm/i.test(detail.fanTokens.join(' ')) && !/rpm/i.test(detail.text)) {
        throw new Error(`${FORGE}'s fan speeds are rendered without an RPM unit; a chassis fan is RPM, not a percentage — tokens were ${JSON.stringify(detail.fanTokens.slice(0, 8))}`);
      }
    }));

    // C2c — a box whose Super-I/O fan chip is unreadable renders NO fan and NO
    // error, while still rendering its own readable sensor (ambiguity 6).
    results.push(await guardedCheck('C2c', COVERED.C2c, async () => {
      const detail = needQuiet();
      const cpuNumbers = numbersIn(detail.cpuTokens);
      if (!cpuNumbers.includes(QUIET_CPU_C)) {
        throw new Error(`${QUIET} exposes no fan chip but DOES expose CPU ${QUIET_CPU_C}°C; graceful absence means the rest of the sensor panel still renders, and it does not — ${describe(detail, 'CPU temperature', detail.cpuTokens, CPU_SEL)}${context(detail)}`);
      }
      const fanNumbers = numbersIn(detail.fanTokens);
      if (fanNumbers.length > 0 || /\d+\s*rpm/i.test(detail.text)) {
        throw new Error(`${QUIET} exposes no fan sensor at all, but its detail renders fan value(s) ${JSON.stringify(detail.fanTokens.slice(0, 8))}; an unreadable fan chip must show no number, not 0 and not an invented speed`);
      }
      if (/\b(error|failed|exception|undefined|nan|null)\b/i.test(detail.text)) {
        throw new Error(`${QUIET}'s missing fan chip produced an error on screen: ${JSON.stringify(detail.text.slice(0, 220))}`);
      }
    }));

    // C3a — OS uptime since the current boot, as the fixture's own literal.
    results.push(await guardedCheck('C3a', COVERED.C3a, async () => {
      const detail = needForge();
      const blob = `${detail.uptimeTokens.join(' ')} ${detail.text}`;
      if (!blob.includes(FORGE_OS_UPTIME)) {
        throw new Error(`${FORGE} booted ${FORGE_OS_UPTIME} ago but the detail renders no such OS uptime — ${describe(detail, 'OS uptime', detail.uptimeTokens, UPTIME_SEL)}${context(detail)}`);
      }
    }));

    // C3b — the power session is shown when, and only when, xmac's log proves a
    // WAKE-to-UP inside the current boot. FORGE has that record; QUIET does not,
    // so a duration on QUIET's detail would be invented (ambiguity 5).
    results.push(await guardedCheck('C3b', COVERED.C3b, async () => {
      const detail = needForge();
      const blob = `${detail.sessionTokens.join(' ')}`;
      const provable = /5400/.test(blob) || /\b90\s*m/i.test(blob) || (/\b1\s*h/i.test(blob) && /\b30\s*m/i.test(blob));
      if (!provable) {
        throw new Error(`xmac's log proves ${FORGE} has been up ${FORGE_SESSION_SECONDS}s this power session, but the detail renders no such duration — ${describe(detail, 'power session', detail.sessionTokens, SESSION_SEL)}${context(detail)}`);
      }
      const quietDetail = needQuiet();
      const quietBlob = blobOf(quietDetail.sessionTokens);
      const quietClaims = /\d/.test(quietBlob) && !/unknown|unprov|never/.test(quietBlob);
      if (quietClaims) {
        throw new Error(`${QUIET} has no WAKE-to-UP record in xmac's log, so no power session can be proven, yet its detail renders ${JSON.stringify(quietDetail.sessionTokens.slice(0, 8))} — a duration shown without a matching record is fabricated`);
      }
    }));

    // C3c — that unprovable session says UNKNOWN, with its provenance, rather
    // than going silent.
    results.push(await guardedCheck('C3c', COVERED.C3c, async () => {
      const detail = needQuiet();
      // Scoped to the power-session surface itself: the WoL block elsewhere on
      // the detail already says "never verified" about a different question,
      // and it must not be mistaken for an answer about the power session.
      const blob = blobOf(detail.sessionTokens);
      if (detail.sessionTokens.length === 0) {
        throw new Error(`${QUIET}'s power session cannot be proven from xmac's log, and the detail renders no power-session surface at all to say so — ${describe(detail, 'power session', detail.sessionTokens, SESSION_SEL)}${context(detail)}`);
      }
      if (!/unknown|unprovable|not proven|no wake record|never verified/.test(blob)) {
        throw new Error(`${QUIET}'s power session cannot be proven from xmac's log, but its power-session surface never says unknown — it reads ${JSON.stringify(detail.sessionTokens.slice(0, 8))}${context(detail)}`);
      }
      const provenance = `${blobOf(detail.provenanceTokens)} ${blob}`;
      if (!/xmac|log|provenance|registry|collector/.test(provenance)) {
        throw new Error(`${QUIET}'s unknown power session carries no provenance — the owner cannot tell what was consulted; provenance tokens were ${JSON.stringify(detail.provenanceTokens.slice(0, 8))}`);
      }
    }));

    // C3d — total on-hours is labelled ESTIMATED, and the number is the one the
    // sampled boot implies (ambiguity 5).
    results.push(await guardedCheck('C3d', COVERED.C3d, async () => {
      const detail = needForge();
      const blob = blobOf(detail.onHoursTokens);
      if (!/estimat|approx|~/.test(blob)) {
        throw new Error(`${FORGE}'s total on-hours is sampled, so it must be labelled estimated — ${describe(detail, 'on-hours', detail.onHoursTokens, ONHOURS_SEL)}${context(detail)}`);
      }
      const shown = numbersIn(detail.onHoursTokens);
      if (!shown.some((value) => Math.abs(value - EXPECTED_ON_HOURS) < 0.5)) {
        throw new Error(`${FORGE} has been up ${UP_SECONDS}s, i.e. ${EXPECTED_ON_HOURS.toFixed(2)} on-hours, but the detail renders ${JSON.stringify(shown)}`);
      }
    }));

    // C4a — what is keeping the box busy: the busy-check's own output.
    results.push(await guardedCheck('C4a', COVERED.C4a, async () => {
      const detail = needForge();
      const blob = `${detail.busyTokens.join(' ')} ${detail.text}`;
      if (!blob.includes(BUSY_OUTPUT)) {
        throw new Error(`${FORGE}'s busy check reports ${JSON.stringify(BUSY_OUTPUT)} but the detail renders no such output — ${describe(detail, 'busy output', detail.busyTokens, BUSY_SEL)}${context(detail)}`);
      }
    }));

    // C4b — every held xmac lease, by name.
    results.push(await guardedCheck('C4b', COVERED.C4b, async () => {
      const detail = needForge();
      const blob = `${detail.leaseTokens.join(' ')} ${detail.text}`;
      const missing = LEASE_NAMES.filter((lease) => !blob.includes(lease));
      if (missing.length > 0) {
        throw new Error(`${FORGE} holds leases ${JSON.stringify(LEASE_NAMES)} but the detail renders ${JSON.stringify(missing)} nowhere — ${describe(detail, 'lease', detail.leaseTokens, LEASE_SEL)}${context(detail)}`);
      }
    }));

    // C4c — the Off control is disabled and SELF-EXPLANATORY: it names the
    // guard or the protected role that is holding the box.
    results.push(await guardedCheck('C4c', COVERED.C4c, async () => {
      const detail = needForge();
      if (!detail.off || !detail.off.found) {
        throw new Error(`${FORGE}'s detail renders no Off control at all (tried ${OFF_SEL}), so nothing can explain why Off is unavailable${context(detail)}`);
      }
      if (!detail.off.disabled) {
        throw new Error(`${FORGE} is busy (${BUSY_OUTPUT}), leased (${LEASE_NAMES.join(', ')}) and protected (${PROTECTED_ROLE}), but its Off control renders enabled — attrs ${JSON.stringify(detail.off.attrs)}`);
      }
      const named = `${blobOf(detail.protectedTokens)} ${detail.off.text.toLowerCase()} ${blobOf(detail.off.attrs)} ${detail.text.toLowerCase()}`;
      if (!named.includes(PROTECTED_ROLE) && !named.includes('train.py') && !named.includes(LEASE_NAMES[0])) {
        throw new Error(`${FORGE}'s Off control is disabled but names no guard — the owner cannot tell whether it is the ${PROTECTED_ROLE} role, the busy process or a lease; the detail read ${JSON.stringify(detail.text.slice(0, 220))}`);
      }
    }));

    // L9a — the rendered values are the FAKE FLEET's values: the detail traces
    // to the payload the page actually received, and that payload is the
    // non-actuating fake mode, not an armed runtime.
    results.push(await guardedCheck('L9a', COVERED.L9a, async () => {
      const detail = needForge();
      if (!detail.payload) {
        throw new Error(`the page received no /api/xmachines/machines/${FORGE} payload, so no rendered value can be traced to the fake fleet${context(detail)}`);
      }
      if (detail.payload.armed === true || detail.payload.mode === 'armed') {
        throw new Error(`the read route reported an ARMED runtime (mode=${String(detail.payload.mode)}); a fake-fleet fence must run against the non-actuating gateway`);
      }
      const machine = detail.payload.machine ?? {};
      if (String(machine.name) !== FORGE) {
        throw new Error(`the detail payload is for ${JSON.stringify(machine.name)}, not the selected machine ${FORGE}`);
      }
      const payloadBusy = machine.busy?.busyCheckOutput ?? '';
      if (payloadBusy !== BUSY_OUTPUT) {
        throw new Error(`the payload's busy output is ${JSON.stringify(payloadBusy)}, not the fake fleet's ${JSON.stringify(BUSY_OUTPUT)} — the fixture, not the render, is wrong`);
      }
      if (!detail.text.includes(payloadBusy)) {
        throw new Error(`the detail renders no value matching its own payload's busy output ${JSON.stringify(payloadBusy)}; the detail read ${JSON.stringify(detail.text.slice(0, 220))}`);
      }
      const payloadCpu = machine.cpuTemp;
      if (payloadCpu !== FORGE_CPU_C) {
        throw new Error(`the payload's CPU reading is ${JSON.stringify(payloadCpu)}, not the fake fleet's ${FORGE_CPU_C} — the fixture, not the render, is wrong`);
      }
      if (!numbersIn(detail.cpuTokens).includes(Number(payloadCpu))) {
        throw new Error(`the detail's CPU surface does not carry its own payload's reading ${String(payloadCpu)} — ${describe(detail, 'CPU temperature', detail.cpuTokens, CPU_SEL)}`);
      }
      const spy = scratch ? forbiddenGatewayCalls(scratch.log) : [];
      if (spy.length > 0) {
        throw new Error(`reading one machine's detail made ${spy.length} gateway/wake call(s): ${JSON.stringify(spy.slice(0, 3))} — a fake-fleet read must contact nothing`);
      }
    }));
  } finally {
    if (session) await session.context.close();
  }

  finish('E2/D5', results, 11);
});
