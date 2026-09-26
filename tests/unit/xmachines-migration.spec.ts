import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { persistSampleCycle, reconcileGpuIdentities } from "../../src/db/xmachines-store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

const ACTION_COLUMNS = [
  "id",
  "machine_name",
  "action",
  "status",
  "idempotency_key",
  "request_id",
  "owner_id",
  "started_at",
  "finished_at",
  "gateway_exit_status",
  "final_state",
  "reject_reason",
];

const XM_TABLES = ["xm_action_state", "xm_alerts", "xm_config", "xm_devices", "xm_reader_results", "xm_samples"];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-xmachines-migration-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createLegacyV39Fixture(dbPath: string): void {
  const raw = new Database(dbPath);
  raw.pragma("foreign_keys = ON");
  raw.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE schema_version (
      version INTEGER NOT NULL
    );
    INSERT INTO schema_version (version) VALUES (39);

    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'viewer')),
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, telegram_id, role) VALUES (1, 1001, 'owner');

    CREATE TABLE xm_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO xm_config (key, value) VALUES ('legacy_key', 'legacy_value');

    CREATE TABLE xm_action_state (
      id INTEGER PRIMARY KEY,
      machine_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('on','off')),
      status TEXT NOT NULL CHECK(status IN ('in-progress','rejected','completed','failed')),
      idempotency_key TEXT NOT NULL,
      request_id TEXT NOT NULL,
      owner_id TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      gateway_exit_status INTEGER,
      final_state TEXT,
      reject_reason TEXT
    );
    INSERT INTO xm_action_state (
      machine_name, action, status, idempotency_key, request_id, owner_id,
      started_at, finished_at, gateway_exit_status, final_state
    ) VALUES (
      'gpu', 'off', 'completed', 'idem-preserve-7', 'req-preserve-7', 'owner-9',
      '2026-08-01T00:00:00Z', '2026-08-01T00:00:05Z', 0, 'DOWN'
    );
  `);
  raw.close();
}

function expectActionStateShape(db: DatabaseService): void {
  const actionCols = db.raw.pragma("table_info(xm_action_state)") as Array<{ name: string }>;
  expect(actionCols.map((col) => col.name)).toEqual(ACTION_COLUMNS);
  const indexes = db.raw.pragma("index_list(xm_action_state)") as Array<{ name: string; unique: number }>;
  const idempotency = indexes.find((index) => index.name === "idx_xm_action_state_idempotency");
  expect(idempotency).toBeDefined();
  expect(idempotency?.unique).toBe(1);
}

describe("xmachines migration A11", () => {
  it("fresh DB creates xmachines tables with schema version 40", () => {
    const dbPath = tempDb("fresh.sqlite");
    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(40);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'xm_%'").all() as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(XM_TABLES);

    const sampleCols = db.raw.pragma("table_info(xm_samples)") as Array<{ name: string }>;
    expect(sampleCols.map((c) => c.name)).toContain("gpu_uuid");
    expect(sampleCols.map((c) => c.name)).toContain("machine_name");
    expect(sampleCols.map((c) => c.name)).toContain("vram_total_mb");
    expect(sampleCols.map((c) => c.name)).toContain("poll_chip");
    const deviceCols = db.raw.pragma("table_info(xm_devices)") as Array<{ name: string }>;
    expect(deviceCols.map((c) => c.name)).toContain("ordinal");
    expectActionStateShape(db);
    db.close();
  });

  it("stamped v40 database gains vram_total_mb without a version bump", () => {
    const dbPath = tempDb("stamped40.sqlite");
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (40);
      CREATE TABLE xm_devices (
        id INTEGER PRIMARY KEY,
        machine_name TEXT NOT NULL,
        gpu_uuid TEXT NOT NULL UNIQUE,
        gpu_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        ordinal INTEGER NOT NULL DEFAULT 0,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE xm_samples (
        id INTEGER PRIMARY KEY,
        machine_name TEXT NOT NULL,
        gpu_uuid TEXT NOT NULL,
        sample_time TEXT NOT NULL DEFAULT (datetime('now')),
        temperature REAL,
        power_watts REAL,
        utilization_gpu REAL,
        utilization_mem REAL,
        fan_speed REAL,
        vram_mb REAL
      );
    `);
    raw.close();

    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(40);
    const sampleCols = db.raw.pragma("table_info(xm_samples)") as Array<{ name: string }>;
    expect(sampleCols.map((col) => col.name)).toContain("vram_total_mb");
    expect(sampleCols.map((col) => col.name)).toContain("poll_chip");
    db.close();
  });

  it("upgrade from v39 preserves pre-existing rows while adding xmachines tables", () => {
    const dbPath = tempDb("upgrade.sqlite");
    createLegacyV39Fixture(dbPath);

    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(40);

    const configRow = db.prepare("SELECT key, value FROM xm_config WHERE key = 'legacy_key'").get() as { key: string; value: string } | undefined;
    expect(configRow).toBeDefined();
    expect(configRow?.value).toBe("legacy_value");

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'xm_%'").all() as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(XM_TABLES);

    const preserved = db.prepare(`
      SELECT machine_name, action, status, idempotency_key, request_id, owner_id,
             started_at, finished_at, gateway_exit_status, final_state
      FROM xm_action_state WHERE idempotency_key = 'idem-preserve-7'
    `).get();
    expect(preserved).toEqual({
      machine_name: "gpu",
      action: "off",
      status: "completed",
      idempotency_key: "idem-preserve-7",
      request_id: "req-preserve-7",
      owner_id: "owner-9",
      started_at: "2026-08-01T00:00:00Z",
      finished_at: "2026-08-01T00:00:05Z",
      gateway_exit_status: 0,
      final_state: "DOWN",
    });
    expectActionStateShape(db);

    const user = db.prepare("SELECT role FROM users WHERE id = 1").get() as { role: string } | undefined;
    expect(user?.role).toBe("owner");

    db.close();
  });

  it("product sample and GPU reconcile paths persist history, reorder, and retired identities", () => {
    const dbPath = tempDb("history.sqlite");
    const db = new DatabaseService(dbPath);
    const raw = db.raw;

    reconcileGpuIdentities(raw, "fixture-box-zeta", [
      { gpuUuid: "GPU-UUID-KEEP", gpuName: "RTX 3090", ordinal: 0 },
      { gpuUuid: "GPU-UUID-GONE", gpuName: "RTX 4090", ordinal: 1 },
    ], "2026-09-25T01:00:00Z");

    const keepBefore = raw.prepare(
      "SELECT id, ordinal, status, first_seen FROM xm_devices WHERE gpu_uuid = ?",
    ).get("GPU-UUID-KEEP") as { id: number; ordinal: number; status: string; first_seen: string };
    const goneBefore = raw.prepare(
      "SELECT id, ordinal, status FROM xm_devices WHERE gpu_uuid = ?",
    ).get("GPU-UUID-GONE") as { id: number; ordinal: number; status: string };
    expect(keepBefore.ordinal).toBe(0);
    expect(goneBefore.status).toBe("active");

    persistSampleCycle(raw, [{
      machineName: "fixture-box-zeta",
      gpuUuid: "GPU-UUID-GONE",
      sampleTime: "2026-09-25T01:00:00Z",
      temperature: 71.5,
      powerWatts: 180,
      utilizationGpu: 0.5,
      utilizationMem: 0.25,
      fanSpeed: 900,
      vramMb: 24576,
    }]);
    persistSampleCycle(raw, [
      {
        machineName: "fixture-box-zeta",
        gpuUuid: "GPU-UUID-GONE",
        sampleTime: "2026-09-25T01:30:00Z",
        temperature: 73.25,
        powerWatts: 190,
        utilizationGpu: 0.5,
        utilizationMem: 0.25,
        fanSpeed: 1100,
        vramMb: 24576,
      },
      {
        machineName: "fixture-box-zeta",
        gpuUuid: "GPU-UUID-KEEP",
        sampleTime: "2026-09-25T01:30:00Z",
        temperature: 61,
        powerWatts: 120,
        utilizationGpu: 0.5,
        utilizationMem: 0.25,
        fanSpeed: 400,
        vramMb: 24576,
      },
    ]);

    expect(() => reconcileGpuIdentities(raw, "fixture-box-zeta", [
      { gpuUuid: "GPU-UUID-NEW", gpuName: "A100", ordinal: 0 },
      { gpuUuid: "GPU-UUID-NEW", gpuName: "A100-dup", ordinal: 1 },
    ], "2026-09-25T02:00:00Z")).toThrow();

    const keepMid = raw.prepare(
      "SELECT id, ordinal, status FROM xm_devices WHERE gpu_uuid = ?",
    ).get("GPU-UUID-KEEP") as { id: number; ordinal: number; status: string };
    const goneMid = raw.prepare(
      "SELECT id, ordinal, status FROM xm_devices WHERE gpu_uuid = ?",
    ).get("GPU-UUID-GONE") as { id: number; ordinal: number; status: string };
    const newMid = raw.prepare("SELECT id FROM xm_devices WHERE gpu_uuid = ?").get("GPU-UUID-NEW");
    expect(keepMid).toEqual({ id: keepBefore.id, ordinal: 0, status: "active" });
    expect(goneMid).toEqual({ id: goneBefore.id, ordinal: 1, status: "active" });
    expect(newMid).toBeUndefined();

    reconcileGpuIdentities(raw, "fixture-box-zeta", [
      { gpuUuid: "GPU-UUID-NEW", gpuName: "A100", ordinal: 0 },
      { gpuUuid: "GPU-UUID-KEEP", gpuName: "RTX 3090", ordinal: 1 },
    ], "2026-09-25T02:00:00Z");

    const keepAfter = raw.prepare(
      "SELECT id, gpu_uuid, ordinal, status, first_seen, last_seen FROM xm_devices WHERE gpu_uuid = ?",
    ).get("GPU-UUID-KEEP");
    const goneAfter = raw.prepare(
      "SELECT id, gpu_uuid, ordinal, status FROM xm_devices WHERE gpu_uuid = ?",
    ).get("GPU-UUID-GONE");
    const newAfter = raw.prepare(
      "SELECT gpu_uuid, gpu_name, ordinal, status FROM xm_devices WHERE gpu_uuid = ?",
    ).get("GPU-UUID-NEW");
    expect(keepAfter).toEqual({
      id: keepBefore.id,
      gpu_uuid: "GPU-UUID-KEEP",
      ordinal: 1,
      status: "active",
      first_seen: "2026-09-25T01:00:00Z",
      last_seen: "2026-09-25T02:00:00Z",
    });
    expect(goneAfter).toEqual({
      id: goneBefore.id,
      gpu_uuid: "GPU-UUID-GONE",
      ordinal: 1,
      status: "retired",
    });
    expect(newAfter).toEqual({
      gpu_uuid: "GPU-UUID-NEW",
      gpu_name: "A100",
      ordinal: 0,
      status: "active",
    });

    const goneSamples = raw.prepare(
      "SELECT temperature, sample_time FROM xm_samples WHERE gpu_uuid = ? ORDER BY sample_time",
    ).all("GPU-UUID-GONE");
    expect(goneSamples).toEqual([
      { temperature: 71.5, sample_time: "2026-09-25T01:00:00Z" },
      { temperature: 73.25, sample_time: "2026-09-25T01:30:00Z" },
    ]);
    const keepSamples = raw.prepare(
      "SELECT temperature, sample_time, machine_name FROM xm_samples WHERE gpu_uuid = ?",
    ).all("GPU-UUID-KEEP");
    expect(keepSamples).toEqual([{
      temperature: 61,
      sample_time: "2026-09-25T01:30:00Z",
      machine_name: "fixture-box-zeta",
    }]);

    db.close();
  });

  it("xm_alerts exposes non-unique dedupe_key and created_at for the B11 window", () => {
    const dbPath = tempDb("alerts.sqlite");
    const db = new DatabaseService(dbPath);

    const cols = db.raw.pragma("table_info(xm_alerts)") as Array<{ name: string }>;
    const colNames = cols.map((col) => col.name);
    expect(colNames).toEqual(expect.arrayContaining([
      "machine_name",
      "alert_type",
      "created_at",
      "dedupe_key",
    ]));

    const indexes = db.raw.pragma("index_list(xm_alerts)") as Array<{ name: string; unique: number }>;
    const dedupe = indexes.find((index) => index.name === "idx_xm_alerts_dedupe");
    const byTime = indexes.find((index) => index.name === "idx_xm_alerts_machine_time");
    expect(dedupe).toBeDefined();
    expect(dedupe?.unique).toBe(0);
    expect(byTime).toBeDefined();
    expect(byTime?.unique).toBe(0);

    db.prepare(`
      INSERT INTO xm_alerts (machine_name, alert_type, alert_level, message, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("fixture-box-zeta", "temp_high", "warning", "High temperature", "dedup-001", "2026-09-25T01:00:00Z");
    db.prepare(`
      INSERT INTO xm_alerts (machine_name, alert_type, alert_level, message, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("fixture-box-zeta", "temp_high", "warning", "High temperature again", "dedup-001", "2026-09-25T01:40:00Z");

    const rows = db.prepare(
      "SELECT message, created_at FROM xm_alerts WHERE dedupe_key = ? ORDER BY created_at",
    ).all("dedup-001");
    expect(rows).toEqual([
      { message: "High temperature", created_at: "2026-09-25T01:00:00Z" },
      { message: "High temperature again", created_at: "2026-09-25T01:40:00Z" },
    ]);

    db.close();
  });

  it("xmachines config table persists key/value", () => {
    const dbPath = tempDb("config.sqlite");
    const db = new DatabaseService(dbPath);

    db.prepare("INSERT INTO xm_config (key, value) VALUES (?, ?)")
      .run("sample_interval", "30");
    const cfg = db.prepare("SELECT value FROM xm_config WHERE key = ?").get("sample_interval") as { value: string } | undefined;
    expect(cfg?.value).toBe("30");

    db.close();
  });
});
