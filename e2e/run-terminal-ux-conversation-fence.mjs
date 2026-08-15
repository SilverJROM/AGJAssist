import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const runDir = path.resolve('AGJ_Upgrade/terminal-ux-2026-08-15/projcore-run-2026-08-15');
fs.rmSync(reportPath, { force: true });

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--no-install', 'playwright', 'test', 'e2e/terminal-ux-conversation.spec.ts', '--grep', 'terminal conversation composes'],
  {
    cwd: process.cwd(),
    env: { ...process.env, FENCE_REPORT_PATH: reportPath },
    stdio: 'inherit'
  }
);

if (!fs.existsSync(reportPath)) {
  const fallback = {
    schema: 'fence-report-v1',
    collected: ['R1a', 'R1b', 'R3', 'R4', 'R5'],
    passed: [],
    failed: [
      { id: 'R1a', kind: 'collect_error' },
      { id: 'R1b', kind: 'collect_error' },
      { id: 'R3', kind: 'collect_error' },
      { id: 'R4', kind: 'collect_error' },
      { id: 'R5', kind: 'collect_error' }
    ]
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(fallback, null, 2)}\n`);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`[terminal-ux-fence] unreadable report: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const valid = report?.schema === 'fence-report-v1'
  && Array.isArray(report.collected)
  && Array.isArray(report.passed)
  && Array.isArray(report.failed)
  && report.failed.every((item) => item && typeof item.id === 'string' && typeof item.kind === 'string');

if (!valid) {
  console.error('[terminal-ux-fence] invalid fence-report-v1.json shape');
  process.exit(1);
}

for (const dest of [path.join(runDir, 'fence-report-v1.json')]) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(reportPath, dest);
  } catch {}
}

process.exit(result.status === 0 && report.failed.length === 0 ? 0 : 1);
