import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E7 — INTEGRATION: ONE fake machine's detail renders its storage (SMART
// health, per-disk temperature, filesystem free space), its UPS (battery,
// runtime, load, or an explicit unavailable state), its PHP energy cost with
// the placeholder-tariff and short-burst caveats, and its WoL-safe evidence
// (verified / stale / never-verified) — with nothing fabricated.
//
// Contributors: D10 (the hdd SMART + disk-temperature + free-space panel and
// the NUT battery / runtime / load / unavailable states) and D11 (detail-only
// PHP cost with the placeholder-tariff and short-burst caveats, plus the
// verified / stale / never-verified WoL-safe indicators).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E7 and
// implements none of it; it contains NO product code. Measured today against
// the landed detail surface:
//   * D10 HAS NOT LANDED, and it is the whole reason this fence is red. The
//     detail route `GET /api/xmachines/machines/:name`
//     (src/api/routes/xmachines-routes.ts:697) returns `machine`, `gpuRows`,
//     `wolSafety` and `cost` — and NOTHING disk- or UPS-shaped. The renderer
//     `renderMachineCostDetail` (src/web/public/xmachines-cost-view.js:295)
//     emits the name, the readout, GPU rows, kWh, PHP, the tariff flag, the
//     caveat, the WoL block and the power controls — grep it for `disk`,
//     `smart`, `ups` or `battery`: zero hits. B9's `renderHddDiskPanel`
//     (src/services/xmachines/disk-telemetry.ts) and B10's `readNut` parsing
//     (src/services/xmachines/readonly-collector.ts) both exist and are both
//     unreachable from any route or view — nothing calls them. So every I2*
//     and I3* id below, and L9a (which is decided on the storage/UPS trace),
//     is red today for exactly one reason: the panel does not exist.
//   * D11's ids are asserted at FULL STRENGTH and several of them already hold
//     today, because B13 and B14 landed the cost block and the WoL block in the
//     same renderer. This fence is where they must KEEP holding once D10 adds a
//     storage and a UPS panel around them. D11 does not have to turn them
//     red-to-green; it has to not break them, and the contract's negative
//     control (`FENCE_STUB=D10 ... --expect-red I2a`) discriminates through an
//     id that IS red today.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE names WHICH
// contributor broke composition in `failing_units`:
//   test_d10_...  I2a I2b I2c I3a I3b I3c I3d L9a
//   test_d11_...  I4a I4b I4c I4d I4e I5a I5b I5d
//
// THE FAKE FLEET IS THIS JOURNEY'S OWN SERVER, NOT THE DEPLOYED APP. The
// journey spawns the real `createApiServer` through tsx against src/ (so a
// stale dist/ cannot make it red for a build reason), behind a tunnel-shaped
// reverse proxy that reproduces the Cloudflare header shape the routes' own
// host/origin checks read. Every fixture address is TEST-NET-1 (192.0.2.0/24),
// no octet is 174/179/169, and XMACHINES_ARM is deliberately UNSET: this row is
// a read-only render, so the runtime must be the non-actuating fake one.
// FENCE_ORIGIN is ignored — a deployed origin could not be given fixtures, a
// scratch database or a PATH spy, so nothing on this row would be observable
// there.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. NO CANONICAL DOM CONTRACT for D10 exists yet, so the storage and UPS
//     surfaces are looked for across an alias set of testids / classes /
//     data-attributes that includes the markup B9's existing renderer already
//     emits (`.hdd-panel`, `.disk-row[data-disk]`, `.smart-health`,
//     `.disk-temp`, `.fs-row[data-mount]`). That broadens WHERE the evidence
//     may appear; it does not weaken WHAT must be true. Every value asserted is
//     a literal that exists ONLY in this journey's fixtures, and it is looked
//     for INSIDE the storage / UPS surface (and, where the implementation
//     renders per-device rows, inside the row for that device) — never in the
//     detail's whole text, which would let a GPU temperature pass as a disk
//     temperature.
//  2. HOW D10 GETS ITS DATA is D10's choice, so the same literals are offered
//     through every plausible channel at once: (a) PATH spies for `ssh`,
//     `smartctl`, `upsc`, `df` answering the exact command shapes
//     BoundedCommandReadSource issues, (b) seeded `xm_reader_results` rows
//     (kind `smart` / `nut`) in the scratch database, and (c) `disks`,
//     `filesystems` and `ups` extension keys on the telemetry fixture, beside
//     the keys the read model already carries. All three carry byte-identical
//     values, so whichever seam D10 reads, the assertion is the same, and no
//     channel can be satisfied by a value this journey did not author.
//  3. FREE SPACE UNITS. `df -B1 -P` reports bytes and B9's panel renders the
//     byte string verbatim, but a humanized "15 TB" is a legitimate render.
//     I2c therefore accepts the raw byte string, a digit-grouped byte string,
//     or a TB/TiB/GB/GiB rendering of the same number at 0-2 decimals. The
//     MOUNT must always be named exactly.
//  4. UPS RUNTIME UNITS. NUT reports `battery.runtime` in seconds (2280); a
//     panel may render 2280 or 38 minutes. I3b accepts either, and nothing
//     else.
//  5. THE CONFIGURED TARIFF IS GLOBAL (one `xm_config` row), so a single
//     server cannot show both a placeholder and a configured tariff. I4b/I4c
//     are therefore decided across TWO scratch servers over the SAME fixtures
//     and the SAME persisted samples: one with no tariff row (placeholder) and
//     one with `xm_cost_tariff_ph_p_per_kwh = 7.25` (configured).
//  6. COST EXPECTATIONS ARE COMPUTED, NOT HARDCODED. kWh integration is
//     floating point, so I4a compares the rendered number against the value
//     integrated from the rows this journey persisted, within 1e-9, and
//     against the payload the page itself received. The specimen feed carries
//     one NULL-watt sample (which must be skipped) and a second machine at
//     9000 W (which must not bleed in), so a fabricated or cross-machine
//     number cannot match.
//  7. I5c IS DELIBERATELY NOT ON THIS ROW (the stale / never-verified Off
//     challenge is E4's), so I5b asserts that stale and never-verified render
//     as DISTINCT, correctly-named states, and I5d asserts the off-warning
//     appears for both of them and is absent on the verified machine — a
//     warning shown on a verified box is a fabrication, not a courtesy.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E7';
const ACCEPTANCE_IDS = [
  'I2a', 'I2b', 'I2c',
  'I3a', 'I3b', 'I3c', 'I3d',
  'I4a', 'I4b', 'I4c', 'I4d', 'I4e',
  'I5a', 'I5b', 'I5d',
  'L9a',
];
// id -> the contributor blamed when it rejects.
const COVERED: Record<string, string> = {
  I2a: 'D10', I2b: 'D10', I2c: 'D10',
  I3a: 'D10', I3b: 'D10', I3c: 'D10', I3d: 'D10',
  L9a: 'D10',
  I4a: 'D11', I4b: 'D11', I4c: 'D11', I4d: 'D11', I4e: 'D11',
  I5a: 'D11', I5b: 'D11', I5d: 'D11',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'e7-fence-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const WAKE_VERBS = ['up', 'run', 'claim', 'release', 'wake'];
const SELFTEST_MARKER = 'e7-spy-selftest';

// ---------------------------------------------------------------------------
// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media) so no assertion here can be aimed at, or accidentally satisfied
// by, a real box. They carry no hyphen because uptime.ts's log parse matches
// the machine token with \w+.
// ---------------------------------------------------------------------------
const VAULT = 'e7vault'; // storage + UPS + cost + verified WoL — the subject machine
const DIM = 'e7dim';     // UPS source absent (probe times out) + never-verified WoL
const HUSK = 'e7husk';   // WAKE with no later UP -> stale WoL

const FLEET = [VAULT, DIM, HUSK];
const OCTET: Record<string, string> = { [VAULT]: '211', [DIM]: '212', [HUSK]: '213' };
const ROLE: Record<string, string> = { [VAULT]: 'storage', [DIM]: 'storage', [HUSK]: 'compute' };

// The boot window every timestamp below sits inside.
const UP_SECONDS = 6 * 3600;

// --- D10's storage fixture (channel (a), (b) and (c) all carry these) -------
type DiskFixture = { device: string; health: string; temperatureC: string; rawTemp: number | null };
// /dev/sdc reports neither health nor temperature on purpose: "unavailable" is
// the specified render, and a panel that prints 0 C there is fabricating.
const VAULT_DISKS: DiskFixture[] = [
  { device: '/dev/sda', health: 'PASSED', temperatureC: '44 C', rawTemp: 44 },
  { device: '/dev/sdb', health: 'PASSED', temperatureC: '37 C', rawTemp: 37 },
  { device: '/dev/sdc', health: 'unavailable', temperatureC: 'unavailable', rawTemp: null },
];

type FsFixture = { mount: string; total: string; used: string; available: string; capacity: string };
const VAULT_FILESYSTEMS: FsFixture[] = [
  { mount: '/srv/archive', total: '47000000000000', used: '32000000000000', available: '15000000000000', capacity: '69%' },
  { mount: '/srv/cold', total: '16000000000000', used: '2000000000000', available: '14000000000000', capacity: '13%' },
];

// --- D10's UPS fixture ------------------------------------------------------
const VAULT_BATTERY_PCT = 87;
const VAULT_RUNTIME_SECONDS = 2280; // exactly 38 minutes (ambiguity 4)
const VAULT_UPS_LOAD_PCT = 42;

// --- D11's cost fixture -----------------------------------------------------
// 30-minute spaced samples, which is the cadence cost.ts integrates at. The
// NULL row must be skipped and DIM's 9000 W must not bleed into VAULT.
const VAULT_WATTS: Array<number | null> = [400, 220, 180, null];
const DIM_WATTS: Array<number | null> = [9000, 9000];
const CONFIGURED_TARIFF = 7.25;
const TARIFF_KEY = 'xm_cost_tariff_ph_p_per_kwh';
const BURSTS_CAVEAT = 'bursts shorter than 30 minutes may be missed';
const WOL_UNVERIFIED_WARNING = 'Unverified machine may remain off';

// The one number the whole cost half is decided on, integrated exactly as
// cost.ts integrateKwhFromSamples does (0.5h per sample, NaN skipped).
function expectedKwh(watts: ReadonlyArray<number | null>): number {
  let total = 0;
  for (const value of watts) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    total += (value * 0.5) / 1000;
  }
  return total;
}
function expectedPhp(kwh: number, tariff: number): number {
  return Math.round(kwh * tariff * 100) / 100;
}
const VAULT_KWH = expectedKwh(VAULT_WATTS);
const VAULT_PHP_PLACEHOLDER = expectedPhp(VAULT_KWH, 1.0); // DEFAULT_TARIFF
const VAULT_PHP_CONFIGURED = expectedPhp(VAULT_KWH, CONFIGURED_TARIFF);

