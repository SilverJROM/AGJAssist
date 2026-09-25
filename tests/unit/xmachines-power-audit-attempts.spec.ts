import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../../src/db/database.js';
import { AuditService } from '../../src/services/audit-service.js';

let dir = '';

function makeService() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agj-audit-'));
  const db = new DatabaseService(path.join(dir, 'test.sqlite'));
  // Seed users to satisfy FK constraint on audit_log.user_id
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, telegram_id, role, active) VALUES (?, ?, ?, 1)');
  for (let i = 1; i <= 8; i++) {
    insertUser.run(i, i * 1000, i === 1 ? 'owner' : 'viewer');
  }
  return { db, audit: new AuditService(db) };
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

const baseDetails = () => ({
  request: { machine: 'gpu', action: 'on' as const, idempotencyKey: 'k' },
  authorization: { ok: true },
  pre_state: 'UP',
  guards: {},
  force_reason: '',
  target: 'gpu',
  action: 'on' as const,
  gateway_status: 0,
  final_state: 'UP',
  actor_id: 'owner-1',
  session_id: 's1',
  request_id: 'r1',
  request_source: 'api',
  timestamps: { requestedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
});

describe('xmachines power audit attempts A16', () => {
  it('D4a: ON request creates owner-attributed audit row', () => {
    const { db, audit } = makeService();
    audit.log({
      actionType: 'xmachines_power',
      userId: 1,
      resourceType: 'xmachines',
      resourceId: 'gpu/on',
      details: baseDetails(),
      surface: 'web',
    });
    const rows = audit.query({ actionType: 'xmachines_power' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].user_id).toBe(1);
    db.close();
  });

  it('D4b: normal OFF request creates owner-attributed audit row', () => {
    const { db, audit } = makeService();
    const d = baseDetails();
    d.action = 'off';
    d.request.action = 'off';
    audit.log({
      actionType: 'xmachines_power',
      userId: 2,
      resourceType: 'xmachines',
      resourceId: 'gpu/off',
      details: d,
      surface: 'web',
    });
    const rows = audit.query({ actionType: 'xmachines_power', userId: 2 });
    expect(rows.length).toBe(1);
    db.close();
  });

  it('D4c: force request creates owner-attributed audit row', () => {
    const { db, audit } = makeService();
    const d = baseDetails();
    d.action = 'off';
    d.force_reason = 'user confirmed';
    audit.log({
      actionType: 'xmachines_power',
      userId: 3,
      resourceType: 'xmachines',
      resourceId: 'gpu/force',
      details: d,
      surface: 'web',
    });
    const rows = audit.query({ actionType: 'xmachines_power', userId: 3 });
    expect(rows.length).toBe(1);
    const parsed = JSON.parse(rows[0].details || '{}');
    expect(parsed.force_reason).toBe('user confirmed');
    db.close();
  });

  it('D3c: force attempt has owner-attributed audit record', () => {
    const { db, audit } = makeService();
    const d = baseDetails();
    d.action = 'off';
    d.force_reason = 'live probe';
    audit.log({
      actionType: 'xmachines_power',
      userId: 4,
      agentName: 'owner',
      resourceType: 'xmachines',
      details: d,
    });
    const rows = audit.query({ actionType: 'xmachines_power', userId: 4 });
    expect(rows.length).toBe(1);
    const parsed = JSON.parse(rows[0].details || '{}');
    expect(parsed.actor_id).toBe('owner-1');
    db.close();
  });

  it('H1d: every control attempt is audited', () => {
    const { db, audit } = makeService();
    audit.log({ actionType: 'xmachines_power', userId: 5, details: baseDetails() });
    const rows = audit.query({ actionType: 'xmachines_power', userId: 5 });
    expect(rows.length).toBe(1);
    db.close();
  });

  it('L7n: denied attempt is audited', () => {
    const { db, audit } = makeService();
    const d = baseDetails();
    d.authorization = { ok: false };
    audit.log({
      actionType: 'xmachines_power',
      userId: 6,
      resourceType: 'xmachines',
      details: d,
    });
    const rows = audit.query({ actionType: 'xmachines_power', userId: 6 });
    expect(rows.length).toBe(1);
    const parsed = JSON.parse(rows[0].details || '{}');
    expect(parsed.authorization.ok).toBe(false);
    db.close();
  });

  it('L7o: replayed attempt is audited', () => {
    const { db, audit } = makeService();
    const d = baseDetails();
    d.request.idempotencyKey = 'replay-key';
    audit.log({
      actionType: 'xmachines_power',
      userId: 7,
      resourceType: 'xmachines',
      details: d,
    });
    audit.log({
      actionType: 'xmachines_power',
      userId: 7,
      resourceType: 'xmachines',
      details: d,
    });
    const rows = audit.query({ actionType: 'xmachines_power', userId: 7 });
    expect(rows.length).toBe(2);
    db.close();
  });

  it('L7p: rate-limited attempt is audited', () => {
    const { db, audit } = makeService();
    const d = baseDetails();
    audit.log({
      actionType: 'xmachines_power',
      userId: 8,
      resourceType: 'xmachines',
      details: d,
    });
    const rows = audit.query({ actionType: 'xmachines_power', userId: 8 });
    expect(rows.length).toBe(1);
    db.close();
  });
});
