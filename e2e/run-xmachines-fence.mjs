#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Repo root is derived from this file's own location, not process.cwd(), so
// the internal Playwright spawn below always finds e2e/*.spec.ts and the
// local npx/playwright binary regardless of what cwd the runner itself was
// invoked from (report/contract paths below are cwd-relative on purpose, so
// a caller can isolate them into a scratch directory).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONTRACT_PATH = path.resolve(REPO_ROOT, 'xmachines/projcore-run-2026-09-25/fence-contract.json');
const PLAYWRIGHT_CONFIG = path.resolve(REPO_ROOT, 'playwright.xmachines.config.ts');
const REPORT_PATH = path.resolve(process.cwd(), 'fence-report-v1.json');
const SPAWN_TIMEOUT_MS = 170_000; // stays under the standing contract's 180s browser-hang budget

const args = process.argv.slice(2);
function argVal(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const FENCE_ID = argVal('--fence', 'E1');
const EXPECT_RED = argVal('--expect-red', null);
const CONTRACT_PATH = path.resolve(process.cwd(), argVal('--contract', DEFAULT_CONTRACT_PATH));

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const fence = contract.fences?.[FENCE_ID];
if (!fence) {
  // Deliberately does not write a report: an unknown fence has no verdict to preserve.
  console.error(`Fence ${FENCE_ID} not found in ${CONTRACT_PATH}`);
  process.exit(2);
}

const acceptance_ids = fence.acceptance_ids || [];

function verdictLine(verdict, faultClass) {
  return `[FENCE-VERDICT-V1] fence=${FENCE_ID} verdict=${verdict} fault_class=${faultClass}`;
}

function writeReportAndExit(verdict, faultClass, collected, passed, failed, exitCode) {
  const line = verdictLine(verdict, faultClass);
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    schema: 'fence-report-v1',
    collected,
    passed,
    failed,
    verdict_line: line,
  }, null, 2) + '\n');
  (exitCode === 0 ? console.log : console.error)(line);
  process.exit(exitCode);
}

const testPath = fence.test_path;
if (!testPath || !fs.existsSync(path.resolve(REPO_ROOT, testPath))) {
  writeReportAndExit('FAIL', 'missing_journey', [], [], acceptance_ids.map((id) => ({ id, kind: 'assert', message: 'journey file missing' })), 1);
}

// Observed evidence comes from the journey's own stdout lines, never from
// the contract row (north D-082): the contract is the EXPECTED value, this
// parse is the OBSERVED value.
const ACCEPT_RE = /\[FENCE-ACCEPT-V1]\s+id=(\S+)(?:\s+via=(\S+))?/g;
const REJECT_RE = /\[FENCE-REJECT-V1]\s+id=(\S+)\s+unit=(\S+)/g;

