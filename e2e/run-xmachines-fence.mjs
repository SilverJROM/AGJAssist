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

// FENCE_STUB is inherited from process.env into the spawned Playwright
// process unchanged — the journey itself reads it to disable a named
// contributing unit for a negative control.
const pwResult = spawnSync(
  'npx',
  ['playwright', 'test', testPath, `--config=${PLAYWRIGHT_CONFIG}`, '--project=xmachines', '--reporter=line'],
  { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' }
);

if (pwResult.stdout) process.stdout.write(pwResult.stdout);
if (pwResult.stderr) process.stderr.write(pwResult.stderr);
const combinedOutput = `${pwResult.stdout || ''}\n${pwResult.stderr || ''}`;
const journeyExitCode = pwResult.status ?? 1;

// Observed evidence comes from the journey's own stdout lines, never from
// the contract row (north D-082): the contract is the EXPECTED value, this
// parse is the OBSERVED value.
const acceptRe = /\[FENCE-ACCEPT-V1]\s+id=(\S+)(?:\s+via=(\S+))?/g;
const rejectRe = /\[FENCE-REJECT-V1]\s+id=(\S+)/g;

const collectedEntries = [];
let match;
while ((match = acceptRe.exec(combinedOutput)) !== null) {
  collectedEntries.push({ id: match[1], via: match[2] || null });
}
const rejectedIds = new Set();
while ((match = rejectRe.exec(combinedOutput)) !== null) {
  rejectedIds.add(match[1]);
}
const collected = collectedEntries.map((entry) => entry.id);

// Negative control: --expect-red <id> inverts the gate. A PASS requires the
// named id to have been explicitly, named-ly rejected by the journey — not
// merely absent, which could just as easily mean an unrelated crash skipped
// it before it was ever reached.
if (EXPECT_RED) {
  if (rejectedIds.has(EXPECT_RED)) {
    writeReportAndExit(
      'PASS',
      'none',
      collected,
      collected,
      [...rejectedIds].map((id) => ({ id, kind: 'assert' })),
      0
    );
  }
  writeReportAndExit(
    'FAIL',
    'negative_control_did_not_red',
    collected,
    collected.filter((id) => id !== EXPECT_RED),
    [{ id: EXPECT_RED, kind: 'assert', message: 'expected id to be named-rejected under the negative control but it passed or was never collected' }],
    1
  );
}

// J1d — an empty collected set is RED.
if (collected.length === 0) {
  writeReportAndExit('FAIL', 'empty_collected', [], [], acceptance_ids.map((id) => ({ id, kind: 'assert' })), 1);
}

// L9e — a mock-spawned argv assertion alone cannot pass a power fence: the
// provenance token itself (not just presence of the id) decides this.
if (acceptance_ids.includes('L9e')) {
  const l9e = collectedEntries.find((entry) => entry.id === 'L9e');
  if (!l9e || l9e.via !== 'host-state') {
    writeReportAndExit(
      'FAIL',
      'argv_only_power_proof',
      collected,
      collected.filter((id) => id !== 'L9e'),
      [{ id: 'L9e', kind: 'assert', message: `L9e evidence via=${l9e ? l9e.via : 'missing'}, argv-only proof is not acceptable` }],
      1
    );
  }
}

// J1e — collected must equal the row's acceptance_ids as two independent sets.
const acceptanceSet = new Set(acceptance_ids);
const collectedSet = new Set(collected);
const missing = acceptance_ids.filter((id) => !collectedSet.has(id));
const extra = collected.filter((id) => !acceptanceSet.has(id));
if (missing.length > 0 || extra.length > 0) {
  console.error(`set_difference missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
  writeReportAndExit(
    'FAIL',
    'missing_acceptance',
    collected,
    collected.filter((id) => acceptanceSet.has(id)),
    [
      ...missing.map((id) => ({ id, kind: 'assert', message: 'missing from collected' })),
      ...extra.map((id) => ({ id, kind: 'assert', message: 'not in contract acceptance_ids' })),
    ],
    1
  );
}

const verdict = journeyExitCode === 0 ? 'PASS' : 'FAIL';
const faultClass = journeyExitCode === 0 ? 'none' : 'implementation';
writeReportAndExit(
  verdict,
  faultClass,
  collected,
  journeyExitCode === 0 ? collected : [],
  journeyExitCode === 0 ? [] : collected.map((id) => ({ id, kind: 'assert' })),
  journeyExitCode === 0 ? 0 : 1
);
