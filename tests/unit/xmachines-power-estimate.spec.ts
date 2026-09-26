import { describe, it, expect } from 'vitest';
import { estimateMachinePower } from '../../src/services/xmachines/power-estimate.js';

describe('xmachines power estimate', () => {
  it('G1a GPU power uses measured nvidia-smi power draw', () => {
    const out = estimateMachinePower({
      machine: 'gpu',
      gpuReadings: [{ powerDrawW: 150 }, { powerDrawW: 120 }],
      baselineWatts: 45,
    });
    expect(out.gpuWatts).toBe(270);
    expect(out.gpuProvenance).toBe('measured');
  });

  it('G1b CPU package power contributes to estimate when exposed', () => {
    const outNoCpu = estimateMachinePower({
      machine: 'gpu',
      gpuReadings: [{ powerDrawW: 100 }],
      baselineWatts: 30,
    });
    const outWithCpu = estimateMachinePower({
      machine: 'gpu',
      gpuReadings: [{ powerDrawW: 100 }],
      cpuPackageWatts: 65,
      baselineWatts: 30,
    });
    expect(outWithCpu.nonGpuWatts).toBeGreaterThan(outNoCpu.nonGpuWatts);
    expect(outWithCpu.nonGpuProvenance).toBe('estimated');
  });

  it('G1c configured per-box baseline contributes to estimate', () => {
    const out1 = estimateMachinePower({
      machine: 'media',
      gpuReadings: [{ powerDrawW: 200 }],
      baselineWatts: 40,
    });
    const out2 = estimateMachinePower({
      machine: 'media',
      gpuReadings: [{ powerDrawW: 200 }],
      baselineWatts: 80,
    });
    expect(out2.nonGpuWatts).toBe(out1.nonGpuWatts + 40);
  });

  it('G1d estimated wall draw applies 0.9 PSU efficiency', () => {
    const out = estimateMachinePower({
      machine: 'hdd',
      gpuReadings: [],
      cpuPackageWatts: 30,
      baselineWatts: 60,
      psuEfficiency: 0.9,
    });
    // total internal = 90
    expect(out.totalInternalWatts).toBe(90);
    expect(out.wallWatts).toBeCloseTo(100);
    expect(out.wallProvenance).toBe('estimated');
  });

  it('G1e measured GPU watts and estimated non-GPU watts retain distinct provenance', () => {
    const out = estimateMachinePower({
      machine: 'gpu2',
      gpuReadings: [{ powerDrawW: 180 }],
      cpuPackageWatts: 70,
      baselineWatts: 50,
    });
    expect(out.gpuProvenance).toBe('measured');
    expect(out.nonGpuProvenance).toBe('estimated');
  });

  it('G2a machine without wall meter still shows best estimate', () => {
    const out = estimateMachinePower({
      machine: 'gpu',
      gpuReadings: [{ powerDrawW: 120 }],
      baselineWatts: 45,
    });
    expect(out.wallProvenance).toBe('estimated');
    expect(out.wallWatts).toBeGreaterThan(0);
  });

  it('G2b measured-source fixture replaces estimate without changing UI contract', () => {
    const estimated = estimateMachinePower({
      machine: 'gpu',
      gpuReadings: [{ powerDrawW: 120 }],
      baselineWatts: 45,
    });
    const measured = estimateMachinePower({
      machine: 'gpu',
      gpuReadings: [{ powerDrawW: 120 }],
      baselineWatts: 45,
      measuredWallWatts: 220,
    });
    expect(estimated.wallProvenance).toBe('estimated');
    expect(measured.wallProvenance).toBe('measured');
    expect(measured.wallWatts).toBe(220);
    // GPU and non-GPU components unchanged
    expect(measured.gpuWatts).toBe(estimated.gpuWatts);
    expect(measured.nonGpuWatts).toBe(estimated.nonGpuWatts);
  });
});
