import type { MachineTelemetry } from './telemetry.js';

export interface FleetAggregates {
  maxGpuTemp: number | null;
  sumPowerWatts: number;
}

const FRESHNESS_THRESHOLD_SEC = 300;

export function parseAgeSeconds(age: string): number {
  if (!age || typeof age !== 'string') return Infinity;
  const m = age.match(/^(\d+)s$/);
  if (!m) return Infinity;
  return parseInt(m[1], 10);
}

export function isExpired(sampleAge: string): boolean {
  return parseAgeSeconds(sampleAge) > FRESHNESS_THRESHOLD_SEC;
}

export function computeAggregates(machines: MachineTelemetry[]): FleetAggregates {
  const up = machines.filter(m => m.state === 'up' || m.state === 'synthetic');
  const temps = up.map(m => m.gpuTemp).filter(v => typeof v === 'number' && !Number.isNaN(v));
  const maxGpuTemp = temps.length ? Math.max(...temps) : null;
  const sumPowerWatts = up.reduce((sum, m) => sum + (typeof m.powerWatts === 'number' ? m.powerWatts : 0), 0);
  return { maxGpuTemp, sumPowerWatts };
}

export function withFreshness(machines: MachineTelemetry[]): MachineTelemetry[] {
  return machines.map(m => ({ ...m, sampleAge: m.sampleAge ?? '0s', provenance: m.provenance ?? 'unknown' }));
}
