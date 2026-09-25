import fs from 'node:fs';
import { resolveXmachinesRuntime } from './runtime.js';
import type { MachineTelemetry } from './telemetry.js';

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
  }
  return runtime.telemetry.generate();
}
