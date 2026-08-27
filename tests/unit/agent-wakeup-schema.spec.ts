import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-wakeup-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createLegacyV38Fixture(dbPath: string): void {
  const raw = new Database(dbPath);
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (38);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer'
    );
  `);
  raw.close();
}

describe("agent_one_time_wakeups schema E1", () => {
  it("fresh DB has schema version 39 and agent_one_time_wakeups table", () => {
    const dbPath = tempDb("fresh.sqlite");
    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(39);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("agent_one_time_wakeups");

    const cols = db.raw.pragma("table_info(agent_one_time_wakeups)") as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("pane_target");
    expect(colNames).toContain("manual_fire_time");
    expect(colNames).toContain("action");
    expect(colNames).toContain("status");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");

    db.close();
  });

  it("upgrade from v38 creates agent_one_time_wakeups table", () => {
    const upgradePath = tempDb("upgrade.sqlite");
    createLegacyV38Fixture(upgradePath);
    const upgraded = new DatabaseService(upgradePath);
    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(39);

    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("agent_one_time_wakeups");

    const cols = upgraded.raw.pragma("table_info(agent_one_time_wakeups)") as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("pane_target");
    expect(colNames).toContain("manual_fire_time");
    expect(colNames).toContain("action");
    expect(colNames).toContain("status");

    upgraded.close();
  });

  it("agent_one_time_wakeups supports pane, manual fire time, action, status", () => {
    const dbPath = tempDb("test.sqlite");
    const db = new DatabaseService(dbPath);

    db.prepare(`
      INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status)
      VALUES (?, ?, ?, ?)
    `).run("pane-123", "2026-01-01 00:00:00", "echo hello", "pending");

    const id = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    const row = db.prepare("SELECT * FROM agent_one_time_wakeups WHERE id = ?").get(id.id) as any;
    expect(row.pane_target).toBe("pane-123");
    expect(row.manual_fire_time).toBe("2026-01-01 00:00:00");
    expect(row.action).toBe("echo hello");
    expect(row.status).toBe("pending");

    // Update status
    db.prepare("UPDATE agent_one_time_wakeups SET status = ? WHERE id = ?").run("fired", id.id);
    const updated = db.prepare("SELECT status FROM agent_one_time_wakeups WHERE id = ?").get(id.id) as { status: string };
    expect(updated.status).toBe("fired");

    db.close();
  });
});
