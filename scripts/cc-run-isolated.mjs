#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const SRC_DB = process.env.DB_PATH_SOURCE || 'data/agjassist.db';
const srcDbPath = path.resolve(SRC_DB);
const PUBLIC_PORT = 3210;
const UPSTREAM_PORT = 3211;

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

// FENCE_STUB replaces a named contributor's effect in-process (fence-contract.json's
// negative_control_cmd), applied at the network boundary in front of the real Fastify
// server so the same page.request-driven assertions observe the stubbed behaviour —
// page.route() cannot see page.request traffic, so per-spec route() stubs can't reach it.
const FENCE_STUB_HANDLERS = {
  // B2 (plan.md): removes registerOvermindRoutes so /api/overmind/status stops
  // existing (404). Stubbing B2 re-registers a synthetic 200 here so B8's negative
  // control keeps proving the fence catches a regression once B2 actually lands.
  B2: (req, res) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/api/overmind/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ stubbed: true, contributor: 'B2' }));
      return true;
    }
    return false;
  },
};

function startStubProxy(stub) {
  const handler = FENCE_STUB_HANDLERS[stub];
  const proxy = http.createServer((req, res) => {
    if (handler && handler(req, res)) return;
    const upstreamReq = http.request(
      { host: '127.0.0.1', port: UPSTREAM_PORT, path: req.url, method: req.method, headers: req.headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstreamReq.on('error', () => { res.writeHead(502); res.end('upstream unavailable'); });
    req.pipe(upstreamReq);
  });
  proxy.on('upgrade', (req, socket, head) => {
    const upstreamReq = http.request({
      host: '127.0.0.1', port: UPSTREAM_PORT, path: req.url, method: req.method, headers: req.headers
    });
    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n` +
        Object.entries(upstreamRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n'
      );
      upstreamSocket.write(upstreamHead);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    upstreamReq.on('error', () => socket.destroy());
    upstreamReq.end(head);
  });
  proxy.listen(PUBLIC_PORT);
  return proxy;
}

if (serve) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const tmpDb = ensureTmpDb(tmpDir);
  const stub = process.env.FENCE_STUB || '';
  const port = stub ? UPSTREAM_PORT : PUBLIC_PORT;
  const env = {
    ...process.env,
    DB_PATH: tmpDb,
    AGJASSIST_FENCE_DB_MODE: 'temp-copy',
    API_PORT: String(port),
    API_HOST: '127.0.0.1',
    TEST_MODE: 'true'
  };
  // Real Fastify entrypoint (src/index.ts) via tsx's node --import loader hook —
  // serves the shipped app through Fastify's own static registration, not a stand-in.
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { stdio: 'inherit', env });
  const proxy = stub ? startStubProxy(stub) : null;
  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (proxy) proxy.close();
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
