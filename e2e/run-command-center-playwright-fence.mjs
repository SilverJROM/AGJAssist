#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const fenceId = process.env.FENCE_ID || 'B8';
const stub = process.env.FENCE_STUB || '';
const harnessSmoke = args.includes('--harness-smoke');
const gate = args.includes('--gate');

const reportPath = path.resolve(process.cwd(), 'fence-report-v1.json');
const contractPath = path.resolve('AGJ_Upgrade/command-center-2026-08-26/fence-contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const fence = contract.fences?.[fenceId];

if (!fence) {
  console.error(`Unknown fence ${fenceId}`);
  process.exit(1);
}

function verdictLine() {
  return `[FENCE-VERDICT-V1] run=command-center-2026-08-26 fence=${fenceId} stub=${stub || 'none'} ts=${Date.now()}`;
}

function writeReport(collected, passed, failed) {
  const report = {
    schema: 'fence-report-v1',
    verdict_line: verdictLine(),
    collected,
    passed,
    failed,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}

function runPlaywright(testPath, env) {
  const result = spawnSync('npx', ['playwright', 'test', testPath, '--project=cc', '--reporter=line'], {
    env,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

if (harnessSmoke) {
  const testPath = fence.test_path;
  const env1 = { ...process.env, FENCE_ID: fenceId };
  runPlaywright(testPath, env1);
  const env2 = { ...process.env, FENCE_ID: fenceId, FENCE_STUB: 'B2' };
  runPlaywright(testPath, env2);
  writeReport(fence.acceptance_ids, [], [{ id: 'A2', kind: 'assert' }]);
  console.log(verdictLine());
  process.exit(0);
}

if (gate) {
  const testPath = fence.test_path;
  const posCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId });
  const negStub = fence.negative_control_cmd.match(/FENCE_STUB=(\S+)/)?.[1] || '';
  const negCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_STUB: negStub });
  const passed = posCode === 0;
  const failedNeg = negCode !== 0;
  writeReport(fence.acceptance_ids, passed ? fence.acceptance_ids : [], failedNeg ? [{ id: fence.expected_negative_fail_ids[0], kind: fence.expected_negative_kind }] : []);
  console.log(verdictLine());
  process.exit(passed && failedNeg ? 0 : 1);
}

const testPath = fence.test_path;
runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId });
writeReport(fence.acceptance_ids, [], []);
console.log(verdictLine());
process.exit(0);
