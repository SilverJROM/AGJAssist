import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { AlertEvaluator } from '../../src/services/xmachines/alert-evaluator.js';
import { deliverDueXmachinesAlerts } from '../../src/services/xmachines/alert-delivery.js';

const OWNER_ID = 867530901;
const BOT_TOKEN = '424242:b12-owner-wire';
const MACHINE = 'rack-b12-owner';

describe('xmachines-alert-delivery-capture', () => {
  const prior = {
    TELEGRAM_API_BASE: process.env.TELEGRAM_API_BASE,
    TELEGRAM_API_BASE_URL: process.env.TELEGRAM_API_BASE_URL,
    TELEGRAM_API_ROOT: process.env.TELEGRAM_API_ROOT,
    XMACHINES_TELEGRAM_API_BASE: process.env.XMACHINES_TELEGRAM_API_BASE,
    BOT_TOKEN: process.env.BOT_TOKEN,
    AUTHORIZED_USER_ID: process.env.AUTHORIZED_USER_ID,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('delivers a due xmachines alert through the production sender to the configured owner', async () => {
    const captured: { url: string; body: { chat_id?: number; text?: string } | null }[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        let body: { chat_id?: number; text?: string } | null = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        captured.push({ url: req.url || '', body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
    delete process.env.TELEGRAM_API_BASE_URL;
    delete process.env.TELEGRAM_API_ROOT;
    delete process.env.XMACHINES_TELEGRAM_API_BASE;
    // Different from the config literals. A sender that reads the env instead
    // of config.telegram would address this identity.
    process.env.BOT_TOKEN = 'env-bot-not-the-owner-sender';
    process.env.AUTHORIZED_USER_ID = '555001';

    const config = {
      telegram: {
        authorizedUserId: OWNER_ID,
        botToken: BOT_TOKEN,
      },
    };
    const evaluator = new AlertEvaluator();
    const sample = { machine: MACHINE, t1: 92, t2: 92, cpu: 30, fan: 1500 };

    try {
      await deliverDueXmachinesAlerts(evaluator, [sample], config);
      await deliverDueXmachinesAlerts(evaluator, [sample], config);

      const hits = captured.filter((c) => c.url === `/bot${BOT_TOKEN}/sendMessage`);
      expect(hits).toHaveLength(1);
      expect(hits[0].body?.chat_id).toBe(OWNER_ID);
      expect(hits[0].body?.text).toBe(`[xmachines alert] ${MACHINE} thermal critical`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
