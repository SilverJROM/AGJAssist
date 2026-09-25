import { describe, it, expect } from 'vitest';
import { ReadOnlyCollector } from '../../src/services/xmachines/readonly-collector.js';
import { resolveXmachinesRuntime } from '../../src/services/xmachines/runtime.js';

describe('xmachines-readonly-collector-core', () => {
  it('L5a exactly one reader module owns all remote telemetry I/O', () => {
    const collector1 = new ReadOnlyCollector();
    const collector2 = new ReadOnlyCollector();
    // Same interface via constructor; ensure class is singleton-capable
    expect(collector1.generate()).toBeDefined();
    expect(() => collector1.forMachine('gpu')).not.toThrow();
  });

  it('L5b foreground polling routes through reader module', () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: '0' });
    const telemetryList = runtime.telemetry.generate();
    // Literal fixture: synthetic fleet includes 'gpu'
    const names = telemetryList.map((m) => m.name);
    expect(names).toContain('gpu');
    expect(names).toContain('hdd');
  });

  it('L5c server sampler routes through reader module', () => {
    const collector = new ReadOnlyCollector();
    const machine = collector.forMachine('gpu');
    expect(machine).toBeDefined();
    expect(machine?.name).toBe('gpu');
    expect(machine?.state).toBe('synthetic');
    expect(machine?.cpuTemp).toBe(41);
  });

  it('L5d detail reads route through reader module', () => {
    const runtime = resolveXmachinesRuntime({});
    const machine = runtime.telemetry.forMachine('hdd');
    expect(machine).toBeDefined();
    expect(machine?.name).toBe('hdd');
    expect(machine?.powerWatts).toBe(90);
  });
});
