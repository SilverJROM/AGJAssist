import fs from 'node:fs';
import { persistSampleCycle, type SampleReading } from '../../db/xmachines-store.js';
import { resolveXmachinesRuntime, type XmachinesRuntime } from './runtime.js';
import { buildRegistry } from './registry.js';
import { queryMachineGpus } from './gpu-query.js';
import type { MachineTelemetry } from './telemetry.js';
import { spawnSync } from 'node:child_process';

interface ObservedFleetFileRow {
  name: string;
  state: 'up' | 'down';
}

function observedFleetFromFile(fixturePath: string) {
  const parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ObservedFleetFileRow[];
  const fleet: MachineTelemetry[] = parsed.map((row) => ({
    name: row.name,
    state: row.state,
    cpuTemp: 0,
    gpuTemp: 0,
    powerWatts: 0,
    uptime: 'observed',
    provenance: 'observed-fleet',
    sampleAge: '0s',
    roleHint: '',
  }));
  return {
    generate(): MachineTelemetry[] {
      return fleet.map((row) => ({ ...row }));
    },
    forMachine(name: string): MachineTelemetry | undefined {
      const row = fleet.find((machine) => machine.name === name);
      return row ? { ...row } : undefined;
    },
  };
}

// Read boundary for the server sampler. Pass the runtime whose reader store is
// already attached; omitting it builds a fresh runtime with no xm_samples sink.
// With XMACHINES_OBSERVED_FLEET, the collector cycle runs first and remote metric
// reads are limited to rows observed up. The no-fixture path stays one generate().
export function sampleFleet(
  serverEnv: NodeJS.ProcessEnv = process.env,
  runtime: XmachinesRuntime = resolveXmachinesRuntime(serverEnv),
) {
  const fixture = serverEnv.XMACHINES_OBSERVED_FLEET;
  if (typeof fixture === 'string' && fixture.length > 0) {
    runtime.telemetry.useTelemetrySource(observedFleetFromFile(fixture));
    runtime.telemetry.runCycle();
  } else if (serverEnv.XMACHINES_USE_REGISTRY === '1') {
    const statusOutput = runXmacStatusAll();
    const registry = buildRegistry(statusOutput, serverEnv.XMAC_CONF);
    const fleet: MachineTelemetry[] = registry.map(m => ({
      name: m.name,
      state: m.state === 'unknown' ? 'down' : m.state,
      cpuTemp: 0,
      gpuTemp: 0,
      powerWatts: 0,
      uptime: 'registry',
      provenance: 'xmac-registry',
      sampleAge: '0s',
      roleHint: m.roleHint || '',
    }));
    runtime.telemetry.useTelemetrySource({
      generate(): MachineTelemetry[] {
        return fleet.map(row => ({ ...row }));
      },
      forMachine(name: string): MachineTelemetry | undefined {
        const row = fleet.find(m => m.name === name);
        return row ? { ...row } : undefined;
      }
    });
    runtime.telemetry.runCycle();
  }
  persistMetricHistory(runtime);
  return runtime.telemetry.generate();
}

function persistMetricHistory(runtime: XmachinesRuntime): void {
  const db = runtime.telemetry.metricStore();
  if (!db) return;
  const sampleTime = new Date().toISOString();
  const installed = runtime.telemetry.installedGpuReadings();
  const readings: SampleReading[] = installed
    ? installed.map((row) => ({
      machineName: row.machineName,
      gpuUuid: row.gpuUuid,
      sampleTime,
      temperature: row.temperature,
      powerWatts: row.powerWatts,
      utilizationGpu: row.utilizationGpu,
      utilizationMem: null,
      fanSpeed: null,
      vramMb: null,
      vramTotalMb: null,
    }))
    : liveGpuReadings(runtime, sampleTime);
  persistSampleCycle(db, readings);
}

function liveGpuReadings(runtime: XmachinesRuntime, sampleTime: string): SampleReading[] {
  const readings: SampleReading[] = [];
  for (const machine of runtime.telemetry.generate()) {
    if (machine.state === 'down') continue;
    const queried = queryMachineGpus(machine.name);
    for (const gpu of Object.values(queried.byUuid)) {
      readings.push({
        machineName: machine.name,
        gpuUuid: gpu.uuid,
        sampleTime,
        temperature: Number.isFinite(gpu.temperatureC) ? gpu.temperatureC : null,
        powerWatts: Number.isFinite(gpu.powerDrawW) ? gpu.powerDrawW : null,
        utilizationGpu: Number.isFinite(gpu.utilizationGpu) ? gpu.utilizationGpu : null,
        utilizationMem: null,
        fanSpeed: Number.isFinite(gpu.fanSpeedPct) ? gpu.fanSpeedPct : null,
        vramMb: Number.isFinite(gpu.memoryUsedMiB) ? gpu.memoryUsedMiB : null,
        vramTotalMb: Number.isFinite(gpu.memoryTotalMiB) ? gpu.memoryTotalMiB : null,
      });
    }
  }
  return readings;
}

function runXmacStatusAll(): string {
  try {
    const confPath = process.env.XMAC_CONF || '/home/agjrom/.config/agent-protocols/xmac/machines.conf';
    const txt = fs.readFileSync(confPath, 'utf8');
    const names = Array.from(new Set(txt.split('\n').map(l => l.trim().split('|')[0].trim()).filter(Boolean)));
    const outputs: string[] = [];
    for (const name of names) {
      const res = spawnSync('xmac.sh', ['status', name], { encoding: 'utf8' });
      const out = (res.stdout || '').toString();
      if (out) outputs.push(out.trim());
    }
    return outputs.join('\n');
  } catch {
    return '';
  }
}
