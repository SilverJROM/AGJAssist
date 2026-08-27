#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const fenceId = process.env.FENCE_ID || 'B8';
const stub = process.env.FENCE_STUB || '';
const harnessSmoke = args.includes('--harness-smoke');

dotenv.config();

// Bootstrap an owner session in the isolated database used by this invocation.
function bootstrapOwnerToken(dbPath) {
  const jwtSecret = process.env.JWT_SECRET || 'agjassist-dev-secret-change-me';
  const userId = 1;
  const telegramId = 1000000001;
  const sessionId = 'test-session-c0';
  const expiresAt = new Date(Date.now() + 24*3600*1000).toISOString();
  const token = jwt.sign({ sub: userId, sid: sessionId, tid: telegramId }, jwtSecret, { expiresIn: '24h' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, surface, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, surface = excluded.surface`
  ).run(sessionId, userId, tokenHash, 'web', expiresAt);
  db.close();
  return token;
}
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

function writeReport(collected, passed, failed, verdict='PASS', faultClass='none') {
  const report = {
    schema: 'fence-report-v1',
    verdict_line: verdictLine(verdict, faultClass),
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
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.cc-fence-'));
  const dbPath = path.join(tmpDir, 'agjassist.db');
  fs.copyFileSync(path.resolve(process.env.DB_PATH_SOURCE || 'data/agjassist.db'), dbPath);
  const ownerToken = bootstrapOwnerToken(dbPath);
  const portProbe = spawnSync('bash', ['-c', 'ss -ltn "( sport = :3210 )" | grep -q LISTEN']);
  const fencePort = portProbe.status === 0 ? '3211' : '3210';
  const mergedEnv = {
    ...env,
    DB_PATH: dbPath,
    OWNER_TOKEN: ownerToken,
    AGJASSIST_FENCE_DB_MODE: 'temp-copy',
    FENCE_PORT: fencePort,
    FENCE_ORIGIN: `http://localhost:${fencePort}`
  };
  const result = spawnSync('npx', ['playwright', 'test', testPath, '--project=cc', '--config=playwright.cc.config.ts', '--reporter=line'], {
    env: mergedEnv,
    stdio: 'inherit',
  });
  try {
    return result.status ?? 1;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
  const negFails = negReport?.failed || [];
  const expectedFailures = expectedNegIds.map(id => ({ id, kind: expectedKind }));
  const failedNeg = negCode !== 0
    && negFails.length === expectedFailures.length
    && expectedFailures.every(expected => negFails.some(actual => actual?.id === expected.id && actual?.kind === expected.kind));
  const negFailedIds = failedNeg ? expectedFailures : [];
  const overallPass = passed && failedNeg;
  const verdict = overallPass ? 'PASS' : 'FAIL';
  const faultClass = overallPass ? 'none' : 'implementation';
  writeReport(fence.acceptance_ids, passed ? fence.acceptance_ids : [], failedNeg ? negFailedIds : [], verdict, faultClass);
  console.log(verdictLine(verdict, faultClass));
  process.exit(overallPass ? 0 : 1);
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
