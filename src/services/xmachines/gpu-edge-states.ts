import type Database from 'better-sqlite3';
import { GPU_POLL_MARKER_UUID, persistSampleCycle, reconcileGpuIdentities, type SampleReading } from '../../db/xmachines-store.js';
import { queryMachineGpus, type GpuQueryResult, type GpuReading } from './gpu-query.js';

// A poll older than this against the caller clock is an expired sample.
export const GPU_SAMPLE_FRESH_MS = 5 * 60 * 1000;

const NO_NVIDIA_STDERR = /NVIDIA-SMI has failed|couldn't communicate with the NVIDIA driver|No devices were found/i;

export interface GpuTelemetryRequest {
  machine: string;
  // Registry display hint. Row identity stays the live nvidia-smi UUID and name.
  roleHint: string;
  nowIso: string;
  // True polls nvidia-smi once and persists. False renders stored samples only.
  refresh: boolean;
}

export interface GpuApiRow {
  uuid: string;
  name: string;
  chip: string;
  power: string;
  temperature: string;
  memory: string;
  utilization: string;
  fan: string;
}

export interface GpuTelemetrySurface {
  state: 'live' | 'empty' | 'no-nvidia' | 'driver-timeout' | 'non-nvidia' | 'stale';
  chip: string;
  apiRows: GpuApiRow[];
  html: string;
}

