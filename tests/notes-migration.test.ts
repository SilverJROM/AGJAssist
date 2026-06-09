/**
 * Regression test: v22 → v23 upgrade on an existing DB that has a notes table
 * WITHOUT folder_id / pinned / position columns.
 *
 * This test reproduces the class of prod-crash that occurred when migration code
 * was only exercised against fresh DBs.  It bootstraps an OLD-schema DB directly
 * with better-sqlite3 (schema_version = 22), seeds a couple of notes + an owner
 * user, closes it, then opens it with `new DatabaseService(path)` and asserts
 * the full set of post-migration invariants.
 */
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { DatabaseService } from "../src/db/database.js";
import { NoteService } from "../src/services/note-service.js";
import { AuditService } from "../src/services/audit-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-notes-migration-v22.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

afterEach(() => {
  cleanup();
});

describe("v22 → v23 upgrade regression", () => {
  it("migrates an OLD notes table (no folder_id/pinned/position) without throwing", () => {
    // ── Step 1: Build the legacy DB directly with better-sqlite3 ────────────
    cleanup();
    const legacy = new Database(TEST_DB);
    legacy.pragma("journal_mode = WAL");
    legacy.pragma("foreign_keys = ON");

    legacy.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
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

      INSERT INTO users (telegram_id, role, active) VALUES (999, 'owner', 1);

      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        project_id INTEGER,
        title TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'promoted', 'archived')),
        tags TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO notes (body, created_by) VALUES ('Legacy note one', 1);
      INSERT INTO notes (body, created_by) VALUES ('Legacy note two', 1);
    `);
    legacy.close();

    // ── Step 2: Open with DatabaseService — this MUST not throw ─────────────
    let db!: DatabaseService;
    expect(() => {
      db = new DatabaseService(TEST_DB);
    }).not.toThrow();

    try {
      // ── Step 3: schema_version bumped to latest ───────────────────────────
      const ver = db.prepare("SELECT version FROM schema_version").get() as { version: number };
      expect(ver.version).toBe(30);

      // ── Step 4: new columns present on notes ──────────────────────────────
      const cols = db.raw.pragma("table_info(notes)") as { name: string }[];
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain("folder_id");
      expect(colNames).toContain("pinned");
      expect(colNames).toContain("position");

      // ── Step 5: default "Notes" folder seeded ────────────────────────────
      const defaultFolder = db
        .prepare("SELECT * FROM note_folders WHERE name = 'Notes'")
        .get() as { id: number; name: string } | undefined;
      expect(defaultFolder).toBeDefined();
      expect(defaultFolder!.name).toBe("Notes");

      // ── Step 6: pre-existing notes assigned to the default folder ─────────
      const unassigned = db
        .prepare("SELECT COUNT(*) as cnt FROM notes WHERE folder_id IS NULL")
        .get() as { cnt: number };
      expect(unassigned.cnt).toBe(0);

      const assignedToDefault = db
        .prepare("SELECT COUNT(*) as cnt FROM notes WHERE folder_id = ?")
        .get(defaultFolder!.id) as { cnt: number };
      expect(assignedToDefault.cnt).toBe(2);

      // ── Step 7: NoteService operates correctly on the migrated DB ─────────
      const svc = new NoteService(db, new AuditService(db));
      expect(svc.defaultFolderId()).toBe(defaultFolder!.id);
      const notes = svc.listByFolder(defaultFolder!.id);
      expect(notes).toHaveLength(2);
      expect(notes.map((n) => n.body)).toEqual(
        expect.arrayContaining(["Legacy note one", "Legacy note two"])
      );
    } finally {
      db.close();
    }
  });
});
