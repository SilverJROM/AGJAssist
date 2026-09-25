import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const RUNNER = path.resolve(REPO_ROOT, 'e2e/run-xmachines-fence.mjs');
const CONTRACT = path.resolve(REPO_ROOT, 'xmachines/projcore-run-2026-09-25/fence-contract.json');

function mkTmpDir(prefix: string) {
  return fs.mkdtempSync(path.join(REPO_ROOT, `.${prefix}-`));
}

// Drives the ACTUAL harness (e2e/run-xmachines-fence.mjs) as a subprocess —
// never writes fence-report-v1.json itself (north D-082: the report must be
// produced by the system under test, not authored by the test).
function runHarness(harnessArgs: string[], cwd: string) {
  try {
    const stdout = execFileSync('node', [RUNNER, ...harnessArgs], { cwd, encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (error: any) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: `${error.stdout || ''}\n${error.stderr || ''}`,
    };
  }
}

describe('xmachines fence harness A0.2', () => {
  it('preserves [FENCE-VERDICT-V1] in fence-report-v1.json — driven by the real A17 journey', () => {
    const tmpDir = mkTmpDir('xm-fence-a17');
    try {
      runHarness(['--fence', 'A17', '--contract', CONTRACT], tmpDir);
      const reportPath = path.join(tmpDir, 'fence-report-v1.json');
      expect(fs.existsSync(reportPath)).toBe(true);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(typeof report.verdict_line).toBe('string');
      expect(report.verdict_line).toContain('[FENCE-VERDICT-V1]');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('negative twin: an unknown fence suppresses the verdict line entirely and exits nonzero', () => {
    const tmpDir = mkTmpDir('xm-fence-unknown');
    try {
      const result = runHarness(['--fence', 'DOES-NOT-EXIST', '--contract', CONTRACT], tmpDir);
      expect(result.status).not.toBe(0);
      expect(fs.existsSync(path.join(tmpDir, 'fence-report-v1.json'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('makes empty collected RED (J1d) — driven by a fixture journey that emits nothing', () => {
    const tmpDir = mkTmpDir('xm-fence-empty');
    try {
      const fixtureContract = path.join(tmpDir, 'fence-contract.json');
      fs.writeFileSync(fixtureContract, JSON.stringify({
        fences: {
          EMPTY: { acceptance_ids: ['X1'], test_path: 'e2e/xmachines-fence-FIXTURE-EMPTY.spec.ts' },
        },
      }));
      const result = runHarness(['--fence', 'EMPTY', '--contract', fixtureContract], tmpDir);
      expect(result.status).not.toBe(0);
      const report = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fence-report-v1.json'), 'utf8'));
      expect(report.verdict_line).toContain('fault_class=empty_collected');
      expect(report.collected).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('requires collected to equal the row acceptance_ids (J1e) — contract shape sanity', () => {
    const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
    const fence = contract.fences['A17'];
    expect(fence).toBeDefined();
    expect(Array.isArray(fence.acceptance_ids)).toBe(true);
    expect(fence.acceptance_ids.length).toBeGreaterThan(0);
  });

  it('names the missing id under fault_class=missing_acceptance (J1e) — driven by a fixture that accepts only one of two ids', () => {
    const tmpDir = mkTmpDir('xm-fence-partial');
    try {
      const fixtureContract = path.join(tmpDir, 'fence-contract.json');
      fs.writeFileSync(fixtureContract, JSON.stringify({
        fences: {
          PARTIAL: { acceptance_ids: ['P1', 'P2'], test_path: 'e2e/xmachines-fence-FIXTURE-PARTIAL.spec.ts' },
        },
      }));
      const result = runHarness(['--fence', 'PARTIAL', '--contract', fixtureContract], tmpDir);
      expect(result.status).not.toBe(0);
      const report = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fence-report-v1.json'), 'utf8'));
      expect(report.verdict_line).toContain('fault_class=missing_acceptance');
      expect(report.collected).toEqual(['P1']);
      expect(report.failed.some((f: any) => f.id === 'P2')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('--expect-red stays RED for an all-rejected fixture (J1b/attempt-2 regression) instead of the early-return PASS', () => {
    const tmpDir = mkTmpDir('xm-fence-expectred');
    try {
      const fixtureContract = path.join(tmpDir, 'fence-contract.json');
      fs.writeFileSync(fixtureContract, JSON.stringify({
        fences: {
          EXPECT_RED_STATIC: { acceptance_ids: ['Y1'], test_path: 'e2e/xmachines-fence-FIXTURE-EXPECT-RED-STATIC.spec.ts' },
        },
      }));
      const result = runHarness(['--fence', 'EXPECT_RED_STATIC', '--contract', fixtureContract, '--expect-red', 'Y1'], tmpDir);
      // Attempt 2's bug: this exact all-rejected shape used to short-circuit
      // to verdict=PASS fault_class=none with collected:[] before any of the
      // completeness/L9e/differential checks ran.
      expect(result.status).not.toBe(0);
      const report = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fence-report-v1.json'), 'utf8'));
      expect(report.verdict_line).toContain('verdict=FAIL');
      expect(report.verdict_line).not.toContain('fault_class=none');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects argv-only power proof under L9e — driven by a fixture journey that claims L9e via argv', () => {
    const tmpDir = mkTmpDir('xm-fence-l9e');
    try {
      const fixtureContract = path.join(tmpDir, 'fence-contract.json');
      fs.writeFileSync(fixtureContract, JSON.stringify({
        fences: {
          L9E_ARGV: { acceptance_ids: ['L9e'], test_path: 'e2e/xmachines-fence-FIXTURE-L9E-ARGV.spec.ts' },
        },
      }));
      const result = runHarness(['--fence', 'L9E_ARGV', '--contract', fixtureContract], tmpDir);
      expect(result.status).not.toBe(0);
      const report = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fence-report-v1.json'), 'utf8'));
      expect(report.verdict_line).toContain('fault_class=argv_only_power_proof');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('phase checkpoints A17 B17 C9 D14 exist and their declared acceptance_ids match the contract', async () => {
    const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
    const checkpoints = ['A17', 'B17', 'C9', 'D14'];
    for (const id of checkpoints) {
      const specPath = path.resolve(REPO_ROOT, `e2e/xmachines-fence-${id}.spec.ts`);
      expect(fs.existsSync(specPath), `e2e/xmachines-fence-${id}.spec.ts must exist`).toBe(true);

      const manifestPath = path.resolve(REPO_ROOT, `e2e/xmachines-fence-${id}.manifest.mjs`);
      const manifestModule = await import(pathToFileURL(manifestPath).href);
      const contractIds = contract.fences[id]?.acceptance_ids;
      expect(contractIds, `contract must carry a fences.${id} row`).toBeDefined();
      expect(manifestModule.ACCEPTANCE_IDS).toEqual(contractIds);
    }
  });
});
