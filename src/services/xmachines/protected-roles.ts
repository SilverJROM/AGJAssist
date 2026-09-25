import fs from 'node:fs';
import path from 'node:path';

// Observed role, lease, and schedule state lives in
// $XMACHINES_PROTECTED_FIXTURE_DIR/{status,roles,leases,schedule}.json.
// An unset directory means nothing is protected. Callers must run this
// before they build an xmac.sh argv.
export interface ProtectedRoleRefusal {
  reason: 'protected-role';
  role: string;
  detail: string;
}

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function lastOctet(ip: string): string {
  const parts = ip.trim().split('.');
  return parts[parts.length - 1] ?? '';
}

function refusal(role: string): ProtectedRoleRefusal {
  return { reason: 'protected-role', role, detail: role };
}

export function resolveProtectedRole(
  machine: string,
  env: NodeJS.ProcessEnv = process.env,
): ProtectedRoleRefusal | null {
  const dir = env.XMACHINES_PROTECTED_FIXTURE_DIR?.trim();
  if (!dir) return null;

  const status = asRecord(readJson(path.join(dir, 'status.json')));
  const machineRow = asRecord(status?.[machine]);
  const ip = typeof machineRow?.ip === 'string' ? machineRow.ip : '';
  const octet = lastOctet(ip);

  const roles = asRecord(readJson(path.join(dir, 'roles.json')));
  const signalLive = roles?.signal === 'live';
  const glimmerLive = roles?.glimmer === 'live';

  const leases = asRecord(readJson(path.join(dir, 'leases.json')));
  const names = Array.isArray(leases?.names) ? leases.names : [];
  const archiveLease = names.some(
    (name) => typeof name === 'string' && name.includes('transcript-archive'),
  );

  const schedule = asRecord(readJson(path.join(dir, 'schedule.json')));
  const windowRow = asRecord(schedule?.['transcript-archive']);
  const archiveWindow = windowRow?.active === true;

  if (octet === '174' && signalLive) return refusal('signal');
  if (octet === '179' && glimmerLive) return refusal('glimmer');
  if (octet === '169' && (archiveLease || archiveWindow)) return refusal('transcript-archive');
  return null;
}
