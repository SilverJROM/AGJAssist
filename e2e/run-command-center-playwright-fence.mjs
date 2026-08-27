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

function verdictLine(verdict='PASS', faultClass='none') {
  return `fence=${fenceId} verdict=${verdict} fault_class=${faultClass}`;
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
  // --config points at the dedicated cc config: TestProject has no webServer
  // field, so a webServer nested under playwright.config.ts's 'cc' project
  // entry is silently ignored there (see playwright.cc.config.ts).
  const result = spawnSync('npx', ['playwright', 'test', testPath, '--project=cc', '--config=playwright.cc.config.ts', '--reporter=line'], {
    env,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function readReport(reportFilePath) {
  try {
    return JSON.parse(fs.readFileSync(reportFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function hasAnyNamedAssert(report) {
  return !!report && Array.isArray(report.failed) && report.failed.some((f) => f && f.id && f.kind === 'assert');
}

function hasFailure(report, id, kind) {
  return !!report && Array.isArray(report.failed) && report.failed.some((f) => f && f.id === id && f.kind === kind);
}

if (harnessSmoke) {
  const testPath = fence.test_path;
  const posReportPath = path.resolve(process.cwd(), '.fence-harness-smoke-pos.json');
  const negReportPath = path.resolve(process.cwd(), '.fence-harness-smoke-neg.json');
  try { fs.unlinkSync(posReportPath); } catch {}
  try { fs.unlinkSync(negReportPath); } catch {}

  const posCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_REPORT_PATH: posReportPath });
  const posReport = readReport(posReportPath);

  const negCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_STUB: 'B2', FENCE_REPORT_PATH: negReportPath });
  const negReport = readReport(negReportPath);

  const posRed = posCode !== 0 && hasAnyNamedAssert(posReport);
  const negRed = negCode !== 0 && hasFailure(negReport, 'A2', 'assert');

  writeReport(fence.acceptance_ids, [], [
    ...(posReport?.failed || []),
    ...(negReport?.failed || []),
  ]);
  console.log(verdictLine());
  console.log(`[harness-smoke] current-HEAD red=${posRed} (exit=${posCode}); FENCE_STUB=B2 red-on-A2=${negRed} (exit=${negCode})`);
  process.exit(posRed && negRed ? 0 : 1);
}

if (gate) {
  const testPath = fence.test_path;
  const posReportPath = path.resolve(process.cwd(), '.fence-gate-pos.json');
  const negReportPath = path.resolve(process.cwd(), '.fence-gate-neg.json');
  try { fs.unlinkSync(posReportPath); } catch {}
  try { fs.unlinkSync(negReportPath); } catch {}
  const posCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_REPORT_PATH: posReportPath });
  const negStub = fence.negative_control_cmd.match(/FENCE_STUB=(\S+)/)?.[1] || '';
  const negCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_STUB: negStub, FENCE_REPORT_PATH: negReportPath });
  const posReport = readReport(posReportPath);
  const negReport = readReport(negReportPath);
  const passed = posCode === 0;
  const expectedNegIds = fence.expected_negative_fail_ids || [];
  const expectedKind = fence.expected_negative_kind || 'assert';
  const negFails = (negReport?.failed || []).filter(f => expectedNegIds.includes(f.id) && f.kind === expectedKind);
  const failedNeg = negCode !== 0 && negFails.length === expectedNegIds.length;
  const negFailedIds = negFails.map(f => ({ id: f.id, kind: f.kind }));
  writeReport(fence.acceptance_ids, passed ? fence.acceptance_ids : [], failedNeg ? negFailedIds : []);
  console.log(verdictLine());
  process.exit(passed && failedNeg ? 0 : 1);
}

const testPath = fence.test_path;
const integrationCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_REPORT_PATH: reportPath });
const specReport = readReport(reportPath) || { schema: 'fence-report-v1', collected: fence.acceptance_ids, passed: [], failed: [] };
const verdict = integrationCode === 0 ? 'PASS' : 'FAIL';
const faultClass = integrationCode === 0 ? 'none' : 'implementation';
specReport.verdict_line = verdictLine(verdict, faultClass);
fs.writeFileSync(reportPath, JSON.stringify(specReport, null, 2) + '\n');
console.log(specReport.verdict_line);
process.exit(integrationCode);
