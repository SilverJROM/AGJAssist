import type Database from "better-sqlite3";

export interface SampleReading {
  machineName: string;
  gpuUuid: string;
  sampleTime: string;
  temperature: number | null;
  powerWatts: number | null;
  utilizationGpu: number | null;
  utilizationMem: number | null;
  fanSpeed: number | null;
  vramMb: number | null;
  vramTotalMb: number | null;
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

// Owner-set friendly display names, keyed by canonical machine name. Rename is
// additive metadata — it never changes the machine's identity (name = ssh host).
export function getMachineLabels(db: Database.Database): Record<string, string> {
  try {
    const rows = db
      .prepare("SELECT machine_name, display_name FROM xm_machine_labels")
      .all() as Array<{ machine_name: string; display_name: string }>;
    const out: Record<string, string> = {};
    for (const r of rows) {
      if (r && r.machine_name && typeof r.display_name === "string" && r.display_name.trim()) {
        out[r.machine_name] = r.display_name;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function setMachineLabel(db: Database.Database, machineName: string, displayName: string): void {
  const name = String(machineName || "").trim();
  const label = String(displayName || "").trim().slice(0, 64);
  if (!name) return;
  if (!label) {
    db.prepare("DELETE FROM xm_machine_labels WHERE machine_name = ?").run(name);
    return;
  }
  db.prepare(`
    INSERT INTO xm_machine_labels (machine_name, display_name, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(machine_name) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at
  `).run(name, label);
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
      utilization_gpu, utilization_mem, fan_speed, vram_mb, vram_total_mb
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        row.vramTotalMb ?? null,
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
  // Upsert on the globally-UNIQUE gpu_uuid. A GPU physically moved to another box
  // (its UUID already recorded under a different machine_name) must REASSIGN to the
  // observing machine here — a plain INSERT would violate UNIQUE(gpu_uuid), and that
  // 500 blanked the whole detail page. first_seen is preserved on conflict.
  const upsertGpu = db.prepare(`
    INSERT INTO xm_devices (
      machine_name, gpu_uuid, gpu_name, status, ordinal, first_seen, last_seen
    ) VALUES (?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(gpu_uuid) DO UPDATE SET
      machine_name = excluded.machine_name,
      gpu_name = excluded.gpu_name,
      status = 'active',
      ordinal = excluded.ordinal,
      last_seen = excluded.last_seen
  `);
  const retireGpu = db.prepare(
    "UPDATE xm_devices SET status = 'retired' WHERE machine_name = ? AND gpu_uuid = ?",
  );

  const apply = db.transaction((rows: readonly ObservedGpu[]) => {
    const existing = selectExisting.all(machineName) as Array<{ id: number; gpu_uuid: string }>;
    const seen = new Set<string>();

    for (const gpu of rows) {
      if (seen.has(gpu.gpuUuid)) {
        // A UUID repeated within one observation is a corrupt poll — fail the whole
        // transaction (rolls back) so it cannot partially apply. Distinct from the
        // cross-machine case below, which the upsert reassigns rather than rejects.
        throw new Error(`duplicate gpu_uuid in observation for ${machineName}: ${gpu.gpuUuid}`);
      }
      upsertGpu.run(machineName, gpu.gpuUuid, gpu.gpuName, gpu.ordinal, seenAt, seenAt);
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

// Not a GPU. One row per machine records a poll that produced no inventory
// (no-NVIDIA, or a timeout before any sample existed).
export const GPU_POLL_MARKER_UUID = "__xm_poll__";

function latestGpuSampleIds(db: Database.Database, machineName: string): number[] {
  const rows = db.prepare(`
    SELECT id, gpu_uuid FROM xm_samples
    WHERE machine_name = ? AND gpu_uuid != ?
    ORDER BY sample_time DESC, id DESC
  `).all(machineName, GPU_POLL_MARKER_UUID) as Array<{ id: number; gpu_uuid: string }>;
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const row of rows) {
    if (seen.has(row.gpu_uuid)) continue;
    seen.add(row.gpu_uuid);
    ids.push(row.id);
  }
  return ids;
}

export function clearGpuPollState(db: Database.Database, machineName: string): void {
  db.prepare("DELETE FROM xm_samples WHERE machine_name = ? AND gpu_uuid = ?")
    .run(machineName, GPU_POLL_MARKER_UUID);
  db.prepare("UPDATE xm_samples SET poll_chip = NULL WHERE machine_name = ?")
    .run(machineName);
}

export function markGpuDriverTimeout(db: Database.Database, machineName: string, sampleTime: string): void {
  const apply = db.transaction(() => {
    db.prepare("DELETE FROM xm_samples WHERE machine_name = ? AND gpu_uuid = ?")
      .run(machineName, GPU_POLL_MARKER_UUID);
    const ids = latestGpuSampleIds(db, machineName);
    if (ids.length === 0) {
      db.prepare(`
        INSERT INTO xm_samples (machine_name, gpu_uuid, sample_time, poll_chip)
        VALUES (?, ?, ?, 'error-timeout')
      `).run(machineName, GPU_POLL_MARKER_UUID, sampleTime);
      return;
    }
    const update = db.prepare("UPDATE xm_samples SET poll_chip = 'error-timeout' WHERE id = ?");
    for (const id of ids) update.run(id);
  });
  apply();
}

export function markGpuNoNvidia(db: Database.Database, machineName: string, sampleTime: string): void {
  const apply = db.transaction(() => {
    db.prepare("UPDATE xm_samples SET poll_chip = NULL WHERE machine_name = ? AND gpu_uuid != ?")
      .run(machineName, GPU_POLL_MARKER_UUID);
    db.prepare("DELETE FROM xm_samples WHERE machine_name = ? AND gpu_uuid = ?")
      .run(machineName, GPU_POLL_MARKER_UUID);
    db.prepare(`
      INSERT INTO xm_samples (machine_name, gpu_uuid, sample_time, poll_chip)
      VALUES (?, ?, ?, 'no-NVIDIA')
    `).run(machineName, GPU_POLL_MARKER_UUID, sampleTime);
  });
  apply();
}
