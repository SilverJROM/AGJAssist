import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";

const MCP_TABLES = [
  "mcp_clients",
  "mcp_grantable_pool",
  "mcp_grants",
  "mcp_tokens",
  "mcp_authorization_codes"
] as const;

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-mcp-migration-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

function normalizeSql(sql: string | null): string | null {
  if (sql === null) return null;
  return sql
    .replace(
      /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)/i,
      "CREATE TABLE <table>"
    )
    .replace(/\s+/g, " ")
    .replace(/\s*([(),=])\s*/g, "$1")
    .trim();
}

function tableSql(db: Database.Database, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string | null } | undefined;
  if (!row?.sql) throw new Error(`Missing table SQL for ${table}`);
  return row.sql;
}

function tableDescriptor(db: Database.Database, table: string) {
  const indexes = (
    db.pragma(`index_list(${table})`) as Array<{
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>
  )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((index) => {
      const sqlRow = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index.name) as { sql: string | null } | undefined;
      return {
        ...index,
        columns: db.pragma(`index_info(${index.name})`),
        sql: normalizeSql(sqlRow?.sql ?? null)
      };
    });

  return {
    tableInfo: db.pragma(`table_info(${table})`),
    foreignKeys: db.pragma(`foreign_key_list(${table})`),
    indexes,
    checkSql: normalizeSql(tableSql(db, table))
  };
}

interface FixtureSnapshot {
  auditRows: Array<Record<string, unknown>>;
  auditSql: string;
  auditRootPage: number;
  sessionsSql: string;
}

function createFixture(
  dbPath: string,
  version: 34 | 35,
  auditSupportsMcp = false
): FixtureSnapshot {
  const raw = new Database(dbPath);
  const auditSurfaces = auditSupportsMcp
    ? "'bot', 'miniapp', 'web', 'agent', 'mcp'"
    : "'bot', 'miniapp', 'web', 'agent'";

  raw.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE schema_version (
      version INTEGER NOT NULL
    );
    INSERT INTO schema_version (version) VALUES (${version});

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
      surface TEXT CHECK(surface IN (${auditSurfaces}))
    );
    CREATE INDEX idx_audit_time ON audit_log(timestamp);
    CREATE INDEX idx_audit_user ON audit_log(user_id);
    CREATE INDEX idx_audit_agent ON audit_log(agent_name);
    CREATE INDEX idx_audit_type ON audit_log(action_type);
  `);

  if (version >= 35) {
    raw.exec(`
      CREATE TABLE terminal_groups (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL DEFAULT '{"groups":[],"activeGroup":"all"}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  raw.prepare(
    "INSERT INTO users (id, telegram_id, username, role) VALUES (?, ?, ?, 'owner')"
  ).run(7, 7007, "migration-owner");
  raw.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, surface, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run("web-session", 7, "session-hash", "web", "2099-01-01T00:00:00.000Z");

  raw.prepare(
    `INSERT INTO audit_log
      (id, timestamp, user_id, agent_name, action_type, resource_type, resource_id, details, tmux_target, surface)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    17,
    "2026-08-19 10:00:00",
    7,
    "grok",
    "legacy_bot_action",
    "tmux",
    "resource-17",
    JSON.stringify({ preserved: true, row: 17 }),
    "north:0.0",
    "bot"
  );
  raw.prepare(
    `INSERT INTO audit_log
      (id, timestamp, user_id, agent_name, action_type, resource_type, resource_id, details, tmux_target, surface)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    99,
    "2026-08-20 11:30:00",
    7,
    "claude",
    "legacy_agent_action",
    "agent",
    "resource-99",
    JSON.stringify({ preserved: true, row: 99 }),
    "other:1.2",
    "agent"
  );

  const auditRows = raw
    .prepare("SELECT * FROM audit_log ORDER BY id")
    .all() as Array<Record<string, unknown>>;
  const auditEntry = raw
    .prepare("SELECT sql, rootpage FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'")
    .get() as { sql: string; rootpage: number };
  const sessionsSql = tableSql(raw, "sessions");
  raw.close();

  return {
    auditRows,
    auditSql: auditEntry.sql,
    auditRootPage: auditEntry.rootpage,
    sessionsSql
  };
}

