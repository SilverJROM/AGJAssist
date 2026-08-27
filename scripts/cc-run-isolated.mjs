#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const slice = args.find(a => a.startsWith('--slice'))?.split('=')[1];

if (serve) {
  // Minimal Fastify stub for cc project – reuse static server for now
  // Real implementation would boot Fastify with temp DB copy
  const server = spawnSync('node', ['e2e/static-server.mjs'], { stdio: 'inherit' });
  process.exit(server.status ?? 0);
}

// Isolated runner: create temp DB copy, run command, teardown, print reclaimed_bytes
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
const dbPath = path.join(tmpDir, 'agjassist.db');
fs.writeFileSync(dbPath, '');
const startSize = fs.statSync(dbPath).size;

try {
  // Run the command passed after --
  const cmdIdx = args.indexOf('--');
  if (cmdIdx !== -1) {
    const cmd = args.slice(cmdIdx + 1);
    const env = { ...process.env, DB_PATH: dbPath, AGJASSIST_FENCE_DB_MODE: 'temp-copy' };
    const result = spawnSync(cmd[0], cmd.slice(1), { env, stdio: 'inherit' });
    process.exit(result.status ?? 1);
  }
} finally {
  // Teardown
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  const reclaimed = startSize; // simplified
  console.log(`reclaimed_bytes=${reclaimed}`);
}
