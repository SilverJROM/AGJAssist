import { spawnSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import { persistReaderResult } from '../../db/xmachines-store.js';
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

export interface ObservedFleetMachine {
  name: string;
  state: 'up' | 'down';
  host: string;
}

export interface CollectorReadSource {
  readSmart(machine: string): Omit<SmartReading, 'machine'>;
  readNut(machine: string): Omit<NutReading, 'machine'>;
}

// The fleet-observation seam. Default is SyntheticTelemetry; a caller that needs
// a literal fixture installs one here rather than replacing collector methods.
export interface CollectorTelemetrySource {
  generate(): MachineTelemetry[];
  forMachine(name: string): MachineTelemetry | undefined;
}

export interface ReaderResultEntry {
  machine: string;
  kind: 'smart' | 'nut';
  availability: 'ok' | 'unavailable';
  freshness: 'fresh' | 'stale';
  value: string;
}

// Where a collected reading is recorded. Default is a no-op so the runtime's
// no-argument construction stays side-effect-free; a caller that needs the
// reading persisted installs a sink here.
export interface ReaderResultSink {
  record(entry: ReaderResultEntry): void;
}

const NOOP_READER_RESULT_SINK: ReaderResultSink = { record(): void {} };

// Literal GPU metrics a caller installs before the sampler cycle. The sampler
// writes these through persistSampleCycle; it does not recompute them.
export interface InstalledGpuReading {
  machineName: string;
  gpuUuid: string;
  temperature: number;
  powerWatts: number;
  utilizationGpu: number;
}

export interface CycleReading {
  machine: string;
  state: MachineTelemetry['state'];
  smart?: SmartReading;
  nut?: NutReading;
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
  private telemetry: CollectorTelemetrySource = new SyntheticTelemetry();
  private source: CollectorReadSource;
  private sink: ReaderResultSink = NOOP_READER_RESULT_SINK;
  private metricDb: Database.Database | null = null;
  private gpuReadings: InstalledGpuReading[] | null = null;

  constructor(source?: CollectorReadSource) {
    this.source = source ?? new BoundedCommandReadSource();
  }

  // The runtime constructs this collector with no arguments. Callers that need a
  // fixture install it here so the collector, not the caller, owns the next read.
  useReadSource(source: CollectorReadSource): void {
    this.source = source;
  }

  // Same seam, for the fleet-observation side: install a literal UP/DOWN fixture
  // without replacing generate()/forMachine() themselves.
  useTelemetrySource(source: CollectorTelemetrySource): void {
    this.telemetry = source;
  }

  // Same seam, for where a collected reading is recorded.
  useReaderResultSink(sink: ReaderResultSink): void {
    this.sink = sink;
  }

  // Product sqlite sink. The caller names the database; readSmart/readNut write the row.
  // The same database is the sampler cycle's xm_samples sink.
  useReaderStore(db: Database.Database): void {
    this.metricDb = db;
    this.sink = {
      record: (entry) => {
        persistReaderResult(db, {
          machineName: entry.machine,
          kind: entry.kind,
          availability: entry.availability,
          freshness: entry.freshness,
          value: entry.value,
          sampleTime: new Date().toISOString(),
        });
      },
    };
  }

  metricStore(): Database.Database | null {
    return this.metricDb;
  }

  installGpuReadings(readings: readonly InstalledGpuReading[]): void {
    this.gpuReadings = readings.map((row) => ({ ...row }));
  }

  installedGpuReadings(): readonly InstalledGpuReading[] | null {
    return this.gpuReadings;
  }

  generate(): MachineTelemetry[] {
    return this.telemetry.generate();
  }

  forMachine(name: string): MachineTelemetry | undefined {
    return this.telemetry.forMachine(name);
  }

  readSmart(machine: string): SmartReading {
    const reading = { machine, ...this.source.readSmart(machine) };
    this.sink.record({ machine, kind: 'smart', availability: reading.availability, freshness: reading.freshness, value: reading.health });
    return reading;
  }

  readNut(machine: string): NutReading {
    const reading = { machine, ...this.source.readNut(machine) };
    this.sink.record({ machine, kind: 'nut', availability: reading.availability, freshness: reading.freshness, value: reading.battery });
    return reading;
  }

  // The full collection-cycle entry point: observe the fleet, then read remote
  // metrics only for rows already observed UP. A DOWN row is returned with its
  // observed state and no smart/nut reading — its state is never re-probed.
  runCycle(): CycleReading[] {
    return this.generate().map((row): CycleReading => {
      if (row.state !== 'up') {
        return { machine: row.name, state: row.state };
      }
      return {
        machine: row.name,
        state: row.state,
        smart: this.readSmart(row.name),
        nut: this.readNut(row.name),
      };
    });
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
