import { describe, it, expect } from 'vitest';
import { computeAggregates, isExpired, parseAgeSeconds, withFreshness } from '../../src/services/xmachines/freshness-aggregates.js';
import type { MachineTelemetry } from '../../src/services/xmachines/telemetry.js';

const fleet: MachineTelemetry[] = [
  { name: 'gpu', state: 'up', cpuTemp: 41, gpuTemp: 52, powerWatts: 120, uptime: '1d', provenance: 'measured', sampleAge: '30s' },
  { name: 'hdd', state: 'up', cpuTemp: 36, gpuTemp: 33, powerWatts: 90, uptime: '2d', provenance: 'measured', sampleAge: '400s' },
  { name: 'gpu2', state: 'down', cpuTemp: 44, gpuTemp: 61, powerWatts: 200, uptime: '0', provenance: 'estimated', sampleAge: '10s' },
];

describe('freshness aggregates', () => {
  it('L13e max GPU temperature is maximum current GPU temperature', () => {
    const aggs = computeAggregates(fleet);
    expect(aggs.maxGpuTemp).toBe(52);
  });

  it('L13f aggregate GPU power is sum of measured GPU watts only', () => {
    const aggs = computeAggregates(fleet);
    expect(aggs.sumPowerWatts).toBe(210);
  });

  it('L13a sample age renders and L13b provenance renders', () => {
    const enriched = withFreshness(fleet);
    expect(enriched[0].sampleAge).toBe('30s');
    expect(enriched[0].provenance).toBe('measured');
  });

  it('L13c expired readings are identified', () => {
    expect(isExpired('400s')).toBe(true);
    expect(isExpired('30s')).toBe(false);
  });

  it('parseAgeSeconds returns Infinity for bad format', () => {
    expect(parseAgeSeconds('')).toBe(Infinity);
    expect(parseAgeSeconds('bad')).toBe(Infinity);
  });
});
