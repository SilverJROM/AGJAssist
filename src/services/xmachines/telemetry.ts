export interface MachineReadTelemetry {
  gpuTempMax: number | null;
  powerWatts: number | null;
  uptime: string | null;
}

export interface MachineBusyRead {
  busyCheckOutput: string;
  leaseNames: string[];
  isBusy: boolean;
  refusalExplanation: string;
}

export interface MachineTelemetry {
  name: string;
  state: 'up' | 'down' | 'synthetic';
  cpuTemp: number;
  gpuTemp: number;
  powerWatts: number;
  uptime: string;
  provenance: string;
  sampleAge: string;
  roleHint?: string;
  offline?: boolean;
  freshness?: string;
  telemetry?: MachineReadTelemetry;
  busy?: MachineBusyRead;
}

// Fixed local/test fixture. Values are the contract literals, not live sensors.
const SYNTHETIC_FLEET: readonly MachineTelemetry[] = [
  { name: 'gpu', state: 'synthetic', cpuTemp: 41, gpuTemp: 52, powerWatts: 120, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
  { name: 'hdd', state: 'synthetic', cpuTemp: 36, gpuTemp: 33, powerWatts: 90, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
  { name: 'gpu2', state: 'synthetic', cpuTemp: 44, gpuTemp: 61, powerWatts: 200, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
  { name: 'media', state: 'synthetic', cpuTemp: 47, gpuTemp: 70, powerWatts: 250, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
];

export class SyntheticTelemetry {
  generate(): MachineTelemetry[] {
    return SYNTHETIC_FLEET.map((row) => ({ ...row }));
  }

  forMachine(name: string): MachineTelemetry | undefined {
    const row = SYNTHETIC_FLEET.find((machine) => machine.name === name);
    return row ? { ...row } : undefined;
  }
}
