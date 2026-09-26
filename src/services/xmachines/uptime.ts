import fs from 'node:fs';
import os from 'node:os';

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

export interface UptimeDetail {
  uptime: string;
  provenance: 'os' | 'unknown';
  powerSession?: PowerSession;
  sampledOnHours?: SampledOnHours;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
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
  return detail;
}

export function readBootIdentity(): BootIdentity {
  const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const upSeconds = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0]);
  return { bootId, upSeconds };
}
