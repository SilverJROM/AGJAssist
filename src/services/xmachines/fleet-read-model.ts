import fs from 'node:fs';
import { buildBusyDetail } from './busy-detail.js';
import { estimateMachinePower } from './power-estimate.js';
import { buildRegistry } from './registry.js';
import type { MachineTelemetry } from './telemetry.js';

interface MetricFixtureRow {
  gpuTempsC?: number[];
  gpuPowerWatts?: number[];
  gpuUtil?: number[];
  uptime?: string;
  freshness?: string;
  provenance?: string;
  sampleAge?: string;
  cpuTemp?: number;
  boardTemp?: number;
  cpuWatts?: number;
  fanRpm?: number[];
  fans?: Array<{ header?: string; dutyPct?: number | null; rpm?: number | null; mode?: string }>;
  fancurveActive?: boolean;
}

function readMetricFixture(file: string | undefined): Record<string, MetricFixtureRow> {
  const trimmed = file?.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(fs.readFileSync(trimmed, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, MetricFixtureRow>;
}

function finiteNumbers(values: number[] | undefined): number[] {
  if (!values) return [];
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value));
}

function maxGpuTemp(values: number[] | undefined): number | null {
  const nums = finiteNumbers(values);
  if (nums.length === 0) return null;
  return Math.max(...nums);
}

// A GPU counts as busy when it is actively computing (util) or clearly loaded
// (power well above idle). Arrays are index-aligned per GPU; a missing signal on
// one axis can still be caught by the other.
const GPU_BUSY_UTIL_PCT = 15;
const GPU_BUSY_WATTS = 60;
function countBusyGpus(utils: number[] | undefined, powers: number[] | undefined): number {
  const u = finiteNumbers(utils);
  const p = finiteNumbers(powers);
  const n = Math.max(u.length, p.length);
  let busy = 0;
  for (let i = 0; i < n; i += 1) {
    const util = u[i];
    const watts = p[i];
    if ((typeof util === 'number' && util >= GPU_BUSY_UTIL_PCT) || (typeof watts === 'number' && watts >= GPU_BUSY_WATTS)) {
      busy += 1;
    }
  }
  return busy;
}

function aggregateGpuWatts(values: number[] | undefined): number | null {
  const readings = finiteNumbers(values).map((powerDrawW) => ({ powerDrawW }));
  if (readings.length === 0) return null;
  return estimateMachinePower({
    machine: 'read-model',
    gpuReadings: readings,
    baselineWatts: 0,
  }).gpuWatts;
}

function toReadModel(
  machine: { name: string; state: string; roleHint?: string },
  row: MetricFixtureRow | undefined,
): MachineTelemetry {
  const state: MachineTelemetry['state'] = machine.state === 'up' ? 'up' : 'down';
  const offline = state !== 'up';
  const metric = row ?? {};
  const gpuTempMax = offline ? null : maxGpuTemp(metric.gpuTempsC);
  const powerWatts = offline ? null : aggregateGpuWatts(metric.gpuPowerWatts);
  // How many GPUs actually answered the poll — the overview's "GPUs working" signal.
  const gpuCount = offline
    ? 0
    : (finiteNumbers(metric.gpuTempsC).length || finiteNumbers(metric.gpuPowerWatts).length);
  const gpusBusy = offline ? 0 : countBusyGpus(metric.gpuUtil, metric.gpuPowerWatts);
  const uptime = offline ? null : (typeof metric.uptime === 'string' && metric.uptime ? metric.uptime : null);
  const busy = buildBusyDetail(machine.name);
  const provenance = typeof metric.provenance === 'string' && metric.provenance
    ? metric.provenance
    : 'xmac-registry';
  return {
    name: machine.name,
    state,
    cpuTemp: typeof metric.cpuTemp === 'number' && Number.isFinite(metric.cpuTemp) ? metric.cpuTemp : 0,
    gpuTemp: gpuTempMax ?? 0,
    gpuCount,
    gpusBusy,
    powerWatts: powerWatts ?? 0,
    uptime: uptime ?? '',
    provenance,
    sampleAge: typeof metric.sampleAge === 'string' ? metric.sampleAge : '',
    roleHint: machine.roleHint ?? '',
    offline,
    freshness: typeof metric.freshness === 'string' ? metric.freshness : '',
    ...(offline ? {} : {
      ...(typeof metric.cpuWatts === 'number' && Number.isFinite(metric.cpuWatts) ? { cpuWatts: metric.cpuWatts } : {}),
      ...(typeof metric.boardTemp === 'number' && Number.isFinite(metric.boardTemp) ? { boardTemp: metric.boardTemp } : {}),
      ...(Array.isArray(metric.fanRpm) ? { fanRpm: metric.fanRpm } : {}),
      ...(Array.isArray(metric.fans) ? { fans: metric.fans } : {}),
      ...(typeof metric.fancurveActive === 'boolean' ? { fancurveActive: metric.fancurveActive } : {}),
    }),
    telemetry: {
      gpuTempMax,
      powerWatts,
      uptime,
    },
    busy: {
      busyCheckOutput: busy.busyCheckOutput,
      leaseNames: busy.leaseNames,
      isBusy: busy.isBusy,
      refusalExplanation: busy.refusalExplanation,
    },
  };
}

// xmac `status` text at XMACHINES_STATUS_FIXTURE. Unset keeps the collector default.
export function registryFleetFromEnv(env: NodeJS.ProcessEnv): MachineTelemetry[] | null {
  const statusPath = env.XMACHINES_STATUS_FIXTURE?.trim();
  if (!statusPath) return null;
  const statusOutput = fs.readFileSync(statusPath, 'utf8');
  const registry = buildRegistry(statusOutput, env.XMAC_CONF);
  const metrics = readMetricFixture(env.XMACHINES_TELEMETRY_FIXTURE);
  return registry.map((machine) => toReadModel(machine, metrics[machine.name]));
}
