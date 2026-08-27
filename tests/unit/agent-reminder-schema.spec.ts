import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function normalizeSql(sql: string | null): string | null {
  if (sql === null) return null;
  return sql
    .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/i, "CREATE TABLE $1")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),=])\s*/g, "$1")
    .trim();
}

function schemaFingerprint(db: Database.Database) {
  const rows = db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name`
  ).all() as Array<{ type: string; name: string; tbl_name: string | null; sql: string | null }>;
  return rows.map(r => ({ ...r, sql: normalizeSql(r.sql) }));
}

function createLegacyV37Fixture(dbPath: string): void {
  const raw = new Database(dbPath);
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (37);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer'
    );
  `);
  raw.close();
}

describe("agent-reminder-schema C1", () => {
  it("fresh DB has schema version 38 and agent solicit tables", () => {
    const dbPath = tempDb("fresh.sqlite");
    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(38);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("agent_solicit_reminders");
    expect(names).toContain("agent_solicit_recipients");

    const cols = db.raw.pragma("table_info(agent_solicit_reminders)") as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("folder_group");
    expect(colNames).toContain("cadence_minutes");
    expect(colNames).toContain("repeat_limit");
    expect(colNames).toContain("next_fire");
    expect(colNames).toContain("solicit_message");

    const recCols = db.raw.pragma("table_info(agent_solicit_recipients)") as Array<{ name: string }>;
    const recColNames = recCols.map(c => c.name);
    expect(recColNames).toContain("reminder_id");
    expect(recColNames).toContain("agent_name");
    expect(recColNames).toContain("include");

    db.close();
  });

  it("upgrade from v37 creates agent solicit tables", () => {
    const upgradePath = tempDb("upgrade.sqlite");
    createLegacyV37Fixture(upgradePath);
    const upgraded = new DatabaseService(upgradePath);
    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(38);

    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("agent_solicit_reminders");
    expect(names).toContain("agent_solicit_recipients");
    upgraded.close();
  });

  it("agent_solicit_reminders supports folder-group cadence repeat limit include skip next-fire", () => {
    const dbPath = tempDb("test.sqlite");
    const db = new DatabaseService(dbPath);
    // Create a user for FK
    db.prepare("INSERT INTO users (telegram_id, role) VALUES (12345, 'owner')").run();
    const user = db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number };
    // Insert a reminder
    db.prepare(`
      INSERT INTO agent_solicit_reminders (user_id, folder_group, cadence_minutes, repeat_limit, next_fire, solicit_message, active)
      VALUES (?, 'group-a', 30, NULL, '2026-01-01 00:00:00', 'give me a status update', 1)
    `).run(user.id);
    const id = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    // Insert recipients with include/skip
    db.prepare(`
      INSERT INTO agent_solicit_recipients (reminder_id, agent_name, include)
      VALUES (?, 'agent-1', 1), (?, 'agent-2', 0)
    `).run(id.id, id.id);

    const reminder = db.prepare("SELECT * FROM agent_solicit_reminders WHERE id = ?").get(id.id) as any;
    expect(reminder.folder_group).toBe('group-a');
    expect(reminder.cadence_minutes).toBe(30);
    expect(reminder.repeat_limit).toBeNull();
    expect(reminder.next_fire).toBe('2026-01-01 00:00:00');

    const recs = db.prepare("SELECT agent_name, include FROM agent_solicit_recipients WHERE reminder_id = ?").all(id.id) as Array<{ agent_name: string; include: number }>;
    expect(recs).toHaveLength(2);
    expect(recs.find(r => r.agent_name === 'agent-1')!.include).toBe(1);
    expect(recs.find(r => r.agent_name === 'agent-2')!.include).toBe(0);

    db.close();
  });
});