// ---------------------------------------------------------------------------
// Selector unions (ambiguity 1).
// ---------------------------------------------------------------------------
const DETAIL_SEL = '[data-testid="xmachines-machine-detail"]';
const OVERVIEW_SEL = '[data-testid="xmachines-fleet-overview"]';
const GPU_ROW_SEL = ['[data-testid="xmachines-gpu-row"]', '[data-gpu-uuid]', '.gpu-row'].join(', ');

const STORAGE_SEL = [
  '[data-testid*="hdd"]',
  '[data-testid*="disk"]',
  '[data-testid*="smart"]',
  '[data-testid*="storage"]',
  '[data-testid*="filesystem"]',
  '.hdd-panel',
  '.xm-hdd',
  '.xm-storage',
  '[data-hdd-panel]',
].join(', ');
const DISK_ROW_SEL = [
  '.disk-row',
  '[data-disk]',
  '[data-testid*="disk-row"]',
  '[data-testid*="smart-row"]',
].join(', ');
const FS_ROW_SEL = [
  '.fs-row',
  '[data-mount]',
  '[data-testid*="fs-row"]',
  '[data-testid*="filesystem-row"]',
].join(', ');
const UPS_SEL = [
  '[data-testid*="ups"]',
  '[data-testid*="nut"]',
  '[data-testid*="battery"]',
  '[data-testid*="runtime"]',
  '.xm-ups',
  '.ups-panel',
  '[data-ups]',
].join(', ');

const COST_KWH_SEL = ['[data-testid="xmachines-cost-kwh"]', '[data-testid*="kwh"]', '[data-kwh]'].join(', ');
const COST_PHP_SEL = ['[data-testid="xmachines-cost-php"]', '[data-testid*="cost-php"]', '[data-testid*="php"]', '[data-cost-php]'].join(', ');
const TARIFF_SEL = ['[data-testid="xmachines-tariff-flag"]', '[data-testid*="tariff"]', '[data-tariff]'].join(', ');
const CAVEAT_SEL = ['[data-testid="xmachines-cost-caveat"]', '[data-testid*="caveat"]', '[data-caveat]'].join(', ');
const WOL_SEL = ['[data-testid="xmachines-wol-safety"]', '[data-testid*="wol"]', '.xm-wol', '[data-wol]'].join(', ');
const WOL_STATUS_SEL = ['[data-testid="xmachines-wol-status"]', '[data-testid*="wol-status"]', '[data-wol-status]'].join(', ');
const WOL_WARN_SEL = ['[data-testid="xmachines-wol-warning"]', '[data-testid*="wol-warning"]'].join(', ');
const WOL_WAKE_SEL = ['[data-testid="xmachines-wol-last-wake"]', '[data-testid*="last-wake"]'].join(', ');
const WOL_UP_SEL = ['[data-testid="xmachines-wol-verified-up"]', '[data-testid*="verified-up"]'].join(', ');

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
// The scratch fake fleet. Every path is under os.tmpdir(); the repository, the
// real ~/.config/agent-protocols/xmac and the real ~/.xmac are untouched.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  bin: string;
  log: string;
  statusPath: string;
  answerDir: string;
  seedPath: string;
  env: NodeJS.ProcessEnv;
};

// The command name is a literal baked into each spy script, not read from
// argv[0] at invocation time, so the recorded executable identity cannot be
// spoofed by how the child happened to be invoked (the A14/A15 pattern).
function logPrelude(name: string, log: string): string {
  return `#!/bin/bash\nset -u\n{\n  printf '%s' ${JSON.stringify(name)}\n  for arg in "$@"; do printf '\\t%s' "$arg"; done\n  printf '\\n'\n} >> ${JSON.stringify(log)}\n`;
}

// The answer files are per-machine, and `current` names the machine whose
// detail is being read, so a LOCAL collector (one that does not ssh) cannot be
// handed one machine's disks while another machine's detail is on screen.
function installSpies(bin: string, log: string, answerDir: string): void {
  for (const name of ['ping', 'wakeonlan', 'xmac.sh', 'xmac', 'nvidia-smi', 'sensors']) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `${logPrelude(name, log)}exit 0\n`, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }

  // ssh: the read-only probe channel. It answers the EXACT command shapes
  // BoundedCommandReadSource issues (`smartctl -H`, the scan+df disk command,
  // `upsc ups@localhost`) for the machine named in the argv, and nothing else.
  // It never runs anything.
  const ssh = `${logPrelude('ssh', log)}
DIR=${JSON.stringify(answerDir)}
ARGS="$*"
M=""
for token in "$@"; do
  candidate="\${token##*@}"
  if [ -f "$DIR/$candidate.host" ]; then M="$candidate"; fi
done
if [ -z "$M" ]; then
  OCTET="$(printf '%s' "$ARGS" | grep -oE '192\\.0\\.2\\.[0-9]+' | head -n1 | awk -F. '{print $4}')"
  M="$(cat "$DIR/octet-$OCTET" 2>/dev/null || true)"
fi
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
  *smartctl*)
    cat "$DIR/$M.smart" 2>/dev/null || true
    ;;
esac
exit 0
`;
  fs.writeFileSync(path.join(bin, 'ssh'), ssh, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'ssh'), 0o755);

  // Local smartctl / df / upsc, for a collector that reads the box it runs on.
  // They answer for the machine whose detail is currently being read.
  const smartctl = `${logPrelude('smartctl', log)}
DIR=${JSON.stringify(answerDir)}
M="$(cat "$DIR/current" 2>/dev/null || true)"
case "$*" in
  *--scan*) cat "$DIR/$M.scan" 2>/dev/null || true ;;
  *) cat "$DIR/$M.smart" 2>/dev/null || true ;;
esac
exit 0
`;
  fs.writeFileSync(path.join(bin, 'smartctl'), smartctl, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'smartctl'), 0o755);

  const df = `${logPrelude('df', log)}
DIR=${JSON.stringify(answerDir)}
M="$(cat "$DIR/current" 2>/dev/null || true)"
cat "$DIR/$M.df" 2>/dev/null || true
exit 0
`;
  fs.writeFileSync(path.join(bin, 'df'), df, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'df'), 0o755);

  const upsc = `${logPrelude('upsc', log)}
DIR=${JSON.stringify(answerDir)}
M="$(cat "$DIR/current" 2>/dev/null || true)"
if [ -f "$DIR/$M.ups-timeout" ]; then sleep 3; exit 0; fi
cat "$DIR/$M.ups" 2>/dev/null || true
exit 0
`;
  fs.writeFileSync(path.join(bin, 'upsc'), upsc, { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'upsc'), 0o755);
}

