import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import {
  hashMcpSecret,
  McpTokenError,
  McpTokenService
} from "../src/mcp/mcp-token-service.js";

interface Fixture {
  db: DatabaseService;
  dbPath: string;
  service: McpTokenService;
  grantId: number;
  clientId: string;
}

const tempDirs: string[] = [];
const openDatabases: DatabaseService[] = [];

function createFixture(lifetime = false, tokenTtlDays = 7): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-token-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "test.sqlite");
  const db = new DatabaseService(dbPath);
  openDatabases.push(db);
  const clientId = `client-${Math.random().toString(16).slice(2)}`;

  db.prepare(
    "INSERT INTO users (id, telegram_id, username, role) VALUES (1, 1001, 'owner', 'owner')"
  ).run();
  db.prepare(
    `INSERT INTO mcp_clients (id, client_name, redirect_uris)
     VALUES (?, 'test-agent', '["https://client.example/cb"]')`
  ).run(clientId);
  const grant = db
    .prepare(
      `INSERT INTO mcp_grants
         (client_id, scope_type, scope_ref, permissions, lifetime, token_ttl_days, granted_by)
       VALUES (?, 'sessions', '["north"]', '["read_session"]', ?, ?, 1)`
    )
    .run(clientId, lifetime ? 1 : 0, tokenTtlDays);
  const grantId = Number(grant.lastInsertRowid);

  return {
    db,
    dbPath,
    service: new McpTokenService(db),
    grantId,
    clientId
  };
}

function tokenRows(db: DatabaseService) {
  return db
    .prepare(
      `SELECT id, grant_id, client_id, token_hash, token_type, family_id, rotated_from,
              audience, expires_at, revoked, revoked_at, rotated_at, last_used_at
       FROM mcp_tokens ORDER BY created_at, token_type`
    )
    .all() as Array<Record<string, unknown>>;
}

