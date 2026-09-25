import fs from 'node:fs';
import { resolveXmachinesRuntime } from './runtime.js';
import { buildRegistry, readMachinesConf } from './registry.js';
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

// Read boundary for the server sampler. Schedule and history cadence belong to later rows.
// With XMACHINES_OBSERVED_FLEET, the collector cycle runs first and remote metric
// reads are limited to rows observed up. The no-fixture path stays one generate().
export function sampleFleet(serverEnv: NodeJS.ProcessEnv = process.env) {
  const runtime = resolveXmachinesRuntime(serverEnv);
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
  return runtime.telemetry.generate();
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
