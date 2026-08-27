#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const SRC_DB = process.env.DB_PATH_SOURCE || 'data/agjassist.db';
const srcDbPath = path.resolve(SRC_DB);

function ensureTmpDb(tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpDb = path.join(tmpDir, 'agjassist.db');
  if (fs.existsSync(srcDbPath)) {
    fs.copyFileSync(srcDbPath, tmpDb);
  } else {
    fs.writeFileSync(tmpDb, '');
  }
  return tmpDb;
}

if (serve) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const tmpDb = ensureTmpDb(tmpDir);
  const env = { ...process.env, DB_PATH: tmpDb, AGJASSIST_FENCE_DB_MODE: 'temp-copy' };
  const server = spawn('node', ['e2e/static-server.mjs'], { stdio: 'inherit', env });
  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    server.kill();
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  server.on('exit', () => { cleanup(); process.exit(0); });
} else {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const tmpDb = ensureTmpDb(tmpDir);
  const startSize = fs.statSync(tmpDb).size;
  let exitCode = 0;
  try {
    const cmdIdx = args.indexOf('--');
    if (cmdIdx !== -1) {
      const cmd = args.slice(cmdIdx + 1);
      const env = { ...process.env, DB_PATH: tmpDb, AGJASSIST_FENCE_DB_MODE: 'temp-copy' };
      const result = spawnSync(cmd[0], cmd.slice(1), { env, stdio: 'inherit' });
      exitCode = result.status ?? 1;
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    console.log(`reclaimed_bytes=${startSize}`);
    process.exitCode = exitCode;
  }
}