function expectTokenError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected McpTokenError");
  } catch (error) {
    expect(error).toBeInstanceOf(McpTokenError);
    expect((error as McpTokenError).code).toBe(code);
  }
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) {
    try {
      db.close();
    } catch {
      // A test may close early to inspect the durable SQLite file.
    }
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("McpTokenService B6", () => {
  it("mints distinct opaque access and refresh secrets and stores hashes only (AC-8)", () => {
    const { db, dbPath, service, grantId } = createFixture();
    const pair = service.mintPair({ grantId, audience: "https://mcp.example/mcp" });

    expect(pair.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.accessToken).not.toBe(pair.refreshToken);
    expect(Buffer.from(pair.accessToken, "base64url")).toHaveLength(32);
    expect(Buffer.from(pair.refreshToken, "base64url")).toHaveLength(32);

    const rows = tokenRows(db);
    expect(rows).toHaveLength(2);
    const access = rows.find((row) => row.token_type === "access");
    const refresh = rows.find((row) => row.token_type === "refresh");
    expect(access?.token_hash).toBe(hashMcpSecret(pair.accessToken));
    expect(refresh?.token_hash).toBe(hashMcpSecret(pair.refreshToken));
    expect(access?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(refresh?.token_hash).toMatch(/^[a-f0-9]{64}$/);

    const storedMcpAndAudit = JSON.stringify({
      clients: db.prepare("SELECT * FROM mcp_clients").all(),
      grants: db.prepare("SELECT * FROM mcp_grants").all(),
      tokens: db.prepare("SELECT * FROM mcp_tokens").all(),
      codes: db.prepare("SELECT * FROM mcp_authorization_codes").all(),
      audit: db.prepare("SELECT details FROM audit_log WHERE surface = 'mcp'").all()
    });
    expect(storedMcpAndAudit).not.toContain(pair.accessToken);
    expect(storedMcpAndAudit).not.toContain(pair.refreshToken);

    db.raw.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    openDatabases.splice(openDatabases.indexOf(db), 1);
    const durableBytes = fs.readFileSync(dbPath);
    expect(durableBytes.includes(Buffer.from(pair.accessToken))).toBe(false);
    expect(durableBytes.includes(Buffer.from(pair.refreshToken))).toBe(false);
  });

  it("accepts only a live access bearer bound to the expected audience (AC-12)", () => {
    const { db, service, grantId, clientId } = createFixture();
    const pair = service.mintPair({ grantId, audience: "https://mcp.example/mcp" });

    const binding = service.verifyAccessToken(
      `Bearer ${pair.accessToken}`,
      "https://mcp.example/mcp"
    );
    expect(binding).toMatchObject({
      tokenId: pair.accessTokenId,
      familyId: pair.familyId,
      grantId,
      clientId,
      audience: "https://mcp.example/mcp"
    });
    expect(service.verifyAccessToken(undefined)).toBeNull();
    expect(service.verifyAccessToken(`Bearer ${pair.refreshToken}`)).toBeNull();
    expect(service.verifyAccessToken("Bearer garbage")).toBeNull();
    expect(
      service.verifyAccessToken(`Bearer ${pair.accessToken}`, "https://other.example/mcp")
    ).toBeNull();

    db.prepare("UPDATE mcp_tokens SET revoked = 1 WHERE id = ?").run(pair.accessTokenId);
    expect(service.verifyAccessToken(`Bearer ${pair.accessToken}`)).toBeNull();

    const expired = service.mintPair({ grantId, audience: "https://mcp.example/mcp" });
    db.prepare("UPDATE mcp_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .run(expired.accessTokenId);
    expect(service.verifyAccessToken(`Bearer ${expired.accessToken}`)).toBeNull();

    const deleted = service.mintPair({ grantId, audience: "https://mcp.example/mcp" });
    db.prepare("DELETE FROM mcp_tokens WHERE id = ?").run(deleted.accessTokenId);
    expect(service.verifyAccessToken(`Bearer ${deleted.accessToken}`)).toBeNull();

    const inactiveGrant = service.mintPair({ grantId, audience: "https://mcp.example/mcp" });
    db.prepare("UPDATE mcp_grants SET status = 'revoked', revoked_at = datetime('now') WHERE id = ?")
      .run(grantId);
    expect(service.verifyAccessToken(`Bearer ${inactiveGrant.accessToken}`)).toBeNull();
  });

  it("uses bounded access/refresh expiry and NULL expiry for an opt-in lifetime grant", () => {
    const bounded = createFixture();
    const boundedPair = bounded.service.mintPair({
      grantId: bounded.grantId,
      audience: "https://mcp.example/mcp"
    });
    expect(boundedPair.expiresIn).toBe(7 * 24 * 60 * 60);
    expect(boundedPair.accessExpiresAt).not.toBeNull();
    expect(boundedPair.refreshExpiresAt).not.toBeNull();
    expect(Date.parse(boundedPair.refreshExpiresAt!)).toBeGreaterThan(
      Date.parse(boundedPair.accessExpiresAt!)
    );

    const lifetime = createFixture(true);
    const lifetimePair = lifetime.service.mintPair({
      grantId: lifetime.grantId,
      audience: "https://mcp.example/mcp"
    });
    expect(lifetimePair.accessExpiresAt).toBeNull();
    expect(lifetimePair.refreshExpiresAt).toBeNull();
    expect(lifetimePair).not.toHaveProperty("expiresIn");
    expect(
      lifetime.service.verifyAccessToken(`Bearer ${lifetimePair.accessToken}`)
    ).toMatchObject({ grantId: lifetime.grantId, lifetime: true, expiresAt: null });

    const rows = tokenRows(lifetime.db);
    expect(rows.every((row) => row.expires_at === null)).toBe(true);
  });

  it("rotates in-family, revokes prior access, and kills the family on refresh reuse (AC-7)", () => {
    const { db, service, grantId, clientId } = createFixture(true);
    const first = service.mintPair({ grantId, audience: "https://mcp.example/mcp" });
    const rotated = service.rotateRefresh(first.refreshToken, {
      clientId,
      audience: "https://mcp.example/mcp"
    });

    expect(rotated.familyId).toBe(first.familyId);
    expect(rotated.accessToken).not.toBe(rotated.refreshToken);
    expect(rotated.accessToken).not.toBe(first.accessToken);
    expect(service.verifyAccessToken(`Bearer ${first.accessToken}`)).toBeNull();
    expect(service.verifyAccessToken(`Bearer ${rotated.accessToken}`)).toMatchObject({
      familyId: first.familyId
    });

    const rowsAfterRotation = tokenRows(db);
    const oldAccess = rowsAfterRotation.find((row) => row.id === first.accessTokenId);
    const oldRefresh = rowsAfterRotation.find((row) => row.id === first.refreshTokenId);
    const replacements = rowsAfterRotation.filter(
      (row) => row.id === rotated.accessTokenId || row.id === rotated.refreshTokenId
    );
    expect(oldAccess).toMatchObject({ revoked: 1 });
    expect(oldRefresh?.revoked).toBe(1);
    expect(oldRefresh?.rotated_at).not.toBeNull();
    expect(replacements).toHaveLength(2);
    expect(replacements.every((row) => row.rotated_from === first.refreshTokenId)).toBe(true);

    expectTokenError(() => service.rotateRefresh(first.refreshToken), "invalid_grant");
    expect(service.verifyAccessToken(`Bearer ${rotated.accessToken}`)).toBeNull();
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM mcp_tokens WHERE family_id = ? AND revoked = 0")
        .get(first.familyId) as { count: number }).count
    ).toBe(0);

    const audit = db
      .prepare("SELECT action_type, details FROM audit_log WHERE surface = 'mcp' ORDER BY id")
      .all() as Array<{ action_type: string; details: string }>;
    expect(audit.map((row) => row.action_type)).toEqual([
      "mcp_token_issued",
      "mcp_token_refreshed",
      "mcp_family_revoked"
    ]);
    const auditText = JSON.stringify(audit);
    for (const secret of [
      first.accessToken,
      first.refreshToken,
      rotated.accessToken,
      rotated.refreshToken
    ]) {
      expect(auditText).not.toContain(secret);
    }
  });

  it("keeps successful bearer verification valid when last_used_at writes fail", () => {
    const { db, service, grantId } = createFixture();
    const pair = service.mintPair({ grantId, audience: "https://mcp.example/mcp" });
    db.exec(`
      CREATE TRIGGER fail_mcp_token_last_used
      BEFORE UPDATE OF last_used_at ON mcp_tokens
      BEGIN
        SELECT RAISE(FAIL, 'forced last_used_at failure');
      END;
    `);

    expect(service.verifyAccessToken(`Bearer ${pair.accessToken}`)).toMatchObject({ grantId });
    const token = db.prepare("SELECT last_used_at FROM mcp_tokens WHERE id = ?")
      .get(pair.accessTokenId) as { last_used_at: string | null };
    const grant = db.prepare("SELECT last_used_at FROM mcp_grants WHERE id = ?")
      .get(grantId) as { last_used_at: string | null };
    expect(token.last_used_at).toBeNull();
    expect(grant.last_used_at).toBeNull();
  });
});
