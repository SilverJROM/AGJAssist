#!/usr/bin/env node
// D8 gate. Renders the force refusal through the detail function, and reads the
// production Telegram sender's sendMessage body from a capture socket.
// The owner-off probe uses a TEST-NET fixture and a PATH spy that does not exec
// the real gateway. It never posts a challenge confirmation.
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const hasPlaywright = args.includes('--playwright');
const captureTelegram = args.includes('--capture-telegram-update');
const driveWire = args.includes('--drive-wire');

const REFUSAL_DETAIL = 'D8 literal refusal probe lease still held';
const REFUSAL_REASON = 'lease-held';
const CHALLENGE_ID = 'd8-fixture-challenge-id';
const DISPLAY_NUMBER = 41;
const CONFIRMATION = 'pid 4821 render-worker held 41m';
const UI_MACHINE = 'd8-fixture-host';
const WIRE_MACHINE = 'd8-wire-host';
const WIRE_PROMPT = 'Force off number-match: tap the number shown on your screen';
const OWNER_TOKEN = 'd8-owner-token';
const OWNER_ID = 2;
const BOT_TOKEN = '424242:d8-force-wire';
const OWNER_CHAT_ID = 867530901;
const DECOY_BOT = 'env-bot-not-the-owner-sender';
const DECOY_CHAT = '555001';
const HOST = 'agjasst.silverjrom.app';
const ORIGIN = 'https://agjasst.silverjrom.app';

function fail(message) {
  console.error(`[D8-ASSERT] ${message}`);
  process.exit(1);
}

function assertRenderedForceField() {
  const viewUrl = pathToFileURL(path.join(REPO_ROOT, 'src/web/public/xmachines-cost-view.js')).href;
  return import(viewUrl).then((view) => {
    const refusal = { reason: REFUSAL_REASON, detail: REFUSAL_DETAIL };
    const challenge = { challengeId: CHALLENGE_ID, displayNumber: DISPLAY_NUMBER };
    const base = {
      machine: { name: UI_MACHINE, state: 'UP' },
      cost: { costPhp: 3, kwh: 2, caveat: 'short burst', isPlaceholder: false },
    };
    const rendered = view.renderMachineCostDetail({
      ...base,
      forceChallenge: challenge,
      forceConfirmation: CONFIRMATION,
      forceRefusal: refusal,
    });
    const field = view.renderForceRefusal(refusal);
    if (typeof rendered !== 'string' || typeof field !== 'string') {
      fail('force renderers did not return markup');
    }
    if (!rendered.includes('data-testid="xmachines-force-button"')) {
      fail('force-off control missing from renderMachineCostDetail markup');
    }
    if (!rendered.includes('data-testid="xmachines-force-refusal"') || !rendered.includes(REFUSAL_DETAIL)) {
      fail('force-refusal field missing from renderMachineCostDetail markup');
    }
    if (!field.includes('data-testid="xmachines-force-refusal"') || !field.includes(REFUSAL_DETAIL)) {
      fail('renderForceRefusal dropped the refusal literal');
    }
    if (!rendered.includes(`data-number="${DISPLAY_NUMBER}"`) || !rendered.includes(CONFIRMATION)) {
      fail('force challenge markup did not honour the supplied number and probe text');
    }
    if (!rendered.includes('data-testid="xmachines-force-challenge"')) {
      fail('force challenge field missing from renderMachineCostDetail markup');
    }
    const withoutRefusal = view.renderMachineCostDetail({
      ...base,
      forceChallenge: challenge,
      forceConfirmation: CONFIRMATION,
    });
    if (withoutRefusal.includes('data-testid="xmachines-force-refusal"') || withoutRefusal.includes(REFUSAL_DETAIL)) {
      fail('force-refusal field rendered without a refusal payload');
    }
    const withoutChallenge = view.renderMachineCostDetail({ ...base, forceRefusal: refusal });
    if (withoutChallenge.includes('data-testid="xmachines-force-challenge"') || withoutChallenge.includes(`data-number="${DISPLAY_NUMBER}"`)) {
      fail('force challenge field rendered without a challenge payload');
    }
  });
}