function schemaVersion(db: DatabaseService): number {
  return (db.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
}

function relevantSchemaFingerprint(db: Database.Database) {
  const names = [...MCP_TABLES, "audit_log"];
  return db
    .prepare(
      `SELECT type, name, tbl_name, rootpage, sql
       FROM sqlite_master
       WHERE tbl_name IN (${names.map(() => "?").join(",")})
       ORDER BY type, name`
    )
    .all(...names);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("MCP schema v36 migration parity", () => {
  it("upgrades a v34 fixture through groups and MCP with fresh-schema parity", () => {
    const freshPath = tempDb("fresh.sqlite");
    const upgradedPath = tempDb("upgraded.sqlite");
    const fixture = createFixture(upgradedPath, 34);

    const fresh = new DatabaseService(freshPath);
    const upgraded = new DatabaseService(upgradedPath);

    try {
      for (const table of [...MCP_TABLES, "audit_log"]) {
        expect(tableDescriptor(upgraded.raw, table), table).toEqual(
          tableDescriptor(fresh.raw, table)
        );
      }

      expect(schemaVersion(fresh)).toBe(36);
      expect(schemaVersion(upgraded)).toBe(36);
      expect(
        upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'terminal_groups'").get()
      ).toEqual({ name: "terminal_groups" });

      const auditRows = upgraded
        .prepare("SELECT * FROM audit_log ORDER BY id")
        .all() as Array<Record<string, unknown>>;
      expect(auditRows).toEqual(fixture.auditRows);
      expect(auditRows.map((row) => row.id)).toEqual([17, 99]);

      const sample = upgraded.prepare("SELECT * FROM audit_log WHERE id = 99").get();
      expect(sample).toEqual(fixture.auditRows[1]);
      expect(tableSql(upgraded.raw, "audit_log")).toContain("'mcp'");

      upgraded
        .prepare("INSERT INTO audit_log (action_type, surface) VALUES (?, ?)")
        .run("mcp_migration_valid", "mcp");
      expect(() =>
        upgraded
          .prepare("INSERT INTO audit_log (action_type, surface) VALUES (?, ?)")
          .run("mcp_migration_invalid", "invalid")
      ).toThrow();

      expect(tableSql(upgraded.raw, "sessions")).toBe(fixture.sessionsSql);
      expect(tableSql(upgraded.raw, "sessions")).toContain(
        "CHECK(surface IN ('bot', 'miniapp', 'web'))"
      );
      expect(tableSql(upgraded.raw, "sessions")).not.toContain("'mcp'");
      expect(upgraded.raw.pragma("foreign_key_check")).toEqual([]);
      expect((upgraded.raw.pragma("foreign_keys") as Array<{ foreign_keys: number }>)[0].foreign_keys).toBe(1);
    } finally {
      fresh.close();
      upgraded.close();
    }
  });

  it("is a schema no-op when an already-v36 database is reopened", () => {
    const dbPath = tempDb("reopen.sqlite");
    createFixture(dbPath, 34);

    const first = new DatabaseService(dbPath);
    const before = relevantSchemaFingerprint(first.raw);
    const auditBefore = first.prepare("SELECT * FROM audit_log ORDER BY id").all();
    first.close();

    const reopened = new DatabaseService(dbPath);
    try {
      expect(schemaVersion(reopened)).toBe(36);
      expect(relevantSchemaFingerprint(reopened.raw)).toEqual(before);
      expect(reopened.prepare("SELECT * FROM audit_log ORDER BY id").all()).toEqual(auditBefore);
      expect(reopened.raw.pragma("foreign_key_check")).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("skips the audit rebuild when a partial v35 database already has the mcp CHECK", () => {
    const dbPath = tempDb("partial.sqlite");
    const fixture = createFixture(dbPath, 35, true);

    const upgraded = new DatabaseService(dbPath);
    try {
      const auditEntry = upgraded
        .prepare("SELECT sql, rootpage FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'")
        .get() as { sql: string; rootpage: number };

      expect(schemaVersion(upgraded)).toBe(36);
      expect(auditEntry.sql).toBe(fixture.auditSql);
      expect(auditEntry.rootpage).toBe(fixture.auditRootPage);
      expect(upgraded.prepare("SELECT * FROM audit_log ORDER BY id").all()).toEqual(fixture.auditRows);
      for (const table of MCP_TABLES) {
        expect(
          upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
        ).toEqual({ name: table });
      }
      expect(upgraded.raw.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });
});
