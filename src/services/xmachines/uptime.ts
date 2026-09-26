import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BootIdentity {
  bootId: string;
  upSeconds: number;
}

export interface PowerSession {
  duration: number;
  provenance: string;
}

export interface SampledOnHours {
  hours: number;
  label: 'estimated';
}

export type WolSafetyStatus = 'verified' | 'never-verified' | 'stale';

export interface WolSafetyEvidence {
  lastWake: string | null;
  verifiedUp: string | null;
  status: WolSafetyStatus;
}

export interface WolSafetyView extends WolSafetyEvidence {
  warning: string | null;
}

export const WOL_UNVERIFIED_WARNING = 'Unverified machine may remain off';

export interface UptimeDetail {
  uptime: string;
  provenance: 'os' | 'unknown';
  powerSession?: PowerSession;
  sampledOnHours?: SampledOnHours;
  wolSafety?: WolSafetyEvidence;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

const LOG_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/;

export function deriveWolSafety(params: {
  machine: string;
  upSeconds: number;
  log: string;
  now?: Date;
}): WolSafetyEvidence {
  const now = params.now ?? new Date();
  const bootMs = now.getTime() - params.upSeconds * 1000;
  let lastWake: string | null = null;
  let lastUp: string | null = null;
  let lastWakeMs = Number.NEGATIVE_INFINITY;
  let lastUpMs = Number.NEGATIVE_INFINITY;
  for (const line of params.log.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3 || parts[2] !== params.machine) continue;
    const tsMatch = parts[0]?.match(LOG_TS);
    if (!tsMatch) continue;
    const ms = Date.parse(tsMatch[1]);
    if (!Number.isFinite(ms) || ms < bootMs) continue;
    if (parts[1] === 'WAKE' && ms >= lastWakeMs) {
      lastWakeMs = ms;
      lastWake = tsMatch[1];
    } else if (parts[1] === 'UP' && ms >= lastUpMs) {
      lastUpMs = ms;
      lastUp = tsMatch[1];
    }
  }
  if (!lastWake) {
    return { lastWake: null, verifiedUp: null, status: 'never-verified' };
  }
  if (!lastUp || lastUpMs <= lastWakeMs) {
    return { lastWake, verifiedUp: null, status: 'stale' };
  }
  return { lastWake, verifiedUp: lastUp, status: 'verified' };
}

export function presentWolSafety(evidence: WolSafetyEvidence): WolSafetyView {
  return {
    lastWake: evidence.lastWake,
    verifiedUp: evidence.verifiedUp,
    status: evidence.status,
    warning: evidence.status === 'verified' ? null : WOL_UNVERIFIED_WARNING,
  };
}

function bootUpSeconds(env: NodeJS.ProcessEnv): number {
  const raw = env.XMACHINES_UP_SECONDS?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  try {
    const up = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0] ?? '');
    return Number.isFinite(up) && up >= 0 ? up : 0;
  } catch {
    return 0;
  }
}

// Vitest must not read the live ~/.xmac log. A set XMAC_LOG is the fixture path.
export function resolveXmacLogPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof env.XMAC_LOG === 'string') {
    const trimmed = env.XMAC_LOG.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (env.VITEST || env.VITEST_WORKER_ID) return null;
  return path.join(os.homedir(), '.xmac', 'xmac.log');
}

export function readWolSafety(machine: string, env: NodeJS.ProcessEnv = process.env): WolSafetyEvidence | null {
  const logPath = resolveXmacLogPath(env);
  if (!logPath) return null;
  let log = '';
  try {
    log = fs.readFileSync(logPath, 'utf8');
  } catch {
    log = '';
  }
  return deriveWolSafety({ machine, upSeconds: bootUpSeconds(env), log });
}

function parseXmacLog(log: string, machine: string, upSeconds: number): { matched: boolean; duration?: number } {
  const lines = log.split('\n');
  let lastUp: { ts: Date; duration?: number } | null = null;
  const now = new Date();
  const bootTime = new Date(now.getTime() - upSeconds * 1000);
  for (const line of lines) {
    if (!line.includes(machine)) continue;
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
    if (!tsMatch) continue;
    const ts = new Date(tsMatch[1]);
    if (ts < bootTime) continue;
    const upMatch = line.match(/ UP \w+ (\d+)s/);
    if (upMatch) {
      lastUp = { ts, duration: parseInt(upMatch[1], 10) };
    }
  }
  if (lastUp) {
    return { matched: true, duration: lastUp.duration };
  }
  return { matched: false };
}

export function deriveUptimeDetail(params: { machine: string; bootId: string; upSeconds: number; log: string }): UptimeDetail {
  const uptimeStr = formatUptime(params.upSeconds);
  const parse = parseXmacLog(params.log, params.machine, params.upSeconds);
  const detail: UptimeDetail = {
    uptime: uptimeStr,
    provenance: 'os',
  };
  if (parse.matched && typeof parse.duration === 'number') {
    detail.powerSession = {
      duration: parse.duration,
      provenance: 'xmac-log',
    };
  }
  const sampledHours = params.upSeconds / 3600;
  detail.sampledOnHours = {
    hours: Math.round(sampledHours * 100) / 100,
    label: 'estimated',
  };
  detail.wolSafety = deriveWolSafety({
    machine: params.machine,
    upSeconds: params.upSeconds,
    log: params.log,
  });
  return detail;
}

export function readBootIdentity(): BootIdentity {
  const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const upSeconds = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0]);
  return { bootId, upSeconds };
}
