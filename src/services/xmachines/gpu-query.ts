import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// One nvidia-smi invocation per poll. Reconciliation and edge states stay on B15/B16.
const GPU_QUERY_TIMEOUT_MS = 8000;

// Resolve an ssh target (user@ip) for a machine from XMAC_CONF; null → query locally.
// The app host has no GPU, so armed prod points XMAC_CONF at machines.conf to reach
// the real fleet. Tests set no XMAC_CONF, so they keep the local nvidia-smi path.
function sshTargetFor(machine: string): string | null {
  const conf = process.env.XMAC_CONF?.trim();
  if (!conf) return null;
  try {
    for (const raw of fs.readFileSync(conf, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cols = line.split('|');
      if ((cols[0] ?? '').trim() === machine) {
        const ip = (cols[1] ?? '').trim();
        const user = ((cols[3] ?? '').trim()) || 'agjrom';
        if (ip) return `${user}@${ip}`;
      }
    }
  } catch {
    // fall through to local query
  }
  return null;
}
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
  stderr: string;
  exitStatus: number | null;
  errorCode: string | null;
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
// Operator pause list (~/.xmac/xm-poll-skip): machines we must not contact right now.
// Only consulted when an ssh target exists, so local/test paths are unaffected.
function isSkipped(machine: string): boolean {
  const home = process.env.HOME;
  if (!home) return false;
  try {
    return fs.readFileSync(`${home}/.xmac/xm-poll-skip`, 'utf8').split(/\s+/).filter(Boolean).includes(machine);
  } catch {
    return false;
  }
}

export function queryMachineGpus(machine: string): GpuQueryResult {
  const target = sshTargetFor(machine);
  if (target && isSkipped(machine)) {
    return { machine, timedOut: false, byUuid: {}, stderr: 'skipped', exitStatus: null, errorCode: 'skipped' };
  }
  const result = target
    ? spawnSync('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', target, `nvidia-smi ${GPU_QUERY_ARGS.join(' ')}`], {
        timeout: GPU_QUERY_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawnSync('nvidia-smi', [...GPU_QUERY_ARGS], {
        timeout: GPU_QUERY_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  const err = result.error as NodeJS.ErrnoException | undefined;
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const exitStatus = typeof result.status === 'number' ? result.status : null;
  const errorCode = typeof err?.code === 'string' ? err.code : null;
  const timedOut = err?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
  if (timedOut) {
    return { machine, timedOut: true, byUuid: {}, stderr, exitStatus, errorCode };
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
  return { machine, timedOut: false, byUuid, stderr, exitStatus, errorCode };
}
