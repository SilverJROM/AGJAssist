import { describe, it, expect, beforeEach } from 'vitest';
import { ReadOnlyCollector } from '../../src/services/xmachines/readonly-collector.js';

describe('xmachines-ups-telemetry', () => {
  it('parses NUT battery, runtime and load when data exists', () => {
    const collector = new ReadOnlyCollector({
      readSmart() { return { health: '', availability: 'ok', freshness: 'fresh' }; },
      readNut() { return { battery: 'battery.charge: 100\nbattery.runtime: 3600\nups.load: 25', availability: 'ok', freshness: 'fresh' }; }
    });
    const reading = collector.readNut('hdd');
    expect(reading.availability).toBe('ok');
    expect(reading.battery).toContain('battery.charge: 100');
    expect(reading.battery).toContain('battery.runtime: 3600');
    expect(reading.battery).toContain('ups.load: 25');
  });

  it('represents absent UPS source as unavailable', () => {
    const collector = new ReadOnlyCollector({
      readSmart() { return { health: '', availability: 'ok', freshness: 'fresh' }; },
      readNut() { return { battery: '', availability: 'unavailable', freshness: 'stale' }; }
    });
    const reading = collector.readNut('hdd');
    expect(reading.availability).toBe('unavailable');
    expect(reading.battery).toBe('');
  });
});
