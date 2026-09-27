export interface GpuPowerReading {
  powerDrawW: number;
}

export interface PowerEstimateInput {
  machine: string;
  gpuReadings: readonly GpuPowerReading[];
  cpuPackageWatts?: number;
  baselineWatts: number;
  measuredWallWatts?: number;
  psuEfficiency?: number;
}

export interface PowerEstimateOutput {
  gpuWatts: number;
  gpuProvenance: 'measured';
  nonGpuWatts: number;
  nonGpuProvenance: 'estimated';
  totalInternalWatts: number;
  wallWatts: number;
  wallProvenance: 'measured' | 'estimated';
  machine: string;
}

const DEFAULT_PSU_EFFICIENCY = 0.9;

export function estimateMachinePower(input: PowerEstimateInput): PowerEstimateOutput {
  const gpuWatts = input.gpuReadings.reduce((sum, r) => sum + (Number.isFinite(r.powerDrawW) ? r.powerDrawW : 0), 0);

  const cpu = Number.isFinite(input.cpuPackageWatts) ? input.cpuPackageWatts! : 0;
  const nonGpuWatts = cpu + input.baselineWatts;

  const totalInternalWatts = gpuWatts + nonGpuWatts;

  const psu = input.psuEfficiency;
  const efficiency = typeof psu === "number" && Number.isFinite(psu) && psu > 0 ? psu : DEFAULT_PSU_EFFICIENCY;

  let wallWatts: number;
  let wallProvenance: 'measured' | 'estimated';

  if (Number.isFinite(input.measuredWallWatts)) {
    wallWatts = input.measuredWallWatts!;
    wallProvenance = 'measured';
  } else {
    wallWatts = totalInternalWatts / efficiency;
    wallProvenance = 'estimated';
  }

  return {
    machine: input.machine,
    gpuWatts,
    gpuProvenance: 'measured' as const,
    nonGpuWatts,
    nonGpuProvenance: 'estimated' as const,
    totalInternalWatts,
    wallWatts,
    wallProvenance,
  };
}
