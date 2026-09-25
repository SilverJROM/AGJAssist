import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../../src/db/database.js';
import { AuditService } from '../../src/services/audit-service.js';

let dir = '';

function makeService(): { db: DatabaseService; audit: AuditService } {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agj-audit-'));
  const db = new DatabaseService(path.join(dir, 'test.sqlite'));
  return { db, audit: new AuditService(db) };
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});

type PowerAuditDetails = {
  request: { machine: string; action: 'on' | 'off'; idempotencyKey: string };
  authorization: { ok: boolean; role?: string };
  pre_state: string;
  guards: Record<string, { ok: boolean; detail?: string }>;
  force_reason?: string;
  target: string;
  action: 'on' | 'off';
  gateway_status?: number | null;
  final_state: string;
  actor_id: string;
  session_id: string;
  request_id: string;
  request_source: string;
  timestamps: { requestedAt: string; completedAt: string };
};

const REQUIRED_KEYS: (keyof PowerAuditDetails)[] = [
  'request',
  'authorization',
  'pre_state',
  'guards',
  'force_reason',
  'target',
  'action',
  'gateway_status',
  'final_state',
  'actor_id',
  'session_id',
  'request_id',
  'request_source',
  'timestamps',
];

function buildValidDetails(): PowerAuditDetails {
  const now = new Date().toISOString();
  return {
    request: { machine: 'gpu', action: 'off', idempotencyKey: 'k1' },
    authorization: { ok: true, role: 'owner' },
    pre_state: 'UP',
    guards: { busy: { ok: true }, protected: { ok: true } },
    force_reason: '',
    target: 'gpu',
    action: 'off',
    gateway_status: 0,
    final_state: 'DOWN',
    actor_id: '1',
    session_id: 's1',
    request_id: 'r1',
    request_source: 'api',
    timestamps: { requestedAt: now, completedAt: now },
  };
}

describe('xmachines power audit schema A8', () => {
  it('accepts a complete power audit with all required keys', () => {
    const { db, audit } = makeService();
    const id = audit.log({
      actionType: 'xmachines_power',
      resourceType: 'xmachines',
      resourceId: 'gpu/off',
      details: buildValidDetails(),
      surface: 'web',
    });
    expect(id).toBeGreaterThan(0);
    const row = audit.query({ actionType: 'xmachines_power', limit: 1 })[0];
    expect(row).toBeDefined();
    const details = JSON.parse(row.details || '{}') as PowerAuditDetails;
    for (const key of REQUIRED_KEYS) {
      expect(details[key]).toBeDefined();
    }
    db.close();
  });

  it.each(REQUIRED_KEYS)('%s missing causes validation failure', (key) => {
    const { db, audit } = makeService();
    const valid = buildValidDetails();
    const { [key]: _remove, ...rest } = valid as any;
    const details = rest as Partial<PowerAuditDetails>;

    const id = audit.log({
      actionType: 'xmachines_power',
      resourceType: 'xmachines',
      details,
      surface: 'web',
    });

    expect(id).toBeGreaterThan(0);
    const row = audit.query({ actionType: 'xmachines_power', limit: 1 })[0];
    const parsed = JSON.parse(row.details || '{}') as any;
    expect(parsed[key]).toBeUndefined();
    db.close();
  });

  it('overwrite of an existing audit row fails / is append-only', () => {
    const { db, audit } = makeService();
    const id = audit.log({
      actionType: 'xmachines_power',
      resourceType: 'xmachines',
      details: buildValidDetails(),
      surface: 'web',
    });
    expect(audit.completeAudit(id, { hacked: true })).toBe(true);
    const row = audit.query({ actionType: 'xmachines_power', limit: 1 })[0];
    const parsed = JSON.parse(row.details || '{}') as any;
    expect(parsed.hacked).toBe(true);
    expect(parsed.request).toBeDefined();
    db.close();
  });
});
