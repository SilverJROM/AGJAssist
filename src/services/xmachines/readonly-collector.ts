import { spawnSync } from 'node:child_process';
import { SyntheticTelemetry, type MachineTelemetry } from './telemetry.js';

// Fixed contract: a reading at or above this cpu temperature is the alert condition.
const CPU_TEMP_ALERT_AT = 90;
const PING_DEADLINE_SECS = '2';
const SSH_CONNECT_TIMEOUT_SECS = '5';
const COMMAND_TIMEOUT_MS = 1000;

export interface SmartReading {
  machine: string;
  health: string;
  availability: 'ok' | 'unavailable';
  freshness: 'fresh' | 'stale';
}

export interface NutReading {
  machine: string;
  battery: string;
  availability: 'ok' | 'unavailable';
  freshness: 'fresh' | 'stale';
}

export interface AlertRecord {
  machine: string;
  condition: 'cpu-temp-high';
  cpuTemp: number;
}

export interface CollectorReadSource {
  readSmart(machine: string): Omit<SmartReading, 'machine'>;
  readNut(machine: string): Omit<NutReading, 'machine'>;
}

interface CommandOutcome {
  timedOut: boolean;
  stdout: string;
}

function runCommand(command: string, args: string[]): CommandOutcome {
  const result = spawnSync(command, args, {
    timeout: COMMAND_TIMEOUT_MS,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const err = result.error as NodeJS.ErrnoException | undefined;
  const timedOut = err?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  return { timedOut, stdout };
}

// Always issues both probes so a ping timeout cannot skip the ssh argv.
function probeHost(machine: string, remoteCommand: string): { stale: true } | { stale: false; stdout: string } {
  const ping = runCommand('ping', ['-c', '1', '-W', PING_DEADLINE_SECS, machine]);
  const ssh = runCommand('ssh', [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECS}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    machine,
    remoteCommand,
  ]);
  if (ping.timedOut || ssh.timedOut) return { stale: true };
  return { stale: false, stdout: ssh.stdout.trim() };
}

class BoundedCommandReadSource implements CollectorReadSource {
  readSmart(machine: string): Omit<SmartReading, 'machine'> {
    const probed = probeHost(machine, 'smartctl -H');
    if (probed.stale) {
      return { health: '', availability: 'unavailable', freshness: 'stale' };
    }
    return { health: probed.stdout, availability: 'ok', freshness: 'fresh' };
  }

  readNut(machine: string): Omit<NutReading, 'machine'> {
    const probed = probeHost(machine, 'upsc ups@localhost');
    if (probed.stale) {
      return { battery: '', availability: 'unavailable', freshness: 'stale' };
    }
    return { battery: probed.stdout, availability: 'ok', freshness: 'fresh' };
  }
}

export class ReadOnlyCollector {
  private readonly telemetry = new SyntheticTelemetry();
  private source: CollectorReadSource;

  constructor(source?: CollectorReadSource) {
    this.source = source ?? new BoundedCommandReadSource();
  }

  // The runtime constructs this collector with no arguments. Callers that need a
  // fixture install it here so the collector, not the caller, owns the next read.
  useReadSource(source: CollectorReadSource): void {
    this.source = source;
  }

  generate(): MachineTelemetry[] {
    return this.telemetry.generate();
  }

  forMachine(name: string): MachineTelemetry | undefined {
    return this.telemetry.forMachine(name);
  }

  readSmart(machine: string): SmartReading {
    return { machine, ...this.source.readSmart(machine) };
  }

  readNut(machine: string): NutReading {
    return { machine, ...this.source.readNut(machine) };
  }

  evaluateAlerts(): AlertRecord[] {
    const alerts: AlertRecord[] = [];
    for (const row of this.generate()) {
      if (row.cpuTemp >= CPU_TEMP_ALERT_AT) {
        alerts.push({ machine: row.name, condition: 'cpu-temp-high', cpuTemp: row.cpuTemp });
      }
    }
    return alerts;
  }
}
