import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DatabaseService } from "../../src/db/database.js";
import { SCHEMA_VERSION } from "../../src/db/schema.js";
import { AuthService } from "../../src/auth/auth-service.js";
import { TerminalGroupsService, normalizeTerminalGroupsBlob } from "../../src/services/terminal-groups-service.js";
import { registerTerminalGroupsRoutes } from "../../src/api/routes/terminal-groups-routes.js";

const TMP_PREFIX = path.join(os.tmpdir(), "agj-terminal-groups-");

function makeDb(): { db: DatabaseService; dir: string } {
  const dir = fs.mkdtempSync(TMP_PREFIX);
  const db = new DatabaseService(path.join(dir, "test.sqlite"));
  return { db, dir };
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("normalizeTerminalGroupsBlob", () => {
  it("drops invalid rows and unknown active tabs", () => {
    const blob = normalizeTerminalGroupsBlob({
      groups: [
        { id: "g1", name: "north", sessions: ["NORTH", "NORTH", ""] },
        { id: "", name: "bad" },
        { name: "no-id" },
        { id: "g1", name: "dup" }
      ],
      activeGroup: "missing"
    });
    expect(blob.groups).toEqual([{ id: "g1", name: "north", sessions: ["NORTH"] }]);
    expect(blob.activeGroup).toBe("all");
  });
});

describe("TerminalGroupsService store", () => {
  let dir = "";
  afterEach(() => {
    if (dir) cleanupDir(dir);
    dir = "";
  });

  it("returns empty defaults then round-trips a put", () => {
    const made = makeDb();
    dir = made.dir;
    made.db.ensureOwner(111);
    const userId = (made.db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
    const svc = new TerminalGroupsService(made.db);

    expect(svc.get(userId)).toEqual({ groups: [], activeGroup: "all" });

    const saved = svc.put(userId, {
      groups: [{ id: "g-north", name: "north", sessions: ["NORTH"] }],
      activeGroup: "g-north"
    });
    expect(saved).toEqual({
      groups: [{ id: "g-north", name: "north", sessions: ["NORTH"] }],
      activeGroup: "g-north"
    });
    expect(svc.get(userId)).toEqual(saved);
    made.db.close();
  });

  it("isolates blobs per user", () => {
    const made = makeDb();
    dir = made.dir;
    made.db.ensureOwner(111);
    made.db.prepare("INSERT INTO users (telegram_id, role, active) VALUES (?, 'owner', 1)").run(222);
    const a = (made.db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
    const b = (made.db.prepare("SELECT id FROM users WHERE telegram_id = 222").get() as { id: number }).id;
    const svc = new TerminalGroupsService(made.db);
    svc.put(a, { groups: [{ id: "ga", name: "A", sessions: [] }], activeGroup: "ga" });
    svc.put(b, { groups: [{ id: "gb", name: "B", sessions: ["X"] }], activeGroup: "all" });
    expect(svc.get(a).groups[0].name).toBe("A");
    expect(svc.get(b).groups[0].sessions).toEqual(["X"]);
    made.db.close();
  });

  it("migrates a v34 DB to current and creates terminal_groups", () => {
    const dirLocal = fs.mkdtempSync(TMP_PREFIX);
    dir = dirLocal;
    const file = path.join(dirLocal, "legacy.sqlite");
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (34);
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
    `);
    legacy.close();

    const db = new DatabaseService(file);
    const ver = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(ver.version).toBe(SCHEMA_VERSION);
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='terminal_groups'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("terminal_groups");
    db.close();
  });
});

describe("GET/PUT /api/terminal/groups", () => {
  let dir = "";
  let app: FastifyInstance;
  let ownerToken = "owner-token";

  afterEach(async () => {
    if (app) await app.close();
    if (dir) cleanupDir(dir);
    dir = "";
  });

  async function boot() {
    const made = makeDb();
    dir = made.dir;
    made.db.ensureOwner(111);
    const ownerId = (made.db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
    const authService = {
      verifyToken: (token: string) => {
        if (token === ownerToken) return { id: ownerId, role: "owner", username: "jrom" };
        if (token === "viewer-token") return { id: ownerId, role: "viewer", username: "view" };
        return null;
      }
    } as unknown as AuthService;
    app = Fastify({ logger: false });
    registerTerminalGroupsRoutes(app, authService, new TerminalGroupsService(made.db));
    await app.ready();
    return made.db;
  }

  it("round-trips through the owner-authed endpoints", async () => {
    await boot();
    const empty = await app.inject({
      method: "GET",
      url: "/api/terminal/groups",
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ groups: [], activeGroup: "all" });

    const put = await app.inject({
      method: "PUT",
      url: "/api/terminal/groups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        groups: [{ id: "g-north", name: "north", sessions: ["NORTH"] }],
        activeGroup: "g-north"
      }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().groups[0].name).toBe("north");

    const got = await app.inject({
      method: "GET",
      url: "/api/terminal/groups",
      headers: { authorization: `Bearer ${ownerToken}` }
    });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual({
      groups: [{ id: "g-north", name: "north", sessions: ["NORTH"] }],
      activeGroup: "g-north"
    });
  });

  it("rejects missing auth and viewers", async () => {
    await boot();
    const noAuth = await app.inject({ method: "GET", url: "/api/terminal/groups" });
    expect(noAuth.statusCode).toBe(401);

    const viewer = await app.inject({
      method: "PUT",
      url: "/api/terminal/groups",
      headers: { authorization: "Bearer viewer-token" },
      payload: { groups: [], activeGroup: "all" }
    });
    expect(viewer.statusCode).toBe(403);
  });

  it("rejects a non-object PUT body", async () => {
    await boot();
    const res = await app.inject({
      method: "PUT",
      url: "/api/terminal/groups",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: []
    });
    expect(res.statusCode).toBe(400);
  });
});
