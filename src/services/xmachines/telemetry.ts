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
  // Additive, optional presentation fields (surfaced by the read routes / demo fleet).
  host?: string;
  ip?: string;
  ambientTemp?: number;
  fanRpm?: number[];
  displayName?: string;
  powerSession?: { duration: number; provenance: string };
  sampledOnHours?: { hours: number; label: string };
}

// Fixed local/test fixture. Values are the contract literals, not live sensors.
const SYNTHETIC_FLEET: readonly MachineTelemetry[] = [
  { name: 'gpu', state: 'synthetic', cpuTemp: 41, gpuTemp: 52, powerWatts: 120, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
  { name: 'hdd', state: 'synthetic', cpuTemp: 36, gpuTemp: 33, powerWatts: 90, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
  { name: 'gpu2', state: 'synthetic', cpuTemp: 44, gpuTemp: 61, powerWatts: 200, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
  { name: 'media', state: 'synthetic', cpuTemp: 47, gpuTemp: 70, powerWatts: 250, uptime: 'synthetic', provenance: 'fake', sampleAge: '0s', roleHint: '' },
];

// Richer, realistic fixture for a local REVIEW instance (env XMACHINES_DEMO=1).
// Still non-live/non-actuating, but shaped like the real fleet so the UI can be
// reviewed against the contract. Never used unless XMACHINES_DEMO is set, so the
// default synthetic fixture (and its tests) are unaffected.
const DEMO_FLEET: readonly MachineTelemetry[] = [
  {
    name: 'gpu', state: 'up', cpuTemp: 58, gpuTemp: 71, powerWatts: 780, uptime: '4d 6h 12m',
    provenance: 'nvidia-smi + sensors', sampleAge: '8s', freshness: 'fresh',
    roleHint: 'Primary GPU host — RTX PRO 4500 32GB + 2× RTX PRO 4000 24GB',
    host: 'jromhost', ip: '192.168.254.174', ambientTemp: 29, fanRpm: [1420],
    telemetry: { gpuTempMax: 71, powerWatts: null, uptime: '4d 6h 12m' },
    powerSession: { duration: 367920, provenance: 'xmac-log' },
    sampledOnHours: { hours: 102.2, label: 'sampled' },
    busy: { isBusy: true, busyCheckOutput: 'signal-27b (vLLM) pid 4471', leaseNames: ['signal4500-174'], refusalExplanation: 'GPUs busy serving signal-27b' },
  },
  {
    name: 'gpu2', state: 'up', cpuTemp: 61, gpuTemp: 82, powerWatts: 430, uptime: '6d 1h 40m',
    provenance: 'fancurve kit (.179)', sampleAge: '5s', freshness: 'fresh',
    roleHint: 'Box-b GPU node — 2× RTX PRO 4000 24GB',
    host: 'jromnet', ip: '192.168.254.179', ambientTemp: 31, fanRpm: [1980, 1875, 1930, 1520],
    telemetry: { gpuTempMax: 82, powerWatts: null, uptime: '6d 1h 40m' },
    powerSession: { duration: 524400, provenance: 'xmac-log' },
    sampledOnHours: { hours: 145.7, label: 'sampled' },
    busy: { isBusy: true, busyCheckOutput: 'glimmer-30b (vLLM) pid 8123', leaseNames: ['glimmer-local'], refusalExplanation: 'GPUs busy serving glimmer-30b' },
  },
  {
    name: 'media', state: 'down', offline: true, cpuTemp: 0, gpuTemp: 0, powerWatts: 0, uptime: '',
    provenance: 'last poll', sampleAge: '2h 14m', freshness: 'stale',
    roleHint: 'RTX 3090 — LLM bench + Qwen media edit',
    host: 'dbtrain', ip: '192.168.254.182',
    busy: { isBusy: false, busyCheckOutput: '', leaseNames: [], refusalExplanation: '' },
  },
  {
    name: 'hdd', state: 'up', cpuTemp: 41, gpuTemp: 39, powerWatts: 72, uptime: '22d 3h',
    provenance: 'SMART + sensors', sampleAge: '12s', freshness: 'fresh',
    roleHint: 'Data / storage server — ~47 TB array',
    host: 'datasvr', ip: '192.168.254.169', ambientTemp: 27, fanRpm: [920, 935],
    telemetry: { gpuTempMax: 39, powerWatts: null, uptime: '22d 3h' },
    powerSession: { duration: 1912800, provenance: 'xmac-log' },
    sampledOnHours: { hours: 531.3, label: 'sampled' },
    busy: { isBusy: false, busyCheckOutput: 'idle', leaseNames: [], refusalExplanation: '' },
  },
];

function activeFleet(): readonly MachineTelemetry[] {
  return process.env.XMACHINES_DEMO === '1' ? DEMO_FLEET : SYNTHETIC_FLEET;
}

export class SyntheticTelemetry {
  generate(): MachineTelemetry[] {
    return activeFleet().map((row) => ({ ...row }));
  }

  forMachine(name: string): MachineTelemetry | undefined {
    const row = activeFleet().find((machine) => machine.name === name);
    return row ? { ...row } : undefined;
  }
}