function statusLines(): string {
  return `${FLEET.map((name) => `${name}  192.0.2.${OCTET[name]}  UP  leases=()  ${ROLE[name]}`).join('\n')}\n`;
}

function confLines(): string {
  return `${FLEET.map((name) => `${name}|192.0.2.${OCTET[name]}|02:00:00:00:00:${OCTET[name]}|agjrom|${ROLE[name]}|true`).join('\n')}\n`;
}

// smartctl -H -A per device, in the `=== <dev> ===` sectioned shape the
// collector's disk command produces. The temperature sits eight tokens after
// the attribute name, which is where disk-telemetry.ts reads RAW from — a
// normalized 118 must not pass as a temperature.
function smartText(disks: readonly DiskFixture[]): string {
  const lines: string[] = [];
  for (const disk of disks) {
    lines.push(`=== ${disk.device} ===`);
    if (disk.health !== 'unavailable') {
      lines.push('smartctl 7.2 2020-12-30 r5155 [x86_64-linux] (local build)');
      lines.push(`SMART overall-health self-assessment test result: ${disk.health}`);
    }
    if (disk.rawTemp !== null) {
      lines.push('ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE');
      lines.push(`194 Temperature_Celsius     0x0022   118   118   000    Old_age   Always       -       ${disk.rawTemp}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function scanText(disks: readonly DiskFixture[]): string {
  return `${disks.map((disk) => `${disk.device} -d sat # ${disk.device}, SAT device`).join('\n')}\n`;
}

// `df -B1 -P`: the header carries no NN% token, so the parser skips it.
function dfText(rows: readonly FsFixture[]): string {
  const lines = ['Filesystem     1-blocks          Used     Available Capacity Mounted on'];
  for (const row of rows) {
    lines.push(`${row.mount.replace('/srv/', '/dev/')}1 ${row.total} ${row.used} ${row.available} ${row.capacity} ${row.mount}`);
  }
  return `${lines.join('\n')}\n`;
}

function upsText(): string {
  return [
    'device.mfr: FIXTURE',
    'device.model: e7-ups',
    `battery.charge: ${VAULT_BATTERY_PCT}`,
    `battery.runtime: ${VAULT_RUNTIME_SECONDS}`,
    `ups.load: ${VAULT_UPS_LOAD_PCT}`,
    'ups.status: OL',
    '',
  ].join('\n');
}

function stamp(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// VAULT: WAKE then a LATER UP -> verified, with both timestamps rendered.
// HUSK:  WAKE with no later UP -> stale.
// DIM:   no record at all      -> never-verified.
const VAULT_WAKE = stamp(50 * 60 * 1000);
const VAULT_UP = stamp(40 * 60 * 1000);
const HUSK_WAKE = stamp(35 * 60 * 1000);

function xmacLogText(): string {
  return [
    `${VAULT_WAKE} WAKE ${VAULT} 1`,
    `${VAULT_UP} UP ${VAULT} 600s`,
    `${HUSK_WAKE} WAKE ${HUSK} 1`,
    '',
  ].join('\n');
}

// The read-model fixture. `cpuTemp` / `uptime` / `provenance` are read today;
// `disks`, `filesystems` and `ups` are D10's extension keys, carrying the SAME
// literals the spies and the seeded reader rows carry (ambiguity 2). Numbers
// are chosen so no disk temperature can be satisfied by a CPU or GPU reading.
function metricsJson(): string {
  const row = (name: string, extra: Record<string, unknown>) => [name, {
    gpuTempsC: [61],
    gpuPowerWatts: [120],
    uptime: '6h 0m',
    freshness: 'fresh',
    provenance: 'collector-cli',
    sampleAge: '20s',
    cpuTemp: 52,
    ...extra,
  }] as const;
  return JSON.stringify(Object.fromEntries([
    row(VAULT, {
      disks: VAULT_DISKS.map((disk) => ({ device: disk.device, health: disk.health, temperatureC: disk.temperatureC })),
      filesystems: VAULT_FILESYSTEMS.map((fsRow) => ({
        mount: fsRow.mount, total: fsRow.total, used: fsRow.used, available: fsRow.available,
      })),
      ups: {
        availability: 'ok',
        freshness: 'fresh',
        batteryChargePct: VAULT_BATTERY_PCT,
        runtimeSeconds: VAULT_RUNTIME_SECONDS,
        loadPct: VAULT_UPS_LOAD_PCT,
        raw: upsText(),
      },
    }),
    row(DIM, {
      disks: [],
      filesystems: [],
      ups: { availability: 'unavailable', freshness: 'stale', batteryChargePct: null, runtimeSeconds: null, loadPct: null, raw: '' },
    }),
    row(HUSK, { disks: [], filesystems: [], ups: { availability: 'unavailable', freshness: 'stale', raw: '' } }),
  ]));
}

// Channel (b): the rows a collector cycle would have persisted.
function seedJson(): string {
  const nowMs = Date.now();
  const samples: unknown[] = [];
  const pushSamples = (machine: string, watts: ReadonlyArray<number | null>) => {
    watts.forEach((value, index) => {
      samples.push({
        machine,
        uuid: `GPU-E7-${machine.toUpperCase()}-1`,
        // 30-minute cadence, oldest first, all inside the last three hours.
        sampleTime: new Date(nowMs - (watts.length - index) * 30 * 60 * 1000).toISOString(),
        powerWatts: value,
      });
    });
  };
  pushSamples(VAULT, VAULT_WATTS);
  pushSamples(DIM, DIM_WATTS);
  return JSON.stringify({
    samples,
    readerResults: [
      { machine: VAULT, kind: 'smart', availability: 'ok', freshness: 'fresh', value: smartText(VAULT_DISKS) },
      { machine: VAULT, kind: 'nut', availability: 'ok', freshness: 'fresh', value: upsText() },
      { machine: DIM, kind: 'nut', availability: 'unavailable', freshness: 'stale', value: '' },
      { machine: HUSK, kind: 'nut', availability: 'unavailable', freshness: 'stale', value: '' },
    ],
  });
}

function newScratch(tariff: number | null): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e7-aux-detail-'));
  const bin = path.join(dir, 'bin');
  const answerDir = path.join(dir, 'answers');
  const stateDir = path.join(dir, 'xmac-state');
  const protectedDir = path.join(dir, 'protected');
  fs.mkdirSync(bin);
  fs.mkdirSync(answerDir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(protectedDir, { recursive: true });

  const log = path.join(dir, 'argv.log');
  installSpies(bin, log, answerDir);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const xmacLogPath = path.join(dir, 'xmac.log');
  const seedPath = path.join(dir, 'seed.json');
  fs.writeFileSync(statusPath, statusLines());
  fs.writeFileSync(confPath, confLines());
  fs.writeFileSync(metricsPath, metricsJson());
  fs.writeFileSync(xmacLogPath, xmacLogText());
  fs.writeFileSync(seedPath, seedJson());

  for (const name of FLEET) {
    fs.writeFileSync(path.join(answerDir, `${name}.host`), `${name}\n`);
    fs.writeFileSync(path.join(answerDir, `octet-${OCTET[name]}`), `${name}\n`);
    fs.writeFileSync(path.join(answerDir, `${name}.smart`), name === VAULT ? smartText(VAULT_DISKS) : '');
    fs.writeFileSync(path.join(answerDir, `${name}.scan`), name === VAULT ? scanText(VAULT_DISKS) : '');
    fs.writeFileSync(path.join(answerDir, `${name}.df`), name === VAULT ? dfText(VAULT_FILESYSTEMS) : '');
    fs.writeFileSync(path.join(answerDir, `${name}.ups`), name === VAULT ? upsText() : '');
  }
  // DIM's UPS source is absent: the probe times out, which is how
  // BoundedCommandReadSource reaches availability=unavailable through its own
  // code path rather than by being told the answer.
  fs.writeFileSync(path.join(answerDir, `${DIM}.ups-timeout`), '1\n');
  fs.writeFileSync(path.join(answerDir, `${HUSK}.ups-timeout`), '1\n');
  fs.writeFileSync(path.join(answerDir, 'current'), `${VAULT}\n`);

  // No protected role and no lease is live on the fake fleet: a refusal block
  // is E4's row, and one here would crowd the panels this fence is about.
  fs.writeFileSync(
    path.join(protectedDir, 'status.json'),
    JSON.stringify(Object.fromEntries(FLEET.map((name) => [name, { ip: `192.0.2.${OCTET[name]}` }]))),
  );
  fs.writeFileSync(path.join(protectedDir, 'roles.json'), JSON.stringify({}));
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
    XMAC_USER: 'agjrom',
    E7_OWNER_TOKEN: OWNER_TOKEN,
    E7_SEED: seedPath,
    E7_TARIFF: tariff === null ? '' : String(tariff),
  };
  // Non-actuating (L10): arming is process configuration, and a read-only
  // render fence must never be able to reach a real box.
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  return { dir, bin, log, statusPath, answerDir, seedPath, env };
}

function viewing(scratch: Scratch, machine: string): void {
  fs.writeFileSync(path.join(scratch.answerDir, 'current'), `${machine}\n`);
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
// src/, with a scratch database seeded with the power samples the cost path
// integrates and the reader rows a collector cycle would have written.
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');

const OWNER_TOKEN = process.env.E7_OWNER_TOKEN;
const db = new DatabaseService(':memory:');
const raw = db.raw;
const seed = JSON.parse(fs.readFileSync(process.env.E7_SEED, 'utf8'));

const insertDevice = raw.prepare(
  'INSERT INTO xm_devices (machine_name, gpu_uuid, gpu_name, status, ordinal, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insertSample = raw.prepare(
  'INSERT INTO xm_samples (machine_name, gpu_uuid, sample_time, temperature, power_watts, utilization_gpu, utilization_mem, fan_speed, vram_mb, vram_total_mb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const seenDevice = new Set();
for (const row of seed.samples) {
  if (!seenDevice.has(row.machine + row.uuid)) {
    seenDevice.add(row.machine + row.uuid);
    insertDevice.run(row.machine, row.uuid, 'E7 FIXTURE DEVICE', 'active', 0, row.sampleTime, row.sampleTime);
  }
  insertSample.run(row.machine, row.uuid, row.sampleTime, 55, row.powerWatts, 10, null, 30, 1024, 8192);
}

const insertReader = raw.prepare(
  'INSERT INTO xm_reader_results (machine_name, kind, availability, freshness, value, sample_time) VALUES (?, ?, ?, ?, ?, ?)'
);
const nowIso = new Date().toISOString();
for (const row of seed.readerResults) {
  insertReader.run(row.machine, row.kind, row.availability, row.freshness, row.value, nowIso);
}

// A configured tariff is a single global xm_config row, which is why the
// placeholder and configured cases need two servers (ambiguity 5).
if (process.env.E7_TARIFF) {
  raw.prepare('INSERT INTO xm_config (key, value) VALUES (?, ?)').run(${JSON.stringify(TARIFF_KEY)}, process.env.E7_TARIFF);
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
console.log('E7-SERVER-READY ' + app.server.address().port);
`;

type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };

async function startServer(scratch: Scratch): Promise<Server> {
  const script = path.join(scratch.dir, 'server.mts');
  fs.writeFileSync(
    script,
    SERVER_CHILD.replace(/__SRC__/g, path.join(REPO_ROOT, 'src')).replace('__SELFTEST__', SELFTEST_MARKER),
  );
  const child = spawn('npx', ['tsx', script], { cwd: REPO_ROOT, env: scratch.env } as never) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const match = out.match(/E7-SERVER-READY (\d+)/);
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
// owner session, deep-linked to ONE machine's detail — which is this fence's
// subject, "one fake-machine detail".
// ---------------------------------------------------------------------------
type Row = { text: string; attrs: string[] };

type Detail = {
  machine: string;
  present: boolean;
  text: string;
  bodyText: string;
  storageTokens: string[];
  diskRows: Row[];
  fsRows: Row[];
  upsTokens: string[];
  kwhTokens: string[];
  phpTokens: string[];
  tariffTokens: string[];
  caveatTokens: string[];
  wolTokens: string[];
  wolStatusTokens: string[];
  wolWarnTokens: string[];
  wolWakeTokens: string[];
  wolUpTokens: string[];
  payload: Record<string, unknown> | null;
  status: number | null;
  responses: string[];
};

type Session = {
  context: import('@playwright/test').BrowserContext;
  page: import('@playwright/test').Page;
  payloads: Record<string, Record<string, unknown>>;
  statuses: Record<string, number>;
  bodies: string[];
};

async function openSession(browser: import('@playwright/test').Browser): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const payloads: Record<string, Record<string, unknown>> = {};
  const statuses: Record<string, number> = {};
  const bodies: string[] = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/api/xmachines/')) return;
    let text = '';
    try { text = await response.text(); } catch { text = ''; }
    bodies.push(`${response.url()} ${text}`);
    const match = response.url().match(/\/api\/xmachines\/machines\/([^/?]+)(?:$|\?)/);
    if (!match) return;
    const name = decodeURIComponent(match[1]);
    statuses[name] = response.status();
    try { payloads[name] = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON body */ }
  });
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript((token) => {
    const w = window as unknown as { Telegram?: unknown };
    w.Telegram = {
      WebApp: {
        initData: 'e7-fence',
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
  return { context, page, payloads, statuses, bodies };
}

const SCRAPE_SELECTORS = [
  DETAIL_SEL, GPU_ROW_SEL, STORAGE_SEL, DISK_ROW_SEL, FS_ROW_SEL, UPS_SEL,
  COST_KWH_SEL, COST_PHP_SEL, TARIFF_SEL, CAVEAT_SEL,
  WOL_SEL, WOL_STATUS_SEL, WOL_WARN_SEL, WOL_WAKE_SEL, WOL_UP_SEL,
];

// Selecting ONE machine, as the owner does: deep-link its detail route, then
// read every surface the rendered detail claims about it. Tokens are collected
// per surface (never from the whole detail), so a GPU temperature can never be
// mistaken for a disk temperature.
async function readDetail(session: Session, scratch: Scratch, base: string, machine: string): Promise<Detail> {
  viewing(scratch, machine);
  const before = session.bodies.length;
  await session.page.goto(`${base}/index.html#/xmachines/${machine}`, { waitUntil: 'domcontentloaded' });
  await session.page.waitForSelector(DETAIL_SEL, { timeout: 20_000 }).catch(() => {});
  await session.page.waitForTimeout(600);

  const scraped = await session.page.evaluate((sel) => {
    const [
      detailSel, gpuRowSel, storageSel, diskRowSel, fsRowSel, upsSel,
      kwhSel, phpSel, tariffSel, caveatSel,
      wolSel, wolStatusSel, wolWarnSel, wolWakeSel, wolUpSel,
    ] = sel as string[];
    const root = document.querySelector(detailSel);
    const attrsOf = (el: Element): string[] => Array.from(el.attributes).map((attr) => `${attr.name}=${attr.value}`);
    const collect = (scope: Element | null, selector: string): string[] => {
      if (!scope) return [];
      const out: string[] = [];
      for (const found of Array.from(scope.querySelectorAll(selector))) {
        if (found.closest(gpuRowSel)) continue; // a GPU row is never a disk or a UPS
        out.push(...attrsOf(found));
        out.push((found.textContent || '').replace(/\s+/g, ' ').trim());
      }
      return out.filter((token) => token.length > 0);
    };
    const rowsOf = (scope: Element | null, selector: string): Array<{ text: string; attrs: string[] }> => {
      if (!scope) return [];
      return Array.from(scope.querySelectorAll(selector))
        .filter((el) => !el.closest(gpuRowSel))
        .map((el) => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim(), attrs: attrsOf(el) }));
    };
    return {
      present: !!root,
      text: root ? (root.textContent || '').replace(/\s+/g, ' ').trim() : '',
      bodyText: (document.body.textContent || '').replace(/\s+/g, ' ').trim(),
      storageTokens: collect(root, storageSel),
      diskRows: rowsOf(root, diskRowSel),
      fsRows: rowsOf(root, fsRowSel),
      upsTokens: collect(root, upsSel),
      kwhTokens: collect(root, kwhSel),
      phpTokens: collect(root, phpSel),
      tariffTokens: collect(root, tariffSel),
      caveatTokens: collect(root, caveatSel),
      wolTokens: collect(root, wolSel),
      wolStatusTokens: collect(root, wolStatusSel),
      wolWarnTokens: collect(root, wolWarnSel),
      wolWakeTokens: collect(root, wolWakeSel),
      wolUpTokens: collect(root, wolUpSel),
    };
  }, SCRAPE_SELECTORS);

  return {
    machine,
    ...scraped,
    payload: session.payloads[machine] ?? null,
    status: session.statuses[machine] ?? null,
    responses: session.bodies.slice(before),
  };
}

type Overview = { present: boolean; text: string; telemetry: string };

async function readOverview(session: Session, base: string): Promise<Overview> {
  await session.page.goto(`${base}/index.html#/xmachines`, { waitUntil: 'domcontentloaded' });
  await session.page.waitForSelector(OVERVIEW_SEL, { timeout: 20_000 }).catch(() => {});
  await session.page.waitForTimeout(600);
  const scraped = await session.page.evaluate((sel) => {
    const root = document.querySelector(sel as string);
    return {
      present: !!root,
      text: root ? (root.textContent || '').replace(/\s+/g, ' ').trim() : '',
    };
  }, OVERVIEW_SEL);
  const telemetry = session.bodies.filter((body) => body.includes('/api/xmachines/telemetry')).join(' ');
  return { ...scraped, telemetry };
}

function blobOf(tokens: readonly string[]): string {
  return tokens.join(' ');
}

function numbersIn(tokens: readonly string[]): number[] {
  const out: number[] = [];
  for (const token of tokens) {
    for (const match of token.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Number(match[0]));
  }
  return out;
}

function hasNumber(tokens: readonly string[], want: number, tolerance = 1e-9): boolean {
  return numbersIn(tokens).some((value) => Math.abs(value - want) <= tolerance);
}

function describeTokens(label: string, tokens: readonly string[], selector: string): string {
  return tokens.length === 0
    ? `no ${label} surface rendered at all (tried ${selector})`
    : `the ${label} surface read ${JSON.stringify(blobOf(tokens).slice(0, 260))}`;
}

// The storage surface, or the disk/fs rows if the implementation renders them:
// whichever exists, the value must be INSIDE it.
function storageScope(detail: Detail): string[] {
  return [...detail.storageTokens, ...detail.diskRows.flatMap((row) => [row.text, ...row.attrs]), ...detail.fsRows.flatMap((row) => [row.text, ...row.attrs])];
}

function requireStorageSurface(detail: Detail): string[] {
  const scope = storageScope(detail);
  assert(
    scope.length > 0,
    `${detail.machine}'s detail renders no storage surface at all (tried ${STORAGE_SEL} / ${DISK_ROW_SEL} / ${FS_ROW_SEL}); ` +
    `D10 has not landed. The detail read ${JSON.stringify(detail.text.slice(0, 240))}`,
  );
  return scope;
}

function requireUpsSurface(detail: Detail): string[] {
  assert(
    detail.upsTokens.length > 0,
    `${detail.machine}'s detail renders no UPS surface at all (tried ${UPS_SEL}); D10 has not landed. ` +
    `The detail read ${JSON.stringify(detail.text.slice(0, 240))}`,
  );
  return detail.upsTokens;
}

// The scope for ONE device: its own row when rows exist, else the whole
// storage surface (recorded as the laxer path, still inside the panel).
function deviceScope(detail: Detail, needle: string, rows: Row[]): string[] {
  const own = rows.filter((row) => `${row.text} ${row.attrs.join(' ')}`.includes(needle));
  if (own.length > 0) return own.flatMap((row) => [row.text, ...row.attrs]);
  return storageScope(detail);
}

// I2c (ambiguity 3): the byte string, a digit-grouped byte string, or a
// TB/TiB/GB/GiB rendering of the same number.
function sizeCandidates(bytesText: string): string[] {
  const bytes = Number(bytesText);
  const out = new Set<string>([bytesText]);
  out.add(bytes.toLocaleString('en-US'));
  out.add(bytesText.replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
  const units: Array<[string, number]> = [['TB', 1e12], ['TiB', 2 ** 40], ['GB', 1e9], ['GiB', 2 ** 30]];
  for (const [, divisor] of units) {
    const scaled = bytes / divisor;
    for (const digits of [0, 1, 2]) out.add(scaled.toFixed(digits));
    out.add(String(Math.floor(scaled)));
    out.add(String(Math.ceil(scaled)));
  }
  return [...out].filter((candidate) => candidate.length > 0);
}

function rendersSize(tokens: readonly string[], bytesText: string): boolean {
  const blob = blobOf(tokens).replace(/,/g, ',');
  return sizeCandidates(bytesText).some((candidate) => blob.includes(candidate));
}

// ---------------------------------------------------------------------------
// Evidence: the fake fleet, the two scratch servers, one machine's detail read
// three ways and the fleet overview. Everything that can go wrong is RECORDED,
// never thrown at module scope — a collect error would be red for the wrong
// reason and would name no unit.
// ---------------------------------------------------------------------------
type Evidence = {
  scratch: Scratch | null;
  vault: Detail | null;
  dim: Detail | null;
  husk: Detail | null;
  overview: Overview | null;
  configuredVault: Detail | null;
  problems: string[];
};

let evidencePromise: Promise<Evidence> | null = null;
const closers: Array<() => Promise<void>> = [];

function evidence(browser: import('@playwright/test').Browser): Promise<Evidence> {
  if (!evidencePromise) evidencePromise = collect(browser);
  return evidencePromise;
}

async function collect(browser: import('@playwright/test').Browser): Promise<Evidence> {
  const problems: string[] = [];
  const result: Evidence = {
    scratch: null, vault: null, dim: null, husk: null,
    overview: null, configuredVault: null, problems,
  };

  // Server one: no tariff row, so the tariff is the placeholder default.
  try {
    const scratch = newScratch(null);
    result.scratch = scratch;
    const server = await startServer(scratch);
    const proxy = await startProxy(server.port);
    closers.push(async () => { await proxy.close(); server.child.kill('SIGTERM'); });
    const session = await openSession(browser);
    closers.push(() => session.context.close());
    result.vault = await readDetail(session, scratch, proxy.base, VAULT);
    result.dim = await readDetail(session, scratch, proxy.base, DIM);
    result.husk = await readDetail(session, scratch, proxy.base, HUSK);
    result.overview = await readOverview(session, proxy.base);
  } catch (error) {
    problems.push(`placeholder-tariff evidence failed: ${(error as Error)?.message ?? String(error)}`);
  }

  // Server two: the SAME fixtures and samples with a configured tariff row.
  try {
    const scratch = newScratch(CONFIGURED_TARIFF);
    const server = await startServer(scratch);
    const proxy = await startProxy(server.port);
    closers.push(async () => { await proxy.close(); server.child.kill('SIGTERM'); });
    const session = await openSession(browser);
    closers.push(() => session.context.close());
    result.configuredVault = await readDetail(session, scratch, proxy.base, VAULT);
  } catch (error) {
    problems.push(`configured-tariff evidence failed: ${(error as Error)?.message ?? String(error)}`);
  }

  return result;
}

function need(detail: Detail | null, machine: string, problems: readonly string[]): Detail {
  assert(detail !== null, `${machine}'s detail was never read: ${problems.join('; ') || 'unknown'}`);
  const value = detail as Detail;
  assert(
    value.present,
    `${machine}'s machine detail never rendered (status=${String(value.status)}); body read ${JSON.stringify(value.bodyText.slice(0, 220))}`,
  );
  return value;
}

// ---------------------------------------------------------------------------
// D10 — the hdd SMART, disk-temperature and free-space panel plus the NUT
// battery, runtime, load and unavailable states, on one fake machine's detail.
// Owns: I2a I2b I2c I3a I3b I3c I3d L9a
// ---------------------------------------------------------------------------
test('test_d10_machine_detail_renders_hdd_smart_health_disk_temperature_free_space_and_ups_battery_runtime_load_or_unavailable', async ({ browser }) => {
  test.setTimeout(150_000);
  const ev = await evidence(browser);
  const results: boolean[] = [];

  // I2a — every scanned disk's SMART health is on the panel, as the fixture's
  // own verdict, per device. The device with no health line must read
  // "unavailable"; a panel that calls it PASSED is fabricating.
  results.push(await guardedCheck('I2a', COVERED.I2a, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    requireStorageSurface(detail);
    for (const disk of VAULT_DISKS) {
      const scope = deviceScope(detail, disk.device, detail.diskRows);
      const blob = blobOf(scope);
      assert(
        blob.includes(disk.device),
        `the storage panel never names the disk ${disk.device} — ${describeTokens('storage', scope, STORAGE_SEL)}`,
      );
      assert(
        blob.toLowerCase().includes(disk.health.toLowerCase()),
        `${disk.device} reports SMART health ${JSON.stringify(disk.health)} but the panel renders no such health — ${describeTokens('storage', scope, STORAGE_SEL)}`,
      );
    }
    // The device with no health line is the fabrication control: its own scope
    // must say unavailable and must not claim the verdict its neighbours got.
    const sdc = deviceScope(detail, '/dev/sdc', detail.diskRows);
    assert(
      blobOf(sdc).toLowerCase().includes('unavailable'),
      `/dev/sdc reports no SMART health at all, but the panel does not call it unavailable — ${describeTokens('storage', sdc, STORAGE_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I2b — the per-disk temperature row carries smartctl's RAW value, per
  // device, and says unavailable where there is no reading. The normalized
  // column (118) must never pass as a temperature.
  results.push(await guardedCheck('I2b', COVERED.I2b, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    requireStorageSurface(detail);
    for (const disk of VAULT_DISKS) {
      const scope = deviceScope(detail, disk.device, detail.diskRows);
      if (disk.rawTemp === null) {
        assert(
          blobOf(scope).toLowerCase().includes('unavailable'),
          `${disk.device} has no temperature attribute, so its temperature must read unavailable — ${describeTokens('disk temperature', scope, DISK_ROW_SEL)}`,
        );
        continue;
      }
      assert(
        hasNumber(scope, disk.rawTemp),
        `${disk.device} reports RAW temperature ${disk.rawTemp} but the panel renders no such temperature — ${describeTokens('disk temperature', scope, DISK_ROW_SEL)}`,
      );
      assert(
        !hasNumber(scope, 118),
        `${disk.device}'s temperature surface renders 118, which is smartctl's NORMALIZED value, not the RAW temperature — ${describeTokens('disk temperature', scope, DISK_ROW_SEL)}`,
      );
    }
  }, 'ui-screenshot'));

  // I2c — filesystem free space from df is on the panel, per mount, as that
  // mount's own number (ambiguity 3).
  results.push(await guardedCheck('I2c', COVERED.I2c, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    requireStorageSurface(detail);
    for (const fsRow of VAULT_FILESYSTEMS) {
      const scope = deviceScope(detail, fsRow.mount, detail.fsRows);
      assert(
        blobOf(scope).includes(fsRow.mount),
        `the storage panel never names the mount ${fsRow.mount} — ${describeTokens('filesystem', scope, FS_ROW_SEL)}`,
      );
      assert(
        rendersSize(scope, fsRow.available),
        `${fsRow.mount} has ${fsRow.available} bytes available but the panel renders no form of that number ` +
        `(accepted: ${JSON.stringify(sizeCandidates(fsRow.available).slice(0, 8))}) — ${describeTokens('filesystem', scope, FS_ROW_SEL)}`,
      );
    }
    // Free space is the point: the two mounts differ, so a panel that renders
    // one number for both has not read df per filesystem.
    const blob = blobOf(storageScope(detail));
    assert(
      VAULT_FILESYSTEMS.every((fsRow) => sizeCandidates(fsRow.available).some((candidate) => blob.includes(candidate))),
      `the panel does not render both mounts' free space distinctly: ${blob.slice(0, 260)}`,
    );
  }, 'ui-screenshot'));

  // I3a — the UPS battery charge NUT reported is on the detail.
  results.push(await guardedCheck('I3a', COVERED.I3a, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    const scope = requireUpsSurface(detail);
    assert(
      hasNumber(scope, VAULT_BATTERY_PCT),
      `NUT reports battery.charge ${VAULT_BATTERY_PCT} but the UPS panel renders no such charge — ${describeTokens('UPS', scope, UPS_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I3b — the UPS runtime NUT reported is on the detail, in seconds or
  // minutes (ambiguity 4) and in no other number.
  results.push(await guardedCheck('I3b', COVERED.I3b, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    const scope = requireUpsSurface(detail);
    const minutes = VAULT_RUNTIME_SECONDS / 60;
    assert(
      hasNumber(scope, VAULT_RUNTIME_SECONDS) || hasNumber(scope, minutes, 0.01),
      `NUT reports battery.runtime ${VAULT_RUNTIME_SECONDS}s (${minutes} min) but the UPS panel renders neither — ${describeTokens('UPS', scope, UPS_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I3c — the UPS load NUT reported is on the detail.
  results.push(await guardedCheck('I3c', COVERED.I3c, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    const scope = requireUpsSurface(detail);
    assert(
      hasNumber(scope, VAULT_UPS_LOAD_PCT),
      `NUT reports ups.load ${VAULT_UPS_LOAD_PCT} but the UPS panel renders no such load — ${describeTokens('UPS', scope, UPS_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I3d — a machine with no UPS source renders an explicit unavailable state
  // and NO battery, runtime or load numbers. Silence is not the contract, and
  // a zero is a fabrication.
  results.push(await guardedCheck('I3d', COVERED.I3d, async () => {
    const withUps = need(ev.vault, VAULT, ev.problems);
    requireUpsSurface(withUps); // the surface must exist before "unavailable" means anything
    const detail = need(ev.dim, DIM, ev.problems);
    const scope = requireUpsSurface(detail);
    const blob = blobOf(scope).toLowerCase();
    assert(
      /unavailable|no ups|not available|none/.test(blob),
      `${DIM} has no UPS source, but its UPS surface states no unavailable condition — ${describeTokens('UPS', scope, UPS_SEL)}`,
    );
    for (const fabricated of [VAULT_BATTERY_PCT, VAULT_RUNTIME_SECONDS, VAULT_UPS_LOAD_PCT]) {
      assert(
        !hasNumber(scope, fabricated),
        `${DIM} has no UPS source, but its UPS surface renders ${fabricated} — that is ${VAULT}'s reading, not ${DIM}'s — ${describeTokens('UPS', scope, UPS_SEL)}`,
      );
    }
  }, 'ui-screenshot'));

  // L9a — fake-fleet fence class: every rendered storage and UPS value traces
  // to THIS journey's fixture for the NAMED machine, the runtime the page
  // talked to is the non-actuating fake one, and reading a detail contacted no
  // gateway and woke nothing. An "the mock was spawned with `down`" assertion
  // would be a specified FAIL, so none is made.
  results.push(await guardedCheck('L9a', COVERED.L9a, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    assert(
      detail.payload !== null,
      `the page received no /api/xmachines/machines/${VAULT} payload, so no rendered value can be traced to the fake fleet`,
    );
    const payload = detail.payload as Record<string, unknown>;
    assert(
      payload.armed !== true && payload.mode !== 'armed',
      `the read route reported an ARMED runtime (mode=${String(payload.mode)}); a fake-fleet fence must run against the non-actuating gateway`,
    );
    const machine = (payload.machine ?? {}) as Record<string, unknown>;
    assert(
      String(machine.name) === VAULT,
      `the detail payload is for ${JSON.stringify(machine.name)}, not the selected machine ${VAULT}`,
    );
    // The storage / UPS literals must have reached the page over the wire for
    // this machine: whichever endpoint D10 serves them from, they are in what
    // the browser was sent, and they are this fixture's values.
    const wire = detail.responses.join(' ');
    const wireProblems = [
      ...VAULT_DISKS.filter((disk) => disk.rawTemp !== null && !wire.includes(String(disk.rawTemp))).map((disk) => `disk ${disk.device} temperature ${disk.rawTemp}`),
      ...VAULT_FILESYSTEMS.filter((fsRow) => !wire.includes(fsRow.available)).map((fsRow) => `${fsRow.mount} available ${fsRow.available}`),
      ...(wire.includes(String(VAULT_BATTERY_PCT)) ? [] : [`ups battery ${VAULT_BATTERY_PCT}`]),
    ];
    assert(
      wireProblems.length === 0,
      `the page was never sent the fake fleet's own storage/UPS values for ${VAULT} (missing ${JSON.stringify(wireProblems)}), ` +
      `so the panel cannot be traced to the fixture: ${wire.slice(0, 300)}`,
    );
    const scope = requireStorageSurface(detail);
    assert(
      blobOf(scope).includes(VAULT_FILESYSTEMS[0].mount),
      `the rendered storage panel carries none of its own payload's mounts — ${describeTokens('storage', scope, STORAGE_SEL)}`,
    );
    const spy = ev.scratch ? forbiddenGatewayCalls(ev.scratch.log) : [];
    assert(
      spy.length === 0,
      `reading one machine's auxiliary detail made ${spy.length} gateway/wake call(s): ${JSON.stringify(spy.slice(0, 3))} — a fake-fleet read must contact nothing`,
    );
    assert(
      ev.scratch !== null && argvRows(ev.scratch.log).some((row) => row.includes(SELFTEST_MARKER)),
      'the PATH spy self-test never recorded, so "no gateway calls" would be an artefact of a spy that was never on PATH',
    );
  }, 'cli-to-ui-compare'));

  finish(`${FENCE_ID}/D10`, results, 8);
});

// ---------------------------------------------------------------------------
// D11 — detail-only PHP energy cost with the placeholder-tariff and
// short-burst caveats, plus the verified / stale / never-verified WoL-safe
// indicators.
// Owns: I4a I4b I4c I4d I4e I5a I5b I5d
// ---------------------------------------------------------------------------
test('test_d11_machine_detail_renders_php_cost_placeholder_tariff_and_burst_caveats_plus_verified_stale_and_never_verified_wol_evidence', async ({ browser }) => {
  test.setTimeout(150_000);
  const ev = await evidence(browser);
  const results: boolean[] = [];

  // I4a — the displayed cost IS the persisted sample feed for THIS machine:
  // the rendered kWh equals the integration of the rows this journey
  // persisted, the NULL-watt sample is skipped, and the other machine's
  // 9000 W never bleeds in.
  results.push(await guardedCheck('I4a', COVERED.I4a, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    assert(
      detail.kwhTokens.length > 0,
      `${VAULT}'s detail renders no kWh surface (tried ${COST_KWH_SEL}); the detail read ${JSON.stringify(detail.text.slice(0, 240))}`,
    );
    assert(
      hasNumber(detail.kwhTokens, VAULT_KWH, 1e-6),
      `${VAULT}'s persisted samples integrate to ${VAULT_KWH} kWh but the detail renders no such value — ${describeTokens('kWh', detail.kwhTokens, COST_KWH_SEL)}`,
    );
    const naive = expectedKwh([...VAULT_WATTS, ...DIM_WATTS]);
    assert(
      !hasNumber(detail.kwhTokens, naive, 1e-6),
      `${VAULT}'s kWh includes ${DIM}'s samples (${naive} kWh); the detail cost must be one machine's own feed`,
    );
    const payload = detail.payload as Record<string, unknown> | null;
    const cost = (payload?.cost ?? null) as Record<string, unknown> | null;
    assert(cost !== null, `the ${VAULT} payload carries no cost object, so the render cannot be traced to the persisted feed`);
    assert(
      typeof cost.kwh === 'number' && Math.abs((cost.kwh as number) - VAULT_KWH) <= 1e-9,
      `the payload's kWh is ${JSON.stringify(cost.kwh)}, not the ${VAULT_KWH} its persisted samples integrate to`,
    );
    assert(
      hasNumber(detail.kwhTokens, cost.kwh as number, 1e-9),
      `the detail renders a kWh that is not its own payload's ${String(cost.kwh)} — ${describeTokens('kWh', detail.kwhTokens, COST_KWH_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I4b — a configured tariff changes the PHP amount: the same kWh over the
  // same samples renders the configured product, not the placeholder one.
  results.push(await guardedCheck('I4b', COVERED.I4b, async () => {
    const placeholder = need(ev.vault, VAULT, ev.problems);
    const configured = need(ev.configuredVault, `${VAULT} (configured tariff)`, ev.problems);
    assert(
      placeholder.phpTokens.length > 0 && configured.phpTokens.length > 0,
      `a PHP cost surface is missing (tried ${COST_PHP_SEL}); placeholder=${JSON.stringify(blobOf(placeholder.phpTokens).slice(0, 120))} configured=${JSON.stringify(blobOf(configured.phpTokens).slice(0, 120))}`,
    );
    assert(
      hasNumber(placeholder.phpTokens, VAULT_PHP_PLACEHOLDER, 1e-6),
      `at the placeholder tariff the cost is PHP ${VAULT_PHP_PLACEHOLDER} but the detail renders — ${describeTokens('PHP cost', placeholder.phpTokens, COST_PHP_SEL)}`,
    );
    assert(
      hasNumber(configured.phpTokens, VAULT_PHP_CONFIGURED, 1e-6),
      `at the configured tariff ${CONFIGURED_TARIFF} the cost is PHP ${VAULT_PHP_CONFIGURED} but the detail renders — ${describeTokens('PHP cost', configured.phpTokens, COST_PHP_SEL)}`,
    );
    assert(
      Math.abs(VAULT_PHP_CONFIGURED - VAULT_PHP_PLACEHOLDER) > 1e-6
      && !hasNumber(configured.phpTokens, VAULT_PHP_PLACEHOLDER, 1e-6),
      `the configured-tariff detail still renders the placeholder amount PHP ${VAULT_PHP_PLACEHOLDER}; the tariff had no effect`,
    );
    const currency = `${blobOf(configured.phpTokens)} ${blobOf(configured.tariffTokens)}`;
    assert(
      /php|₱/i.test(currency),
      `the cost surface names no currency, so PHP cannot be read off it: ${currency.slice(0, 200)}`,
    );
  }, 'ui-screenshot'));

  // I4c — the placeholder tariff is flagged AS a placeholder, and a configured
  // tariff clears that flag. An unflagged placeholder is a number the owner
  // would trust.
  results.push(await guardedCheck('I4c', COVERED.I4c, async () => {
    const placeholder = need(ev.vault, VAULT, ev.problems);
    const configured = need(ev.configuredVault, `${VAULT} (configured tariff)`, ev.problems);
    assert(
      placeholder.tariffTokens.length > 0,
      `${VAULT}'s detail renders no tariff flag (tried ${TARIFF_SEL}); the detail read ${JSON.stringify(placeholder.text.slice(0, 240))}`,
    );
    assert(
      /placeholder/i.test(blobOf(placeholder.tariffTokens)),
      `the tariff is the placeholder default but the flag does not say so — ${describeTokens('tariff flag', placeholder.tariffTokens, TARIFF_SEL)}`,
    );
    assert(
      configured.tariffTokens.length > 0,
      `the configured-tariff detail renders no tariff flag (tried ${TARIFF_SEL})`,
    );
    assert(
      !/placeholder/i.test(blobOf(configured.tariffTokens)),
      `a configured tariff (${CONFIGURED_TARIFF}) is still flagged placeholder — ${describeTokens('tariff flag', configured.tariffTokens, TARIFF_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I4d — the short-burst caveat is on the detail, in the words the cost
  // module defines, so a 30-minute sampling gap is disclosed where the number
  // is read.
  results.push(await guardedCheck('I4d', COVERED.I4d, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    assert(
      detail.caveatTokens.length > 0,
      `${VAULT}'s detail renders no cost caveat (tried ${CAVEAT_SEL}); the detail read ${JSON.stringify(detail.text.slice(0, 240))}`,
    );
    assert(
      blobOf(detail.caveatTokens).includes(BURSTS_CAVEAT),
      `the detail does not disclose the short-burst caveat ${JSON.stringify(BURSTS_CAVEAT)} — ${describeTokens('caveat', detail.caveatTokens, CAVEAT_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I4e — cost is DETAIL-ONLY: the fleet overview renders no PHP amount, no
  // kWh, no tariff flag and no caveat, and the overview payload carries no
  // cost fields at all.
  results.push(await guardedCheck('I4e', COVERED.I4e, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    assert(detail.phpTokens.length > 0, 'the detail itself shows no cost, so "detail-only" cannot be judged');
    const overview = ev.overview;
    assert(overview !== null && overview.present, `the fleet overview never rendered: ${ev.problems.join('; ') || 'unknown'}`);
    const text = (overview as Overview).text;
    for (const forbidden of [/\bPHP\b/, /₱/, /kWh/i, /placeholder tariff/i, /configured tariff/i]) {
      assert(
        !forbidden.test(text),
        `the fleet overview renders ${String(forbidden)}, but cost is detail-only: ${text.slice(0, 260)}`,
      );
    }
    assert(
      !text.includes(BURSTS_CAVEAT),
      `the fleet overview renders the short-burst caveat, which belongs to the detail: ${text.slice(0, 260)}`,
    );
    const telemetry = (overview as Overview).telemetry;
    assert(telemetry.length > 0, 'the overview never fetched /api/xmachines/telemetry, so its payload cannot be inspected');
    for (const key of ['costPhp', '"cost"', 'tariffPhpPerKwh', '"kwh"']) {
      assert(
        !telemetry.includes(key),
        `the fleet overview payload carries the cost field ${key}, which the detail alone may serve: ${telemetry.slice(0, 260)}`,
      );
    }
  }, 'ui-screenshot'));

  // I5a — a machine whose WAKE was followed by a verified UP renders BOTH
  // timestamps and reads as verified, from the xmac log this fence authored.
  results.push(await guardedCheck('I5a', COVERED.I5a, async () => {
    const detail = need(ev.vault, VAULT, ev.problems);
    assert(
      detail.wolTokens.length > 0,
      `${VAULT}'s detail renders no WoL-safe surface (tried ${WOL_SEL}); the detail read ${JSON.stringify(detail.text.slice(0, 240))}`,
    );
    const status = blobOf(detail.wolStatusTokens.length > 0 ? detail.wolStatusTokens : detail.wolTokens).toLowerCase();
    assert(
      /verified/.test(status) && !/never|stale/.test(status),
      `${VAULT}'s WAKE ${VAULT_WAKE} was followed by UP ${VAULT_UP}, so it is WoL-verified, but the indicator reads ${JSON.stringify(status.slice(0, 160))}`,
    );
    const times = blobOf([...detail.wolWakeTokens, ...detail.wolUpTokens, ...detail.wolTokens]);
    assert(
      times.includes(VAULT_WAKE),
      `the WoL surface does not show the last WAKE ${VAULT_WAKE} — ${describeTokens('WoL', detail.wolTokens, WOL_SEL)}`,
    );
    assert(
      times.includes(VAULT_UP),
      `the WoL surface does not show the verified UP ${VAULT_UP} — ${describeTokens('WoL', detail.wolTokens, WOL_SEL)}`,
    );
  }, 'ui-screenshot'));

  // I5b — never-verified and stale are DISTINCT, correctly-named states: a
  // box that was never woken must not be shown as stale, and a WAKE with no
  // later UP must not be shown as verified (ambiguity 7).
  results.push(await guardedCheck('I5b', COVERED.I5b, async () => {
    const dim = need(ev.dim, DIM, ev.problems);
    const husk = need(ev.husk, HUSK, ev.problems);
    const dimStatus = blobOf(dim.wolStatusTokens.length > 0 ? dim.wolStatusTokens : dim.wolTokens).toLowerCase();
    const huskStatus = blobOf(husk.wolStatusTokens.length > 0 ? husk.wolStatusTokens : husk.wolTokens).toLowerCase();
    assert(
      dim.wolTokens.length > 0 && husk.wolTokens.length > 0,
      `a WoL-safe surface is missing (tried ${WOL_SEL}); ${DIM}=${JSON.stringify(dimStatus.slice(0, 120))} ${HUSK}=${JSON.stringify(huskStatus.slice(0, 120))}`,
    );
    assert(
      /never/.test(dimStatus),
      `${DIM} has no WAKE record at all, so it is never-verified, but the indicator reads ${JSON.stringify(dimStatus.slice(0, 160))}`,
    );
    assert(
      !/\bverified\b/.test(dimStatus.replace(/never[\s-]?verified/g, '')),
      `${DIM} is never-verified but the indicator also claims verified: ${dimStatus.slice(0, 160)}`,
    );
    assert(
      /stale/.test(huskStatus),
      `${HUSK}'s WAKE ${HUSK_WAKE} was never followed by an UP, so it is stale, but the indicator reads ${JSON.stringify(huskStatus.slice(0, 160))}`,
    );
    assert(
      !/never/.test(huskStatus),
      `${HUSK} was woken once but is shown as never-verified: ${huskStatus.slice(0, 160)}`,
    );
  }, 'ui-screenshot'));

  // I5d — both unverified states warn that the box may stay off, and the
  // verified box does NOT: a warning shown on a verified machine is noise the
  // owner learns to ignore.
  results.push(await guardedCheck('I5d', COVERED.I5d, async () => {
    const vault = need(ev.vault, VAULT, ev.problems);
    for (const [name, detail] of [[DIM, need(ev.dim, DIM, ev.problems)], [HUSK, need(ev.husk, HUSK, ev.problems)]] as Array<[string, Detail]>) {
      const warn = blobOf([...detail.wolWarnTokens, ...detail.wolTokens]);
      assert(
        warn.includes(WOL_UNVERIFIED_WARNING) || /may (remain|stay) off/i.test(warn),
        `${name} is not WoL-verified, but nothing warns that powering it off may leave it off — ${describeTokens('WoL warning', detail.wolTokens, WOL_WARN_SEL)}`,
      );
    }
    const verified = blobOf([...vault.wolWarnTokens, ...vault.wolTokens]);
    assert(
      !verified.includes(WOL_UNVERIFIED_WARNING) && !/may (remain|stay) off/i.test(verified),
      `${VAULT} is WoL-verified, but its detail still warns it may remain off: ${verified.slice(0, 200)}`,
    );
  }, 'ui-screenshot'));

  finish(`${FENCE_ID}/D11`, results, 8);
});

test.afterAll(async () => {
  for (const close of closers) {
    await close().catch(() => undefined);
  }
});