interface StoredSample {
  gpu_uuid: string;
  gpu_name: string | null;
  sample_time: string;
  temperature: number | null;
  power_watts: number | null;
  utilization_gpu: number | null;
  fan_speed: number | null;
  vram_mb: number | null;
  vram_total_mb: number | null;
  poll_chip: string | null;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

export function isNonNvidiaName(name: string): boolean {
  return !/NVIDIA/i.test(name);
}

function isExpired(sampleTime: string, nowIso: string): boolean {
  const sampleMs = Date.parse(sampleTime);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(sampleMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - sampleMs > GPU_SAMPLE_FRESH_MS;
}

export function isNoNvidia(result: GpuQueryResult): boolean {
  if (result.timedOut || Object.keys(result.byUuid).length > 0) return false;
  if (result.errorCode === 'ENOENT') return true;
  return NO_NVIDIA_STDERR.test(result.stderr);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayNumber(value: number | null, suffix: string, blank: string): string {
  if (value === null || !Number.isFinite(value)) return blank;
  return suffix === '%' ? `${value}%` : `${value} ${suffix}`;
}

function metricSpan(kind: string, value: string): string {
  const availability = value === 'unavailable' || value === 'not-applicable' ? value : 'measured';
  const aria = availability === 'measured' ? kind : `${kind} ${availability}`;
  return `<span class="metric metric-${kind}" data-availability="${availability}" aria-label="${escapeHtml(aria)}">${escapeHtml(value)}</span>`;
}

function rowState(chip: string): string {
  if (chip === 'error-timeout') return 'driver-timeout';
  if (chip === 'stale') return 'stale';
  if (chip === 'non-nvidia') return 'non-nvidia';
  return 'live';
}

function renderSurface(
  machine: string,
  state: GpuTelemetrySurface['state'],
  chip: string,
  rows: GpuApiRow[],
  lastGood: boolean,
  sampleTimes: readonly string[],
): GpuTelemetrySurface {
  const rowHtml = rows.map((row, index) => {
    const sampleTime = sampleTimes[index] ?? '';
    return `<div class="gpu-row" role="row" data-state="${rowState(row.chip)}" data-gpu-uuid="${escapeHtml(row.uuid)}" data-history="${lastGood ? 'last-good' : ''}" data-sample-time="${escapeHtml(sampleTime)}"><span class="gpu-uuid">${escapeHtml(row.uuid)}</span><span class="gpu-name">${escapeHtml(row.name)}</span><span class="chip" role="status">${escapeHtml(row.chip)}</span>${metricSpan('power', row.power)}${metricSpan('temperature', row.temperature)}${metricSpan('memory', row.memory)}${metricSpan('utilization', row.utilization)}${metricSpan('fan', row.fan)}</div>`;
  }).join('');
  const banner = rows.length === 0 && chip !== ''
    ? `<span class="chip" role="status">${escapeHtml(chip)}</span>`
    : '';
  const html = `<div class="gpu-telemetry" data-machine="${escapeHtml(machine)}" data-state="${state}" data-chip="${escapeHtml(chip)}">${banner}${rowHtml}</div>`;
  return { state, chip, apiRows: rows, html };
}

function rowFromReading(reading: GpuReading): GpuApiRow {
  if (isNonNvidiaName(reading.name)) {
    return {
      uuid: reading.uuid,
      name: reading.name,
      chip: 'non-nvidia',
      power: 'not-applicable',
      temperature: 'not-applicable',
      memory: 'not-applicable',
      utilization: 'not-applicable',
      fan: 'not-applicable',
    };
  }
  const memory = Number.isFinite(reading.memoryUsedMiB) && Number.isFinite(reading.memoryTotalMiB)
    ? `${reading.memoryUsedMiB}/${reading.memoryTotalMiB} MiB`
    : 'unavailable';
  return {
    uuid: reading.uuid,
    name: reading.name,
    chip: '',
    power: displayNumber(finiteOrNull(reading.powerDrawW), 'W', 'unavailable'),
    temperature: displayNumber(finiteOrNull(reading.temperatureC), 'C', 'unavailable'),
    memory,
    utilization: displayNumber(finiteOrNull(reading.utilizationGpu), '%', 'unavailable'),
    fan: displayNumber(finiteOrNull(reading.fanSpeedPct), '%', 'unavailable'),
  };
}

function storedMemory(row: StoredSample, blank: string): string {
  const used = row.vram_mb;
  const total = row.vram_total_mb;
  if (used !== null && total !== null && Number.isFinite(used) && Number.isFinite(total)) {
    return `${used}/${total} MiB`;
  }
  return displayNumber(used, 'MiB', blank);
}

function rowFromStored(row: StoredSample, chip: string): GpuApiRow {
  const blank = isNonNvidiaName(row.gpu_name ?? '') ? 'not-applicable' : 'unavailable';
  return {
    uuid: row.gpu_uuid,
    name: row.gpu_name ?? '',
    chip: chip || (blank === 'not-applicable' ? 'non-nvidia' : ''),
    power: displayNumber(row.power_watts, 'W', blank),
    temperature: displayNumber(row.temperature, 'C', blank),
    memory: storedMemory(row, blank),
    utilization: displayNumber(row.utilization_gpu, '%', blank),
    fan: displayNumber(row.fan_speed, '%', blank),
  };
}

function latestSamples(db: Database.Database, machine: string): StoredSample[] {
  const rows = db.prepare(`
    SELECT s.gpu_uuid, d.gpu_name, s.sample_time, s.temperature, s.power_watts,
           s.utilization_gpu, s.fan_speed, s.vram_mb, s.vram_total_mb, s.poll_chip
    FROM xm_samples s
    LEFT JOIN xm_devices d ON d.gpu_uuid = s.gpu_uuid
    WHERE s.machine_name = ?
    ORDER BY s.sample_time DESC, s.id DESC
  `).all(machine) as StoredSample[];
  const seen = new Set<string>();
  const latest: StoredSample[] = [];
  for (const row of rows) {
    if (seen.has(row.gpu_uuid)) continue;
    seen.add(row.gpu_uuid);
    latest.push(row);
  }
  return latest;
}

function persistReadings(db: Database.Database, machine: string, readings: readonly GpuReading[], nowIso: string): void {
  const observed = readings.map((reading, ordinal) => ({
    gpuUuid: reading.uuid,
    gpuName: reading.name,
    ordinal,
  }));
  const samples: SampleReading[] = readings.map((reading) => {
    const suppress = isNonNvidiaName(reading.name);
    return {
      machineName: machine,
      gpuUuid: reading.uuid,
      sampleTime: nowIso,
      temperature: suppress ? null : finiteOrNull(reading.temperatureC),
      powerWatts: suppress ? null : finiteOrNull(reading.powerDrawW),
      utilizationGpu: suppress ? null : finiteOrNull(reading.utilizationGpu),
      utilizationMem: null,
      fanSpeed: suppress ? null : finiteOrNull(reading.fanSpeedPct),
      vramMb: suppress ? null : finiteOrNull(reading.memoryUsedMiB),
      vramTotalMb: suppress ? null : finiteOrNull(reading.memoryTotalMiB),
    };
  });
  reconcileGpuIdentities(db, machine, observed, nowIso);
  persistSampleCycle(db, samples);
}

function renderStored(
  db: Database.Database,
  request: GpuTelemetryRequest,
  reason: 'read' | 'timeout',
): GpuTelemetrySurface {
  const all = latestSamples(db, request.machine);
  const marker = all.find((row) => row.gpu_uuid === GPU_POLL_MARKER_UUID) ?? null;
  const stored = all.filter((row) => row.gpu_uuid !== GPU_POLL_MARKER_UUID);
  // A stored no-NVIDIA poll is machine-wide and hides inventory, matching a live poll.
  if (reason === 'read' && marker?.poll_chip === 'no-NVIDIA') {
    return renderSurface(request.machine, 'no-nvidia', 'no-NVIDIA', [], false, []);
  }
  // A timeout is not an empty inventory. Do not reconcile those GPUs away.
  const timedOut = reason === 'timeout'
    || marker?.poll_chip === 'error-timeout'
    || stored.some((row) => row.poll_chip === 'error-timeout');
  if (timedOut) {
    const rows = stored.map((row) => rowFromStored(row, 'error-timeout'));
    return renderSurface(
      request.machine,
      'driver-timeout',
      'error-timeout',
      rows,
      true,
      stored.map((row) => row.sample_time),
    );
  }
  if (stored.length === 0) {
    return renderSurface(request.machine, 'empty', 'no GPUs', [], false, []);
  }
  if (stored.some((row) => isExpired(row.sample_time, request.nowIso))) {
    const rows = stored.map((row) => rowFromStored(row, isExpired(row.sample_time, request.nowIso) ? 'stale' : ''));
    return renderSurface(
      request.machine,
      'stale',
      'stale',
      rows,
      false,
      stored.map((row) => row.sample_time),
    );
  }
  const rows = stored.map((row) => rowFromStored(row, ''));
  const nonNvidia = rows.every((row) => row.chip === 'non-nvidia');
  return renderSurface(
    request.machine,
    nonNvidia ? 'non-nvidia' : 'live',
    nonNvidia ? 'non-nvidia' : '',
    rows,
    false,
    stored.map((row) => row.sample_time),
  );
}

// Public telemetry/UI row path. Registry roleHint is ignored for identity.
export function loadGpuTelemetryRows(
  db: Database.Database,
  request: GpuTelemetryRequest,
): GpuTelemetrySurface {
  void request.roleHint;
  if (!request.refresh) {
    return renderStored(db, request, 'read');
  }
  const polled = queryMachineGpus(request.machine);
  if (polled.timedOut) {
    return renderStored(db, request, 'timeout');
  }
  if (isNoNvidia(polled)) {
    return renderSurface(request.machine, 'no-nvidia', 'no-NVIDIA', [], false, []);
  }
  const readings = Object.values(polled.byUuid);
  if (readings.length === 0) {
    return renderSurface(request.machine, 'empty', 'no GPUs', [], false, []);
  }
  // A poll that just succeeded is the current truth for this machine right
  // now, however old the previously stored sample was. Stale only describes
  // a stored sample rendered without a fresh poll behind it (see renderStored
  // above); it must never suppress a live reading this call just obtained.
  persistReadings(db, request.machine, readings, request.nowIso);
  const rows = readings.map((reading) => rowFromReading(reading));
  const nonNvidia = rows.every((row) => row.chip === 'non-nvidia');
  return renderSurface(
    request.machine,
    nonNvidia ? 'non-nvidia' : 'live',
    nonNvidia ? 'non-nvidia' : '',
    rows,
    false,
    readings.map(() => request.nowIso),
  );
}
