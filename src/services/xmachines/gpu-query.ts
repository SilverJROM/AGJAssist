import { spawnSync } from 'node:child_process';

// One nvidia-smi invocation per poll. Reconciliation and edge states stay on B15/B16.
const GPU_QUERY_TIMEOUT_MS = 8000;
const GPU_QUERY_ARGS = [
  '--query-gpu=uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,fan.speed',
  '--format=csv,noheader,nounits',
] as const;

export interface GpuReading {
  uuid: string;
  name: string;
  utilizationGpu: number;
  memoryUsedMiB: number;
  memoryTotalMiB: number;
  temperatureC: number;
  powerDrawW: number;
  fanSpeedPct: number;
}

export interface GpuQueryResult {
  machine: string;
  timedOut: boolean;
  byUuid: Record<string, GpuReading>;
}

function parseGpuLine(line: string): GpuReading | null {
  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 8 || parts[0] === '') return null;
  return {
    uuid: parts[0],
    name: parts[1],
    utilizationGpu: Number(parts[2]),
    memoryUsedMiB: Number(parts[3]),
    memoryTotalMiB: Number(parts[4]),
    temperatureC: Number(parts[5]),
    powerDrawW: Number(parts[6]),
    fanSpeedPct: Number(parts[7]),
  };
}

// Queries one machine once. The machine names the poll; the process is nvidia-smi.
export function queryMachineGpus(machine: string): GpuQueryResult {
  const result = spawnSync('nvidia-smi', [...GPU_QUERY_ARGS], {
    timeout: GPU_QUERY_TIMEOUT_MS,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const err = result.error as NodeJS.ErrnoException | undefined;
  const timedOut = err?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
  if (timedOut) {
    return { machine, timedOut: true, byUuid: {} };
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const byUuid: Record<string, GpuReading> = {};
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const reading = parseGpuLine(line);
    if (!reading) continue;
    byUuid[reading.uuid] = reading;
  }
  return { machine, timedOut: false, byUuid };
}