function spawnJourney(env) {
  const result = spawnSync(
    'npx',
    ['playwright', 'test', testPath, `--config=${PLAYWRIGHT_CONFIG}`, '--project=xmachines', '--reporter=line'],
    { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGTERM' }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;

  const collectedEntries = [];
  let match;
  ACCEPT_RE.lastIndex = 0;
  while ((match = ACCEPT_RE.exec(combinedOutput)) !== null) {
    collectedEntries.push({ id: match[1], via: match[2] || null });
  }
  const rejected = new Map(); // id -> { unit }
  REJECT_RE.lastIndex = 0;
  while ((match = REJECT_RE.exec(combinedOutput)) !== null) {
    rejected.set(match[1], { unit: match[2] });
  }
  return {
    exitCode: result.status ?? 1,
    collectedEntries,
    collected: collectedEntries.map((entry) => entry.id),
    rejected,
  };
}

// J1c: a failure report naming more than two distinct contributing units
// signals a plan-level defect (too much grouped into one fence), not an
// ordinary implementation gap.
function classifyByUnitSpread(failedWithUnits, fallbackFaultClass) {
  const distinctUnits = new Set(failedWithUnits.map((f) => f.unit).filter(Boolean));
  return distinctUnits.size > 2 ? 'plan_defect' : fallbackFaultClass;
}

function l9eProvenanceFailure(collectedEntries) {
  if (!acceptance_ids.includes('L9e')) return null;
  const l9e = collectedEntries.find((entry) => entry.id === 'L9e');
  if (!l9e || l9e.via !== 'host-state') {
    return { id: 'L9e', kind: 'assert', message: `L9e evidence via=${l9e ? l9e.via : 'missing'}, argv-only proof is not acceptable` };
  }
  return null;
}

if (EXPECT_RED) {
  // Differential negative control (J1b): the stub must be shown to CAUSE the
  // failure, not merely coincide with a permanently-broken id. Run B is the
  // invocation as given (its env already carries whatever FENCE_STUB the
  // caller set, if any); run A is the same journey with FENCE_STUB removed.
  const runB = spawnJourney(process.env);
  const envA = { ...process.env };
  delete envA.FENCE_STUB;
  const runA = spawnJourney(envA);

  const unionB = new Set([...runB.collected, ...runB.rejected.keys()]);
  const unreached = acceptance_ids.filter((id) => !unionB.has(id));
  if (unreached.length > 0) {
    writeReportAndExit(
      'FAIL',
      'unreached_acceptance',
      runB.collected,
      runB.collected,
      unreached.map((id) => ({ id, kind: 'assert', message: 'journey never reached this acceptance id' })),
      1
    );
  }

  // Provenance is judged on the unstubbed baseline (run A): that is the
  // green result being trusted. A run-B check would treat a stub-induced
  // L9e rejection as argv_only_power_proof, so it is skipped when L9e is
  // the id under negative control.
  const l9eFailure = l9eProvenanceFailure(runA.collectedEntries);
  if (l9eFailure) {
    writeReportAndExit('FAIL', 'argv_only_power_proof', runB.collected, runB.collected.filter((id) => id !== 'L9e'), [l9eFailure], 1);
  }
  if (EXPECT_RED !== 'L9e') {
    const l9eFailureB = l9eProvenanceFailure(runB.collectedEntries);
    if (l9eFailureB) {
      writeReportAndExit('FAIL', 'argv_only_power_proof', runB.collected, runB.collected.filter((id) => id !== 'L9e'), [l9eFailureB], 1);
    }
  }

  const greenEntry = runA.collectedEntries.find((entry) => entry.id === EXPECT_RED);
  const idGreenInA = EXPECT_RED === 'L9e'
    ? Boolean(greenEntry && greenEntry.via === 'host-state')
    : Boolean(greenEntry);
  const idRedInB = runB.rejected.has(EXPECT_RED);

  if (!idGreenInA) {
    writeReportAndExit(
      'FAIL',
      'negative_control_not_differential',
      runB.collected,
      runB.collected,
      [{ id: EXPECT_RED, kind: 'assert', message: `id was not green in the unstubbed baseline run (collected=${JSON.stringify(runA.collected)}); a stub cannot be shown to cause a failure that was already there` }],
      1
    );
  }
  if (!idRedInB) {
    writeReportAndExit(
      'FAIL',
      'negative_control_did_not_red',
      runB.collected,
      runB.collected.filter((id) => id !== EXPECT_RED),
      [{ id: EXPECT_RED, kind: 'assert', message: 'expected id to be named-rejected under the stubbed run but it passed' }],
      1
    );
  }

  writeReportAndExit(
    'PASS',
    'none',
    runB.collected,
    runB.collected,
    [...runB.rejected.entries()].map(([id, meta]) => ({ id, kind: 'assert', unit: meta.unit })),
    0
  );
}

// Single (non-negative-control) run.
const run = spawnJourney(process.env);

// J1d — a fence report with nothing observed at all (no ACCEPT, no REJECT —
// the journey produced zero evidence of any kind) is RED.
if (run.collected.length === 0 && run.rejected.size === 0) {
  writeReportAndExit('FAIL', 'empty_collected', [], [], acceptance_ids.map((id) => ({ id, kind: 'assert' })), 1);
}

const l9eFailure = l9eProvenanceFailure(run.collectedEntries);
if (l9eFailure) {
  writeReportAndExit('FAIL', 'argv_only_power_proof', run.collected, run.collected.filter((id) => id !== 'L9e'), [l9eFailure], 1);
}

// J1e — collected must equal the row's acceptance_ids as two independent sets.
const acceptanceSet = new Set(acceptance_ids);
const collectedSet = new Set(run.collected);
const missing = acceptance_ids.filter((id) => !collectedSet.has(id));
const extra = run.collected.filter((id) => !acceptanceSet.has(id));

if (missing.length > 0 || extra.length > 0) {
  console.error(`set_difference missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
  const failedWithUnits = missing
    .filter((id) => run.rejected.has(id))
    .map((id) => ({ id, kind: 'assert', unit: run.rejected.get(id).unit, message: 'missing from collected' }));
  const failedUnreached = missing
    .filter((id) => !run.rejected.has(id))
    .map((id) => ({ id, kind: 'assert', message: 'missing from collected' }));
  const failedExtra = extra.map((id) => ({ id, kind: 'assert', message: 'not in contract acceptance_ids' }));
  const faultClass = classifyByUnitSpread(failedWithUnits, 'missing_acceptance');
  writeReportAndExit(
    'FAIL',
    faultClass,
    run.collected,
    run.collected.filter((id) => acceptanceSet.has(id)),
    [...failedWithUnits, ...failedUnreached, ...failedExtra],
    1
  );
}

const verdict = run.exitCode === 0 ? 'PASS' : 'FAIL';
const faultClass = run.exitCode === 0 ? 'none' : 'implementation';
writeReportAndExit(
  verdict,
  faultClass,
  run.collected,
  run.exitCode === 0 ? run.collected : [],
  run.exitCode === 0 ? [] : run.collected.map((id) => ({ id, kind: 'assert' })),
  run.exitCode === 0 ? 0 : 1
);
