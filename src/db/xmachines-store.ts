import type Database from "better-sqlite3";

export interface SampleReading {
  machineName: string;
  gpuUuid: string;
  sampleTime: string;
  temperature: number;
  powerWatts: number;
  utilizationGpu: number;
  utilizationMem: number;
  fanSpeed: number;
  vramMb: number;
}

export interface ObservedGpu {
  gpuUuid: string;
  gpuName: string;
  ordinal: number;
}

export interface ReaderResultRow {
  machineName: string;
  kind: 'smart' | 'nut';
  availability: 'ok' | 'unavailable';
  freshness: 'fresh' | 'stale';
  value: string;
  sampleTime: string;
}

export function persistReaderResult(db: Database.Database, row: ReaderResultRow): void {
  db.prepare(`
    INSERT INTO xm_reader_results (
      machine_name, kind, availability, freshness, value, sample_time
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.machineName, row.kind, row.availability, row.freshness, row.value, row.sampleTime);
}

export function persistSampleCycle(db: Database.Database, readings: readonly SampleReading[]): void {
  const insert = db.prepare(`
    INSERT INTO xm_samples (
      machine_name, gpu_uuid, sample_time, temperature, power_watts,
      utilization_gpu, utilization_mem, fan_speed, vram_mb
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const write = db.transaction((rows: readonly SampleReading[]) => {
    for (const row of rows) {
      insert.run(
        row.machineName,
        row.gpuUuid,
        row.sampleTime,
        row.temperature,
        row.powerWatts,
        row.utilizationGpu,
        row.utilizationMem,
        row.fanSpeed,
        row.vramMb,
      );
    }
  });
  write(readings);
}

export function reconcileGpuIdentities(
  db: Database.Database,
  machineName: string,
  observed: readonly ObservedGpu[],
  seenAt: string,
): void {
  const selectExisting = db.prepare(
    "SELECT id, gpu_uuid FROM xm_devices WHERE machine_name = ?",
  );
  const insertGpu = db.prepare(`
    INSERT INTO xm_devices (
      machine_name, gpu_uuid, gpu_name, status, ordinal, first_seen, last_seen
    ) VALUES (?, ?, ?, 'active', ?, ?, ?)
  `);
  const updateGpu = db.prepare(`
    UPDATE xm_devices
    SET gpu_name = ?, status = 'active', ordinal = ?, last_seen = ?
    WHERE machine_name = ? AND gpu_uuid = ?
  `);
  const retireGpu = db.prepare(
    "UPDATE xm_devices SET status = 'retired' WHERE machine_name = ? AND gpu_uuid = ?",
  );

  const apply = db.transaction((rows: readonly ObservedGpu[]) => {
    const existing = selectExisting.all(machineName) as Array<{ id: number; gpu_uuid: string }>;
    const existingUuids = new Set(existing.map((row) => row.gpu_uuid));
    const seen = new Set<string>();

    for (const gpu of rows) {
      if (seen.has(gpu.gpuUuid)) {
        // Repeated UUID hits UNIQUE inside this transaction so a bad observation cannot partially apply.
        insertGpu.run(machineName, gpu.gpuUuid, gpu.gpuName, gpu.ordinal, seenAt, seenAt);
      } else if (existingUuids.has(gpu.gpuUuid)) {
        updateGpu.run(gpu.gpuName, gpu.ordinal, seenAt, machineName, gpu.gpuUuid);
      } else {
        insertGpu.run(machineName, gpu.gpuUuid, gpu.gpuName, gpu.ordinal, seenAt, seenAt);
      }
      seen.add(gpu.gpuUuid);
    }

    for (const row of existing) {
      if (!seen.has(row.gpu_uuid)) {
        retireGpu.run(machineName, row.gpu_uuid);
      }
    }
  });

  apply(observed);
}
