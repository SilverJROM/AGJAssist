import { describe, it, expect, vi } from 'vitest';
import { ReadOnlyCollector } from '../../src/services/xmachines/readonly-collector.js';

describe('xmachines-disk-telemetry B9', () => {
  it('I2a SMART health read routes through collector', () => {
    const collector = new ReadOnlyCollector();
    let smartCalls = 0;
    collector.useReadSource({
      readSmart(machine) {
        smartCalls++;
        expect(machine).toBe('hdd');
        return { health: 'PASSED', availability: 'ok', freshness: 'fresh' };
      },
      readNut() {
        return { battery: '', availability: 'ok', freshness: 'fresh' };
      },
    });
    const reading = collector.readSmart('hdd');
    expect(reading.health).toBe('PASSED');
    expect(smartCalls).toBe(1);
  });

  it('I2b per-disk temperature placeholder', () => {
    const collector = new ReadOnlyCollector();
    collector.useReadSource({
      readSmart() { return { health: '', availability: 'ok', freshness: 'fresh' }; },
      readNut() { return { battery: '', availability: 'ok', freshness: 'fresh' }; },
    });
    expect(() => collector.readSmart('hdd')).not.toThrow();
  });

  it('I2c free space placeholder', () => {
    expect(true).toBe(true);
  });
});
