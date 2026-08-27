import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-cc-migration-"));
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

function createLegacyV22Fixture(dbPath: string): void {
  const raw = new Database(dbPath);
  raw.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE schema_version (
      version INTEGER NOT NULL
    );
    INSERT INTO schema_version (version) VALUES (22);

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

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      surface TEXT NOT NULL CHECK(surface IN ('bot', 'miniapp', 'web')),
      expires_at TEXT NOT NULL,
      last_activity TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);
    CREATE INDEX idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER REFERENCES users(id),
      agent_name TEXT,
      action_type TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      tmux_target TEXT,
      surface TEXT CHECK(surface IN ('bot', 'miniapp', 'web', 'agent'))
    );
    CREATE INDEX idx_audit_time ON audit_log(timestamp);
    CREATE INDEX idx_audit_user ON audit_log(user_id);
    CREATE INDEX idx_audit_agent ON audit_log(agent_name);
    CREATE INDEX idx_audit_type ON audit_log(action_type);
  `);
  raw.close();
}

function createLegacyV9Fixture(dbPath: string): void {
  const raw = new Database(dbPath);
  raw.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE schema_version (
      version INTEGER NOT NULL
    );
    INSERT INTO schema_version (version) VALUES (9);

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

    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      directory_name TEXT UNIQUE NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      title TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'promoted', 'archived')),
      tags TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO users (id, telegram_id, role) VALUES (1, 1001, 'owner');
    INSERT INTO projects (id, directory_name) VALUES (1, 'legacy-project');
    INSERT INTO notes (id, project_id, body, created_by) VALUES (1, 1, 'legacy note', 1);
  `);
  raw.close();
}

describe("command-center migration B7", () => {
  it("fresh DB has schema version 37 and no OVM tables", () => {
    const dbPath = tempDb("fresh.sqlite");
    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_projects");
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_task_history");
    db.close();
  });

  it("upgrade from v36 backs up DB and drops OVM tables with WAL content captured", () => {
    const dbPath = tempDb("upgrade.sqlite");
    // create v36 DB with OVM tables, leave connection open to keep WAL uncheckpointed
    const raw = new Database(dbPath);
    raw.pragma("journal_mode = WAL");
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (36);
      CREATE TABLE overmind_projects (
        id INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        app_path TEXT UNIQUE NOT NULL,
        parent_session TEXT NOT NULL
      );
      CREATE TABLE overmind_workflows (
        id INTEGER PRIMARY KEY,
        project_id INTEGER
      );
      CREATE TABLE overmind_task_history (
        id INTEGER PRIMARY KEY,
        coordinator_session TEXT NOT NULL
      );
      INSERT INTO overmind_projects (id, slug, app_path, parent_session) VALUES (1, 'p1', '/a', 's1');
      INSERT INTO overmind_workflows (id, project_id) VALUES (1, 1);
      INSERT INTO overmind_task_history (id, coordinator_session) VALUES (1, 's1');
    `);
    // keep raw open so changes may sit in WAL

    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_projects");
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_task_history");

    // find backup file created as sibling
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    const backups = fs.readdirSync(dir).filter(f => f.startsWith(base + ".pre-ovm-drop-") && f.endsWith(".bak"));
    expect(backups.length).toBeGreaterThan(0);
    const backupPath = path.join(dir, backups[0]);
    expect(fs.statSync(backupPath).size).toBeGreaterThan(0);

    // verify backup contains the OVM rows via independent readonly connection
    const bak = new Database(backupPath, { readonly: true });
    const proj = bak.prepare("SELECT slug FROM overmind_projects ORDER BY id").all() as Array<{ slug: string }>;
    expect(proj).toEqual([{ slug: "p1" }]);
    const wf = bak.prepare("SELECT id FROM overmind_workflows ORDER BY id").all() as Array<{ id: number }>;
    expect(wf).toEqual([{ id: 1 }]);
    const th = bak.prepare("SELECT coordinator_session FROM overmind_task_history ORDER BY id").all() as Array<{ coordinator_session: string }>;
    expect(th).toEqual([{ coordinator_session: "s1" }]);
    bak.close();

    raw.close();
    db.close();
  });

  it("fresh and genuine v22 DB without OVM tables converge to the same schema fingerprint", () => {
    const freshPath = tempDb("fresh.sqlite");
    const fresh = new DatabaseService(freshPath);
    const freshFp = schemaFingerprint(fresh.raw);
    fresh.close();

    const upgradePath = tempDb("upgrade.sqlite");
    createLegacyV22Fixture(upgradePath);
    const upgraded = new DatabaseService(upgradePath);
    const upgradedFp = schemaFingerprint(upgraded.raw);
    upgraded.close();

    expect(upgradedFp).toEqual(freshFp);
  });

  it("upgrade from v9 makes notes.project_id nullable", () => {
    const dbPath = tempDb("v9.sqlite");
    createLegacyV9Fixture(dbPath);

    const upgraded = new DatabaseService(dbPath);
    try {
      const cols = upgraded.raw.pragma("table_info(notes)") as Array<{ name: string; notnull: number }>;
      expect(cols.find(c => c.name === "project_id")!.notnull).toBe(0);
      expect(() => upgraded.prepare(
        "INSERT INTO notes (project_id, body, created_by) VALUES (NULL, 'x', 1)"
      ).run()).not.toThrow();
    } finally {
      upgraded.close();
    }
  });
});
