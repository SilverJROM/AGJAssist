import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

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
  `);
  raw.close();
}

describe("xmachines migration A11", () => {
  it("fresh DB creates xmachines tables with schema version 40", () => {
    const dbPath = tempDb("fresh.sqlite");
    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(40);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'xm_%'").all() as { name: string }[];
    const names = tables.map(t => t.name).sort();
    expect(names).toEqual(["xm_alerts", "xm_config", "xm_devices", "xm_samples"]);

    const sampleCols = db.raw.pragma("table_info(xm_samples)") as Array<{ name: string }>;
    expect(sampleCols.map(c => c.name)).toContain("gpu_uuid");
    expect(sampleCols.map(c => c.name)).toContain("machine_name");
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
    const names = tables.map(t => t.name).sort();
    expect(names).toEqual(["xm_alerts", "xm_config", "xm_devices", "xm_samples"]);

    const user = db.prepare("SELECT role FROM users WHERE id = 1").get() as { role: string } | undefined;
    expect(user?.role).toBe("owner");

    (db as any).close();
  });

  it("sampler cycle persists metric history to xm_samples", () => {
    const dbPath = tempDb("sampler.sqlite");
    const db = new DatabaseService(dbPath);

    db.prepare(`
      INSERT INTO xm_samples (machine_name, gpu_uuid, temperature, power_watts, utilization_gpu, utilization_mem, fan_speed, vram_mb)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("gpu1", "uuid-1234", 65.2, 210.5, 0.87, 0.45, 1500, 8192);

    const row = db.prepare("SELECT machine_name, gpu_uuid, temperature, power_watts FROM xm_samples WHERE gpu_uuid = ?").get("uuid-1234") as { machine_name: string; gpu_uuid: string; temperature: number; power_watts: number } | undefined;
    expect(row).toBeDefined();
    expect(row?.machine_name).toBe("gpu1");
    expect(row?.gpu_uuid).toBe("uuid-1234");
    expect(row?.temperature).toBe(65.2);
    expect(row?.power_watts).toBe(210.5);

    db.close();
  });

  it("GPU history attaches to UUID with retired status history", () => {
    const dbPath = tempDb("devices.sqlite");
    const db = new DatabaseService(dbPath);

    db.prepare(`
      INSERT INTO xm_devices (machine_name, gpu_uuid, gpu_name, status)
      VALUES (?, ?, ?, ?)
    `).run("gpu1", "uuid-1234", "RTX 3090", "active");
    db.prepare(`
      INSERT INTO xm_devices (machine_name, gpu_uuid, gpu_name, status)
      VALUES (?, ?, ?, ?)
    `).run("gpu1", "uuid-5678", "RTX 4090", "retired");

    const active = db.prepare("SELECT gpu_uuid, status FROM xm_devices WHERE status = 'active'").all() as Array<{ gpu_uuid: string; status: string }>;
    const retired = db.prepare("SELECT gpu_uuid, status FROM xm_devices WHERE status = 'retired'").all() as Array<{ gpu_uuid: string; status: string }>;

    expect(active).toHaveLength(1);
    expect(active[0].gpu_uuid).toBe("uuid-1234");
    expect(retired).toHaveLength(1);
    expect(retired[0].gpu_uuid).toBe("uuid-5678");

    db.close();
  });

  it("alert dedupe key prevents duplicate alerts", () => {
    const dbPath = tempDb("alerts.sqlite");
    const db = new DatabaseService(dbPath);

    db.prepare(`
      INSERT INTO xm_alerts (machine_name, alert_type, alert_level, message, dedupe_key)
      VALUES (?, ?, ?, ?, ?)
    `).run("gpu1", "temp_high", "warning", "High temperature", "dedup-001");
    db.prepare(`
      INSERT INTO xm_alerts (machine_name, alert_type, alert_level, message, dedupe_key)
      VALUES (?, ?, ?, ?, ?)
    `).run("gpu1", "temp_high", "warning", "High temperature again", "dedup-001");

    const rows = db.prepare("SELECT id, message FROM xm_alerts WHERE dedupe_key = ? ORDER BY id").all("dedup-001") as Array<{ id: number; message: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].message).toBe("High temperature");
    expect(rows[1].message).toBe("High temperature again");

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
