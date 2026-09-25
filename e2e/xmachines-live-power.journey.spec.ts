import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from '@playwright/test';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E5 — RELEASE-ATOMIC live power cycle on `media` (.182).
//
// Contract row (plan.md E5): one approved live power cycle whose OFF argv is
// `xmac down <name> --owner-off` through A13 and never `down --force`; the
// armed runner spawns only for a PRE-EXISTING <run-dir>/Q-JROM-LIVE.grant whose
// machine-id equals the target, and FAILS if it creates that file; the cycle
// reaches stable DOWN with an app-attributed DOWN-OK, then cold-wakes to a
// repeatedly-verified UP.
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It is the definition of what would
// prove E5, not the implementation of it. It contains no product code and
// powers nothing itself: every live observation is read back off the evidence
// the G2 harness writes. Today it is red because that harness
// (e2e/run-xmachines-live-fence.mjs, slice G2) does not exist yet.
//
// One test per contributor, so a red run names WHO broke composition:
//   * G2            — the live release harness and the cycle it drives
//   * A13           — `xmac down <name> --owner-off` (the OFF argv itself)
//   * Q-JROM-LIVE   — JROM's grant; the gate that lets the armed run happen
// The unit named on a REJECT line is computed (see `blame`), not fixed to the
// test it sits in: when the harness is missing nothing downstream of it can be
// observed, so blaming A13 for a cycle that never ran would be a lie.
//
// ---------------------------------------------------------------------------
// The evidence contract this journey reads (live-power-report-v1)
//
// `node e2e/run-xmachines-live-fence.mjs --target media --grant <p> --report <f>`
// writes <f> as JSON:
//
// {
//   "schema": "live-power-report-v1",
//   "armed": false,                     // true only on the granted, --arm run
//   "target": "media",
//   "grant": {
//     "path": "...", "existed_before_run": true,
//     "created_by_harness": false,      // MUST be false, always
//     "machine_id": "media", "matches_target": true
//   },
//   "refusals": [                       // built BEFORE any argv exists
//     { "target": "gpu",  "ip": "192.168.254.174", "refused": true, "argv_built": false },
//     { "target": "gpu2", "ip": "192.168.254.179", "refused": true, "argv_built": false }
//   ],
//   "unarmed_refusal": { "refused": true, "spawned": 0, "reason": "unarmed" },
//   "off": {
//     "argv": ["down", "media", "--owner-off"],
//     "caller_identity": "app",         // XMAC_CALLER as seen in xmac.log
//     "gateway_outcome": "DOWN-OK",
//     "guard3_refusals": [ { "reason": "...", "argv": ["down","media","--owner-off"] } ],
//     "ping_loss": { "samples": 5, "consecutive_loss": 3, "stable": true },
//     "verified_down": true
//   },
//   "on": {
//     "cold_wake": true,
//     "reachability": [ { "method": "ping",  "up": true, "at": "..." },
//                       { "method": "ssh",   "up": true, "at": "..." } ],
//     "verified_up": true
//   },
//   "gateway_spy": { "argv_log": [["down","media","--owner-off"]], "force_count": 0 }
// }
//
// The unarmed preflight run fills everything except `off`/`on`; those two
// appear only on the granted armed run.
// ---------------------------------------------------------------------------

const REPO_ROOT = findRepoRoot(process.cwd());
const RUN_DIR = path.join(REPO_ROOT, 'xmachines/projcore-run-2026-09-25');
const GRANT_PATH = path.join(RUN_DIR, 'Q-JROM-LIVE.grant');
const LIVE_HARNESS = path.join(REPO_ROOT, 'e2e/run-xmachines-live-fence.mjs');
const FENCE_CONTRACT = path.join(RUN_DIR, 'fence-contract.json');
const TARGET = 'media';
const PROTECTED_IPS = ['192.168.254.174', '192.168.254.179'];

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'e2e/run-xmachines-fence.mjs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

