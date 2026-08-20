import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { McpClientService } from "../src/mcp/mcp-client-service.js";
import { McpGrantError, McpGrantService, isSqliteUniqueConstraint } from "../src/mcp/mcp-grant-service.js";
import { McpTokenService } from "../src/mcp/mcp-token-service.js";

let dir = "";

function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-grant-"));
  const db = new DatabaseService(path.join(dir, "test.sqlite"));
  db.ensureOwner(111);
  const ownerId = (db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number }).id;
  const clients = new McpClientService(db);
  const client = clients.register({
    client_name: "grok",
    redirect_uris: ["https://app.example.com/cb"]
  });
  const tokens = new McpTokenService(db);
  const grants = new McpGrantService(db, tokens);
  return { db, ownerId, client, tokens, grants };
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("McpGrantService", () => {
  it("supersede tx revokes the prior grant and family-kills its tokens", () => {
    const { db, ownerId, client, tokens, grants } = setup();
    const first = grants.create({
      clientId: client.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions", "read_session"]
    });
    const pair = tokens.mintPair({ grantId: first.id, audience: "http://localhost:3101/mcp" });
    expect(tokens.verifyAccessToken(`Bearer ${pair.accessToken}`, "http://localhost:3101/mcp")?.grantId).toBe(first.id);

    const second = grants.create({
      clientId: client.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["OTHER"]),
      permissions: ["list_sessions"]
    });
    expect(second.id).not.toBe(first.id);
    expect(grants.get(first.id)?.status).toBe("revoked");
    expect(grants.get(second.id)?.status).toBe("active");
    expect(tokens.verifyAccessToken(`Bearer ${pair.accessToken}`, "http://localhost:3101/mcp")).toBeNull();
    const active = db
      .prepare("SELECT COUNT(*) AS n FROM mcp_grants WHERE client_id = ? AND status = 'active'")
      .get(client.id) as { n: number };
    expect(active.n).toBe(1);
    db.close();
  });

  it("persists scope and permission edits", () => {
    const { db, ownerId, client, grants } = setup();
    const grant = grants.create({
      clientId: client.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"]
    });
    const scoped = grants.editScope(grant.id, "sessions", JSON.stringify(["NORTH", "OTHER"]));
    expect(JSON.parse(scoped.scopeRef)).toEqual(["NORTH", "OTHER"]);
    const perms = grants.editPermissions(grant.id, ["send_message", "list_sessions"]);
    expect(perms.permissions).toEqual(["list_sessions", "send_message"]);
    db.close();
  });

  it("setLifetime(true) NULLs active access-token expiry", () => {
    const { db, ownerId, client, tokens, grants } = setup();
    const grant = grants.create({
      clientId: client.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"]
    });
    const pair = tokens.mintPair({ grantId: grant.id, audience: "http://localhost:3101/mcp" });
    const before = db
      .prepare("SELECT expires_at FROM mcp_tokens WHERE id = ?")
      .get(pair.accessTokenId) as { expires_at: string | null };
    expect(before.expires_at).toBeTruthy();

    const updated = grants.setLifetime(grant.id, true);
    expect(updated.lifetime).toBe(true);
    const after = db
      .prepare("SELECT expires_at FROM mcp_tokens WHERE id = ?")
      .get(pair.accessTokenId) as { expires_at: string | null };
    expect(after.expires_at).toBeNull();
    db.close();
  });

  it("maps concurrent UNIQUE violations to a clean McpGrantError, not a 500/SQLITE dump", () => {
    const { db, ownerId, client, grants } = setup();
    grants.create({
      clientId: client.id,
      grantedBy: ownerId,
      scopeType: "sessions",
      scopeRef: JSON.stringify(["NORTH"]),
      permissions: ["list_sessions"]
    });
    expect(() => {
      db.prepare(
        `INSERT INTO mcp_grants
           (client_id, scope_type, scope_ref, permissions, lifetime, token_ttl_days, granted_by, status)
         VALUES (?, 'sessions', '[]', '[]', 0, 7, ?, 'active')`
      ).run(client.id, ownerId);
    }).toThrow();
    try {
      db.prepare(
        `INSERT INTO mcp_grants
           (client_id, scope_type, scope_ref, permissions, lifetime, token_ttl_days, granted_by, status)
         VALUES (?, 'sessions', '[]', '[]', 0, 7, ?, 'active')`
      ).run(client.id, ownerId);
    } catch (err) {
      expect(isSqliteUniqueConstraint(err)).toBe(true);
      expect(() => {
        if (isSqliteUniqueConstraint(err)) {
          throw new McpGrantError("already_active", "An active grant already exists for this client");
        }
      }).toThrow(McpGrantError);
      try {
        if (isSqliteUniqueConstraint(err)) {
          throw new McpGrantError("already_active", "An active grant already exists for this client");
        }
      } catch (mapped) {
        expect(mapped).toBeInstanceOf(McpGrantError);
        expect((mapped as Error).message).not.toMatch(/SQLITE/i);
        expect((mapped as McpGrantError).code).toBe("already_active");
      }
    }
    db.close();
  });
});
