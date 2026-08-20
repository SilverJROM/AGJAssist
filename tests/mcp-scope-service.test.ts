import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { TerminalGroupsService } from "../src/services/terminal-groups-service.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { McpGrantService } from "../src/mcp/mcp-grant-service.js";
import { McpPoolService } from "../src/mcp/mcp-pool-service.js";
import { McpScopeService } from "../src/mcp/mcp-scope-service.js";

let dir = "";

function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-scope-"));
  const db = new DatabaseService(path.join(dir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
  const clients = new McpClientService(db);
  const grok = clients.register({ client_name: "grok", redirect_uris: ["https://a.example/cb"] });
  const claude = clients.register({ client_name: "claude", redirect_uris: ["https://b.example/cb"] });
  const grants = new McpGrantService(db);
  const pool = new McpPoolService(db);
  const groups = new TerminalGroupsService(db);
  const scope = new McpScopeService(db, groups, pool);
  const live = ["NORTH", "OTHER", "ORCH"];
  return { db, ownerId, grok, claude, grants, pool, groups, scope, live };
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("McpScopeService intersection logic (unit only; AC-9 e2e is B16/B17)", () => {
  it("resolves fixed-list ∩ pool ∩ live ∩ valid-name", () => {
    const { ownerId, grok, grants, pool, scope, live } = setup();
    pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
    const grant = grants.create({
      clientId: grok.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH", "OTHER", "ORCH"]),
      permissions: ["list_sessions"]
    });
    expect(scope.resolve(grant, live)).toEqual(["NORTH", "OTHER"]);
  });

  it("prunes removed pool names from active sessions grants; re-add does not restore (AC-27 sessions)", () => {
    const { ownerId, grok, grants, pool, scope, live } = setup();
    pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
    const grant = grants.create({
      clientId: grok.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH", "OTHER"]),
      permissions: ["list_sessions"]
    });
    pool.replaceSet(ownerId, ["NORTH"]);
    const after = grants.get(grant.id)!;
    expect(JSON.parse(after.scopeRef)).toEqual(["NORTH"]);
    expect(scope.resolve(after, live)).toEqual(["NORTH"]);

    pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
    const restoredPool = grants.get(grant.id)!;
    expect(JSON.parse(restoredPool.scopeRef)).toEqual(["NORTH"]);
    expect(scope.resolve(restoredPool, live)).toEqual(["NORTH"]);
  });

  it("does not prune group grants; pool re-add restores live group membership", () => {
    const { ownerId, grok, grants, pool, groups, scope, live } = setup();
    groups.put(ownerId, {
      groups: [{ id: "g-north", name: "north", sessions: ["NORTH", "OTHER"] }],
      activeGroup: "g-north"
    });
    pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
    const grant = grants.create({
      clientId: grok.id,
      grantedBy: ownerId,
      scopeType: "group",
      scopeRef: "g-north",
      permissions: ["list_sessions"]
    });
    pool.replaceSet(ownerId, ["NORTH"]);
    expect(grant.scopeRef).toBe("g-north");
    expect(grants.get(grant.id)?.scopeRef).toBe("g-north");
    expect(scope.resolve(grants.get(grant.id)!, live)).toEqual(["NORTH"]);

    pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
    expect(scope.resolve(grants.get(grant.id)!, live)).toEqual(["NORTH", "OTHER"]);
  });

  it("isolates two grants' session sets", () => {
    const { ownerId, grok, claude, grants, pool, scope, live } = setup();
    pool.replaceSet(ownerId, ["NORTH", "OTHER"]);
    const a = grants.create({
      clientId: grok.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"]
    });
    const b = grants.create({
      clientId: claude.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["OTHER"]),
      permissions: ["list_sessions"]
    });
    expect(scope.resolve(a, live)).toEqual(["NORTH"]);
    expect(scope.resolve(b, live)).toEqual(["OTHER"]);
  });

  it("corrupt or missing scope_ref fails closed to an empty set", () => {
    const { ownerId, grok, grants, pool, scope, live } = setup();
    pool.replaceSet(ownerId, ["NORTH"]);
    const grant = grants.create({
      clientId: grok.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"]
    });
    expect(scope.resolve({ ...grant, scopeRef: "{not-json" }, live)).toEqual([]);
    expect(scope.resolve({ ...grant, scopeType: "group", scopeRef: "missing-group" }, live)).toEqual([]);
  });
});