interface Evidence {
  harnessPresent: boolean;
  grantUsable: boolean;
  grantExistedBefore: boolean;
  grantCreatedByHarness: boolean;
  grantMachineId: string | null;
  preflight: any | null;
  cycle: any | null;
  problems: string[];
}

let evidencePromise: Promise<Evidence> | null = null;

// Read (never write) the grant. JSON or `machine-id: media` both parse.
function readGrantMachineId(): string | null {
  if (!fs.existsSync(GRANT_PATH)) return null;
  const raw = fs.readFileSync(GRANT_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    const id = parsed['machine-id'] ?? parsed.machine_id ?? parsed.machineId ?? parsed.target;
    if (typeof id === 'string') return id.trim();
  } catch {
    /* not JSON — fall through to the line form */
  }
  const match = raw.match(/machine[-_ ]?id\s*[:=]\s*(\S+)/i);
  return match ? match[1].trim() : null;
}

function runHarness(args: string[], reportPath: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [LIVE_HARNESS, ...args, '--report', reportPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 150_000,
    env: { ...process.env },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readReport(reportPath: string): any | null {
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

// Runs the real harness once per file and caches what it produced. Everything
// that can go wrong here is recorded, never thrown: a throw at module scope
// would be a collect error, which is red for the wrong reason.
function evidence(): Promise<Evidence> {
  if (!evidencePromise) evidencePromise = collectEvidence();
  return evidencePromise;
}

async function collectEvidence(): Promise<Evidence> {
  const problems: string[] = [];
  const grantExistedBefore = fs.existsSync(GRANT_PATH);
  const grantMachineId = readGrantMachineId();
  const grantUsable = grantExistedBefore && grantMachineId === TARGET;

  if (!fs.existsSync(LIVE_HARNESS)) {
    problems.push(`live release harness ${path.relative(REPO_ROOT, LIVE_HARNESS)} does not exist (slice G2 has not landed)`);
    return {
      harnessPresent: false,
      grantUsable,
      grantExistedBefore,
      grantCreatedByHarness: false,
      grantMachineId,
      preflight: null,
      cycle: null,
      problems,
    };
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'e5-live-'));

  // Preflight is ALWAYS unarmed: grant custody, protected-IP refusal and the
  // unarmed refusal must be provable without touching a machine.
  const preflightRun = runHarness(
    ['--preflight-only', '--require-unarmed-refusal', '--grant', GRANT_PATH, '--target', TARGET],
    path.join(scratch, 'preflight.json')
  );
  const preflight = readReport(path.join(scratch, 'preflight.json'));
  if (!preflight) {
    problems.push(`preflight run wrote no live-power-report-v1 (exit=${preflightRun.status}) stderr=${preflightRun.stderr.slice(0, 200)}`);
  }

  // The armed cycle runs ONLY for a pre-existing grant whose machine-id is the
  // target. No grant, no live power — this journey never creates one.
  let cycle: any | null = null;
  if (grantUsable) {
    const cycleRun = runHarness(['--arm', '--grant', GRANT_PATH, '--target', TARGET], path.join(scratch, 'cycle.json'));
    cycle = readReport(path.join(scratch, 'cycle.json'));
    if (!cycle) {
      problems.push(`armed cycle wrote no live-power-report-v1 (exit=${cycleRun.status}) stderr=${cycleRun.stderr.slice(0, 200)}`);
    }
  } else if (!grantExistedBefore) {
    problems.push('Q-JROM-LIVE.grant does not exist — JROM has not granted the live cycle, so no live evidence can exist');
  } else {
    problems.push(`Q-JROM-LIVE.grant machine-id=${String(grantMachineId)} does not equal target=${TARGET}`);
  }

  const grantCreatedByHarness = !grantExistedBefore && fs.existsSync(GRANT_PATH);
  if (grantCreatedByHarness) {
    problems.push('the harness CREATED Q-JROM-LIVE.grant — it may only ever read it');
  }

  return {
    harnessPresent: true,
    grantUsable,
    grantExistedBefore,
    grantCreatedByHarness,
    grantMachineId,
    preflight,
    cycle,
    problems,
  };
}

// The contributor actually responsible for an unobservable check. Attribution
// walks the dependency order: no harness -> G2; harness but no approved grant
// -> Q-JROM-LIVE; evidence in hand -> the id's real owner.
function blame(ev: Evidence, owner: string, needsCycle = true): string {
  if (!ev.harnessPresent) return 'G2';
  if (needsCycle && !ev.cycle) return ev.grantUsable ? 'G2' : 'Q-JROM-LIVE';
  return owner;
}

function requireCycle(ev: Evidence): any {
  if (!ev.harnessPresent || !ev.cycle) {
    throw new Error(`no live cycle evidence: ${ev.problems.join('; ') || 'unknown'}`);
  }
  return ev.cycle;
}

function requirePreflight(ev: Evidence): any {
  if (!ev.harnessPresent || !ev.preflight) {
    throw new Error(`no preflight evidence: ${ev.problems.join('; ') || 'unknown'}`);
  }
  return ev.preflight;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function finish(fenceTest: string, results: boolean[], expected: number): void {
  assert(results.length === expected, `${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// ---------------------------------------------------------------------------
// G2 — the live release harness and the cycle it drives.
// Owns: D1b, L8i, L8j, L9g, L9i, L9j, L10b
// ---------------------------------------------------------------------------
test('test_G2_live_cycle_reaches_stable_down_then_cold_wakes_to_verified_up', async () => {
  const ev = await evidence();
  const results: boolean[] = [];

  // L9j — exactly one release-atomic live power fence exists. Observable
  // today: an armed fence is one whose integration_cmd carries --arm.
  results.push(await guardedCheck('L9j', 'G2', async () => {
    const contract = JSON.parse(fs.readFileSync(FENCE_CONTRACT, 'utf8'));
    const armed = Object.entries(contract.fences || {})
      .filter(([, row]: [string, any]) => /(^|\s)--arm(\s|$)/.test(String(row.integration_cmd || '')))
      .map(([id]) => id);
    assert(
      armed.length === 1 && armed[0] === 'E5',
      `expected exactly one armed live power fence (E5), found ${JSON.stringify(armed)}`
    );
  }, 'mutation-report'));

  // L10b — real control is impossible without explicit server-side arm state:
  // the unarmed harness refuses and spawns nothing at all.
  results.push(await guardedCheck('L10b', blame(ev, 'G2', false), async () => {
    const pre = requirePreflight(ev);
    assert(pre.armed === false, `preflight reported armed=${pre.armed}; an unarmed run must never arm itself`);
    assert(pre.unarmed_refusal?.refused === true, `expected an unarmed refusal, got ${JSON.stringify(pre.unarmed_refusal)}`);
    assert(pre.unarmed_refusal?.spawned === 0, `unarmed refusal spawned ${pre.unarmed_refusal?.spawned} processes; it must spawn none`);
    assert(
      (pre.gateway_spy?.argv_log || []).length === 0,
      `unarmed run built gateway argv ${JSON.stringify(pre.gateway_spy?.argv_log)}; real control must be unreachable without arm`
    );
  }, 'gateway-spy'));

  // L9g — the live OFF proof observes stable ping loss.
  results.push(await guardedCheck('L9g', blame(ev, 'G2'), async () => {
    const off = requireCycle(ev).off || {};
    const loss = off.ping_loss || {};
    assert(loss.stable === true, `expected stable ping loss, got ${JSON.stringify(loss)}`);
    assert(Number(loss.consecutive_loss) >= 2, `expected >=2 consecutive lost probes, got ${JSON.stringify(loss)}`);
    assert(off.verified_down === true, `expected verified_down after the OFF, got ${JSON.stringify(off.verified_down)}`);
  }, 'live-oracle'));

  // L8i — success requires a successful gateway outcome.
  results.push(await guardedCheck('L8i', blame(ev, 'G2'), async () => {
    const cycle = requireCycle(ev);
    const outcome = cycle.off?.gateway_outcome;
    assert(outcome === 'DOWN-OK', `expected gateway outcome DOWN-OK, got ${JSON.stringify(outcome)}`);
    assert(
      cycle.off?.verified_down === true,
      'the OFF was reported successful without a verified-down observation; a gateway exit code alone is not success'
    );
  }, 'live-oracle'));

  // L8j — success requires repeated independent reachability observations.
  results.push(await guardedCheck('L8j', blame(ev, 'G2'), async () => {
    const observations = requireCycle(ev).on?.reachability || [];
    assert(observations.length >= 2, `expected >=2 reachability observations, got ${observations.length}`);
    const methods = new Set(observations.map((o: any) => o.method));
    assert(methods.size >= 2, `expected independent probe methods, got ${JSON.stringify([...methods])}`);
    assert(observations.every((o: any) => o.up === true), `expected every observation to see the host up, got ${JSON.stringify(observations)}`);
  }, 'live-oracle'));

  // L9i — the live proof ends with a successful cold wake.
  results.push(await guardedCheck('L9i', blame(ev, 'G2'), async () => {
    const on = requireCycle(ev).on || {};
    assert(on.cold_wake === true, `expected the ON to be a cold wake from a stable DOWN, got ${JSON.stringify(on.cold_wake)}`);
    assert(on.verified_up === true, `expected verified_up after the cold wake, got ${JSON.stringify(on.verified_up)}`);
  }, 'live-oracle'));

  // D1b — a designated DOWN machine reaches verified UP after the approved ON.
  results.push(await guardedCheck('D1b', blame(ev, 'G2'), async () => {
    const cycle = requireCycle(ev);
    assert(cycle.target === TARGET, `expected target ${TARGET}, got ${JSON.stringify(cycle.target)}`);
    assert(cycle.off?.verified_down === true, 'the machine was never verified DOWN, so the ON did not start from DOWN');
    assert(cycle.on?.verified_up === true, `expected verified UP after the live ON, got ${JSON.stringify(cycle.on?.verified_up)}`);
  }, 'live-oracle'));

  finish('E5/G2', results, 7);
});

// ---------------------------------------------------------------------------
// A13 — `xmac down <name> --owner-off`: the OFF argv itself.
// Owns: D2a, L2a, L2d, L9h
// ---------------------------------------------------------------------------
test('test_A13_live_off_argv_is_owner_off_with_zero_force', async () => {
  const ev = await evidence();
  const results: boolean[] = [];

  // L2a — normal owner Off bypasses guard 3 without using blanket force.
  results.push(await guardedCheck('L2a', blame(ev, 'A13'), async () => {
    const argv: string[] = requireCycle(ev).off?.argv || [];
    assert(argv[0] === 'down', `expected the OFF argv to start with down, got ${JSON.stringify(argv)}`);
    assert(argv.includes('--owner-off'), `expected --owner-off in the OFF argv, got ${JSON.stringify(argv)}`);
    assert(!argv.includes('--force'), `the OFF argv carried --force: ${JSON.stringify(argv)}`);
  }, 'gateway-spy'));

  // L2d — a guard-3 refusal is never rewritten into --force.
  results.push(await guardedCheck('L2d', blame(ev, 'A13'), async () => {
    const cycle = requireCycle(ev);
    const spy: string[][] = cycle.gateway_spy?.argv_log || [];
    assert(spy.length > 0, 'the gateway spy recorded no argv at all, so no refusal can be inspected');
    assert(
      Number(cycle.gateway_spy?.force_count) === 0,
      `gateway spy counted ${cycle.gateway_spy?.force_count} --force invocations across the live cycle`
    );
    const forced = spy.filter((entry) => entry.includes('--force'));
    assert(forced.length === 0, `--force appeared in the argv log: ${JSON.stringify(forced)}`);
    for (const refusal of cycle.off?.guard3_refusals || []) {
      assert(
        !(refusal.argv || []).includes('--force'),
        `a guard-3 refusal was retried as force: ${JSON.stringify(refusal)}`
      );
    }
  }, 'mutation-report'));

  // L9h — DOWN-OK carrying the app caller identity, spied as --owner-off/zero --force.
  results.push(await guardedCheck('L9h', blame(ev, 'A13'), async () => {
    const off = requireCycle(ev).off || {};
    assert(off.gateway_outcome === 'DOWN-OK', `expected a DOWN-OK line, got ${JSON.stringify(off.gateway_outcome)}`);
    assert(
      typeof off.caller_identity === 'string' && off.caller_identity.length > 0 && off.caller_identity !== 'unknown',
      `expected the DOWN-OK line to carry the app XMAC_CALLER identity, got ${JSON.stringify(off.caller_identity)}`
    );
    const argv: string[] = off.argv || [];
    assert(argv.includes('--owner-off') && !argv.includes('--force'), `spied OFF argv was ${JSON.stringify(argv)}`);
  }, 'gateway-spy'));

  // D2a — a designated idle UP machine reaches verified DOWN after the approved OFF.
  results.push(await guardedCheck('D2a', blame(ev, 'A13'), async () => {
    const cycle = requireCycle(ev);
    const off = cycle.off || {};
    assert(cycle.target === TARGET, `expected target ${TARGET}, got ${JSON.stringify(cycle.target)}`);
    assert(off.verified_down === true, `expected verified DOWN after the live OFF, got ${JSON.stringify(off.verified_down)}`);
    assert(
      (off.argv || []).includes('--owner-off') && !(off.argv || []).includes('--force'),
      `the verified DOWN was reached with argv ${JSON.stringify(off.argv)}, not down --owner-off`
    );
  }, 'live-oracle'));

  finish('E5/A13', results, 4);
});

// ---------------------------------------------------------------------------
// Q-JROM-LIVE — JROM's grant: the gate that lets the armed run happen at all.
// Owns: L9f
// The grant is written only by JROM or [north]. This journey, and the harness
// it drives, may only ever READ it.
// ---------------------------------------------------------------------------
test('test_Q_JROM_LIVE_grant_binds_the_target_and_is_never_created_by_the_harness', async () => {
  const ev = await evidence();
  const results: boolean[] = [];

  // L9f — the live fence target is media, never .174 or .179, and the armed
  // run happens only for a pre-existing grant bound to that same machine.
  results.push(await guardedCheck('L9f', blame(ev, 'Q-JROM-LIVE', false), async () => {
    const pre = requirePreflight(ev);

    assert(!ev.grantCreatedByHarness, 'the harness created Q-JROM-LIVE.grant; only JROM or [north] may write it');
    assert(pre.grant?.created_by_harness === false, `harness reported grant.created_by_harness=${JSON.stringify(pre.grant?.created_by_harness)}`);

    assert(pre.target === TARGET, `expected the live target to resolve to ${TARGET}, got ${JSON.stringify(pre.target)}`);

    const refusals = pre.refusals || [];
    for (const ip of PROTECTED_IPS) {
      const row = refusals.find((r: any) => r.ip === ip);
      assert(row, `the harness never considered ${ip}, so it cannot be shown to refuse it: ${JSON.stringify(refusals)}`);
      assert(row.refused === true, `${ip} was not refused: ${JSON.stringify(row)}`);
      assert(row.argv_built === false, `${ip} was refused only after argv was built: ${JSON.stringify(row)}`);
    }

    assert(
      ev.grantExistedBefore,
      'no pre-existing Q-JROM-LIVE.grant: the armed live cycle is gated on JROM granting it, and nothing here may create one'
    );
    assert(
      ev.grantMachineId === TARGET,
      `grant machine-id is ${JSON.stringify(ev.grantMachineId)}, which does not equal target ${TARGET}`
    );
    assert(pre.grant?.matches_target === true, `harness reported grant.matches_target=${JSON.stringify(pre.grant?.matches_target)}`);
  }, 'live-oracle'));

  finish('E5/Q-JROM-LIVE', results, 1);
});
