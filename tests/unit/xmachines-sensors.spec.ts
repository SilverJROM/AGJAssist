import { describe, it, expect } from 'vitest';
import { parseLmSensorsOutput } from '../../src/services/xmachines/sensors.js';

describe('xmachines lm-sensors parser', () => {
  it('discovers CPU temps from bounded output', () => {
    const sample = `
coretemp-isa-0000
Adapter: ISA adapter
Package id 0:  +45.0°C  (high = +80.0°C, crit = +100.0°C)
Core 0:        +43.0°C  (high = +80.0°C, crit = +100.0°C)
Core 1:        +44.5°C
`;
    const result = parseLmSensorsOutput(sample);
    expect(result.cpuTemps).toEqual([45, 43, 44.5]);
    expect(result.fanRPMs).toEqual([]);
  });

  it('discovers fan RPMs and CPU temps together', () => {
    const sample = `
nct6779-isa-0060
Adapter: ISA adapter
fan1:         1200 RPM
fan2:         1350 RPM
Tctl:         +52.0°C
`;
    const result = parseLmSensorsOutput(sample);
    expect(result.cpuTemps).toEqual([52]);
    expect(result.fanRPMs).toEqual([1200, 1350]);
  });

  it('represents absent fans without fabricated values', () => {
    const sample = `
coretemp-isa-0000
Adapter: ISA adapter
Package id 0:  +48.0°C
`;
    const result = parseLmSensorsOutput(sample);
    expect(result.cpuTemps).toEqual([48]);
    expect(result.fanRPMs).toEqual([]);
  });

  it('ignores absent sensors gracefully', () => {
    const sample = `
No sensors found.
`;
    const result = parseLmSensorsOutput(sample);
    expect(result.cpuTemps).toEqual([]);
    expect(result.fanRPMs).toEqual([]);
  });
});
