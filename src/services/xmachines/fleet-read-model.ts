import fs from 'node:fs';
import { buildBusyDetail } from './busy-detail.js';
import { estimateMachinePower } from './power-estimate.js';
import { buildRegistry } from './registry.js';
import type { MachineTelemetry } from './telemetry.js';

interface MetricFixtureRow {
  gpuTempsC?: number[];
  gpuPowerWatts?: number[];
  uptime?: string;
  freshness?: string;
  provenance?: string;
  sampleAge?: string;
  cpuTemp?: number;
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
    powerWatts: powerWatts ?? 0,
    uptime: uptime ?? '',
    provenance,
    sampleAge: typeof metric.sampleAge === 'string' ? metric.sampleAge : '',
    roleHint: machine.roleHint ?? '',
    offline,
    freshness: typeof metric.freshness === 'string' ? metric.freshness : '',
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