function minimalConfig() {
  return {
    telegram: {
      botToken: BOT_TOKEN,
      authorizedUserId: OWNER_CHAT_ID,
      authorizedChatIds: [OWNER_CHAT_ID],
      testMode: true,
      updateMode: 'polling',
      webhookUrl: null,
      webhookPath: '/api/telegram/webhook',
      webhookSecretToken: 's',
    },
    runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
    api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function stubServices() {
  return {
    authService: {
      verifyToken: (token) => {
        if (token === OWNER_TOKEN) return { id: OWNER_ID, role: 'owner', username: 'owner' };
        return null;
      },
    },
    projectService: {},
    safetyService: {},
    auditService: {},
    tmuxService: {},
    tmuxStreamManager: {},
    db: {},
    delegationService: {},
    noteService: {},
    planService: {},
    taskService: {},
    fileService: {},
    stepTemplateService: {},
    personalTaskService: {},
    reminderService: {},
    agentAssignmentService: {},
  };
}

async function driveWireCapture() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'd8-wire-'));
  const logPath = path.join(scratch, 'xmac.log');
  const statusPath = path.join(scratch, 'status.txt');
  const spyLog = path.join(scratch, 'spy.log');
  const binDir = path.join(scratch, 'bin');
  const confPath = path.join(scratch, 'machines.conf');
  const stateDir = path.join(scratch, 'state');
  fs.mkdirSync(binDir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(logPath, '');
  fs.writeFileSync(confPath, `# fixture only\n${WIRE_MACHINE}|192.0.2.80|00:00:00:00:00:00|compute||\n`);
  fs.writeFileSync(statusPath, `${WIRE_MACHINE} 192.0.2.80 UP leases=() compute\n`);
  fs.copyFileSync(path.join(REPO_ROOT, 'tests/helpers/xmac-argv-spy.sh'), path.join(binDir, 'xmac.sh'));
  fs.chmodSync(path.join(binDir, 'xmac.sh'), 0o755);

  const envKeys = [
    'TELEGRAM_API_BASE', 'TELEGRAM_API_BASE_URL', 'TELEGRAM_API_ROOT', 'XMACHINES_TELEGRAM_API_BASE',
    'BOT_TOKEN', 'AUTHORIZED_USER_ID', 'XMACHINES_ARM', 'XMAC_LOG', 'XMACHINES_UP_SECONDS',
    'XMACHINES_STATUS_FIXTURE', 'XMACHINES_TELEMETRY_FIXTURE', 'XMAC_CONF', 'XMAC_STATE',
    'XMAC_ARGV_SPY_LOG', 'XMAC_ARGV_SPY_REAL', 'PATH', 'FENCE_STUB',
  ];
  const prior = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  let app;
  let server;
  try {
    const captured = [];
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        captured.push({ url: req.url || '', body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
    delete process.env.TELEGRAM_API_BASE_URL;
    delete process.env.TELEGRAM_API_ROOT;
    delete process.env.XMACHINES_TELEGRAM_API_BASE;
    process.env.BOT_TOKEN = DECOY_BOT;
    process.env.AUTHORIZED_USER_ID = DECOY_CHAT;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_LOG = logPath;
    process.env.XMACHINES_UP_SECONDS = '100000000';
    process.env.XMACHINES_STATUS_FIXTURE = statusPath;
    delete process.env.XMACHINES_TELEMETRY_FIXTURE;
    process.env.XMAC_CONF = confPath;
    process.env.XMAC_STATE = stateDir;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    delete process.env.XMAC_ARGV_SPY_REAL;
    process.env.PATH = `${binDir}${path.delimiter}${prior.PATH || ''}`;
    delete process.env.FENCE_STUB;

    const { createApiServer } = await import(pathToFileURL(path.join(REPO_ROOT, 'src/api/server.ts')).href);
    app = await createApiServer(minimalConfig(), stubServices());
    const res = await app.inject({
      method: 'POST',
      url: `/api/xmachines/machines/${WIRE_MACHINE}/power/off`,
      headers: {
        authorization: `Bearer ${OWNER_TOKEN}`,
        host: HOST,
        origin: ORIGIN,
        'idempotency-key': 'd8-wire-key',
      },
    });
    let body = null;
    try { body = res.json(); } catch { body = null; }
    const spy = fs.existsSync(spyLog) ? fs.readFileSync(spyLog, 'utf8') : '';
    process.stdout.write(`D8-WIRE-JSON ${JSON.stringify({ httpStatus: res.statusCode, body, captured, spy })}\n`);
  } finally {
    await app?.close();
    if (server) {
      const closing = server;
      await new Promise((resolve) => closing.close(() => resolve()));
    }
    for (const key of envKeys) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function assertCapturedWire(payload) {
  if (payload.spy && payload.spy.trim() !== '') {
    fail(`power gateway was invoked during the capture probe: ${payload.spy.trim()}`);
  }
  const body = payload.body || {};
  if (payload.httpStatus === 202 || body.status === 'in-progress') {
    fail('capture probe actuated a power action');
  }
  if (payload.httpStatus !== 400 || body.reason !== 'force-confirmation-required' || typeof body.displayNumber !== 'number') {
    fail(`force-off confirm path did not issue a number match (${payload.httpStatus} ${JSON.stringify(body)})`);
  }
  const hits = (payload.captured || []).filter((row) => row.url === `/bot${BOT_TOKEN}/sendMessage`);
  if (hits.length !== 1) {
    fail(`outbound Telegram capture missing (sendMessage count=${hits.length})`);
  }
  const sent = hits[0].body || {};
  if (sent.chat_id !== OWNER_CHAT_ID) {
    fail(`captured Telegram chat_id ${JSON.stringify(sent.chat_id)} is not the configured owner`);
  }
  const text = typeof sent.text === 'string' ? sent.text : '';
  if (!text.includes(WIRE_PROMPT) || !text.includes(WIRE_MACHINE) || !text.includes(String(body.displayNumber))) {
    fail(`captured Telegram text did not carry the prompt, machine, and issued number: ${JSON.stringify(text)}`);
  }
  const labels = sent.reply_markup?.inline_keyboard?.flat?.().map((button) => button?.text) || [];
  if (!labels.includes(String(body.displayNumber))) {
    fail(`captured Telegram buttons omitted the issued number ${body.displayNumber}`);
  }
  if ((payload.captured || []).some((row) => String(row.url || '').includes(DECOY_BOT))) {
    fail('capture was addressed with the env decoy bot token');
  }
}

function assertOutboundCapture() {
  const child = spawnSync(process.execPath, [
    '--import', 'tsx', SELF, '--playwright', '--capture-telegram-update', '--drive-wire',
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 90_000,
    env: process.env,
  });
  if (child.error) fail(`telegram capture driver failed to start: ${child.error.message}`);
  const line = String(child.stdout || '').split('\n').find((row) => row.startsWith('D8-WIRE-JSON '));
  if (child.status !== 0 || !line) {
    const detail = `${child.stderr || ''}\n${child.stdout || ''}`.trim();
    fail(`telegram capture driver exited ${child.status}: ${detail.slice(0, 800)}`);
  }
  let payload;
  try {
    payload = JSON.parse(line.slice('D8-WIRE-JSON '.length));
  } catch {
    fail('telegram capture driver returned malformed evidence');
  }
  assertCapturedWire(payload);
  console.log(`[D8-E2E] captured production sendMessage for ${WIRE_MACHINE} number=${payload.body.displayNumber}`);
}

if (driveWire) {
  driveWireCapture().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
} else if (!hasPlaywright) {
  fail('Missing --playwright flag');
} else {
  assertRenderedForceField()
    .then(() => {
      if (!captureTelegram) fail('outbound Telegram capture was not requested');
      assertOutboundCapture();
    })
    .catch((error) => {
      if (error && error.code === 'ERR_ASSERT') fail(error.message);
      console.error(error && error.stack ? error.stack : error);
      process.exit(1);
    });
}
