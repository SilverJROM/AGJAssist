import { describe, it, expect, vi } from 'vitest';
import { deliverAlerts } from '../../src/services/xmachines/alert-delivery.js';
import type { Alert } from '../../src/services/xmachines/alert-evaluator.js';
import http from 'node:http';

describe('xmachines-alert-delivery-capture', () => {
  it('delivers a due xmachines alert through production Telegram sender to owner destination and capture server receives actual outbound update', async () => {
    const captured: { url: string; body: any }[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        captured.push({ url: req.url || '', body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const apiBase = `http://127.0.0.1:${port}`;
    try {
      const alerts: Alert[] = [{ machine: 'gpu-test', type: 'thermal', level: 'warning' }];
      const chatId = 123456;
      const botToken = 'testtoken';
      const sent = await deliverAlerts(alerts, { chatId, botToken, apiBase });
      expect(sent).toBe(1);
      const hits = captured.filter((c) => /\/bot[^/]*\/sendMessage$/.test(c.url));
      expect(hits.length).toBeGreaterThanOrEqual(1);
      const body = hits[0].body;
      expect(body.chat_id).toBe(chatId);
      expect(String(body.text)).toContain('gpu-test');
      expect(String(body.text)).toContain('thermal');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
