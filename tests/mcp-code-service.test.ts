import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import {
  createPkceS256Challenge,
  McpCodeError,
  McpCodeService
} from "../src/mcp/mcp-code-service.js";
import { hashMcpSecret, McpTokenService } from "../src/mcp/mcp-token-service.js";

interface Fixture {
  db: DatabaseService;
  dbPath: string;
  codes: McpCodeService;
  tokens: McpTokenService;
  clientId: string;
  grantId: number;
}

const tempDirs: string[] = [];
const openDatabases: DatabaseService[] = [];
const redirectUri = "https://client.example/oauth/callback?return=%2Fhome";
const audience = "https://mcp.example/mcp";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

function createFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-code-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "test.sqlite");
  const db = new DatabaseService(dbPath);
  openDatabases.push(db);
  const clientId = "pkce-client";

  db.prepare(
    "INSERT INTO users (id, telegram_id, username, role) VALUES (1, 1001, 'owner', 'owner')"
  ).run();
  db.prepare(
    `INSERT INTO mcp_clients (id, client_name, redirect_uris)
     VALUES (?, 'pkce-agent', ?)`
  ).run(clientId, JSON.stringify([redirectUri]));
  const grant = db
    .prepare(
      `INSERT INTO mcp_grants
         (client_id, scope_type, scope_ref, permissions, lifetime, token_ttl_days, granted_by)
       VALUES (?, 'sessions', '["north"]', '["read_session"]', 0, 7, 1)`
    )
    .run(clientId);
  const grantId = Number(grant.lastInsertRowid);
  const tokens = new McpTokenService(db);

  return {
    db,
    dbPath,
    codes: new McpCodeService(db, tokens),
    tokens,
    clientId,
    grantId
  };
}

function expectCodeError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("expected McpCodeError");
  } catch (error) {
    expect(error).toBeInstanceOf(McpCodeError);
    expect((error as McpCodeError).code).toBe(code);
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

describe("McpCodeService B7", () => {
  it("implements PKCE S256 and persists only a hash and challenge", () => {
    const { db, dbPath, codes, clientId, grantId } = createFixture();
    const challenge = createPkceS256Challenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

    const before = Date.now();
    const issued = codes.issueCode({
      grantId,
      clientId,
      redirectUri,
      codeChallenge: challenge,
      audience
    });
    const row = db
      .prepare("SELECT * FROM mcp_authorization_codes WHERE id = ?")
      .get(issued.codeId) as Record<string, unknown>;

    expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(issued.code, "base64url")).toHaveLength(32);
    expect(row.code_hash).toBe(hashMcpSecret(issued.code));
    expect(row.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.code_challenge).toBe(challenge);
    expect(row.family_id).toBe(issued.familyId);
    expect(row.client_id).toBe(clientId);
    expect(row.redirect_uri).toBe(redirectUri);
    expect(row.audience).toBe(audience);
    expect(Date.parse(String(row.expires_at))).toBeGreaterThan(before);
    expect(Date.parse(String(row.expires_at))).toBeLessThanOrEqual(before + 10 * 60 * 1000 + 1000);

    const stored = JSON.stringify({
      codes: db.prepare("SELECT * FROM mcp_authorization_codes").all(),
      tokens: db.prepare("SELECT * FROM mcp_tokens").all(),
      audit: db.prepare("SELECT details FROM audit_log WHERE surface = 'mcp'").all()
    });
    expect(stored).not.toContain(issued.code);
    expect(stored).not.toContain(verifier);

    db.raw.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    openDatabases.splice(openDatabases.indexOf(db), 1);
    const durableBytes = fs.readFileSync(dbPath);
    expect(durableBytes.includes(Buffer.from(issued.code))).toBe(false);
    expect(durableBytes.includes(Buffer.from(verifier))).toBe(false);
  });

  it("returns invalid_grant for a wrong verifier without consuming the code", () => {
    const { db, codes, tokens, clientId, grantId } = createFixture();
    const issued = codes.issueCode({
      grantId,
      clientId,
      redirectUri,
      codeChallenge: createPkceS256Challenge(verifier),
      audience
    });

    expectCodeError(
      () =>
        codes.exchangeCode({
          code: issued.code,
          clientId,
          redirectUri,
          codeVerifier: "x".repeat(43),
          audience
        }),
      "invalid_grant"
    );
    const unused = db
      .prepare("SELECT used_at FROM mcp_authorization_codes WHERE id = ?")
      .get(issued.codeId) as { used_at: string | null };
    expect(unused.used_at).toBeNull();
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM mcp_tokens").get() as { count: number }).count
    ).toBe(0);

    const pair = codes.exchangeCode({
      code: issued.code,
      clientId,
      redirectUri,
      codeVerifier: verifier,
      audience
    });
    expect(pair.familyId).toBe(issued.familyId);
    expect(tokens.verifyAccessToken(`Bearer ${pair.accessToken}`, audience)).toMatchObject({
      grantId,
      clientId
    });
  });

  it("enforces client, exact redirect, audience, active grant, and code expiry bindings", () => {
    const { db, codes, clientId, grantId } = createFixture();
    const issued = codes.issueCode({
      grantId,
      clientId,
      redirectUri,
      codeChallenge: createPkceS256Challenge(verifier),
      audience
    });
    const base = { code: issued.code, clientId, redirectUri, codeVerifier: verifier, audience };

    expectCodeError(() => codes.exchangeCode({ ...base, clientId: "other-client" }), "invalid_grant");
    expectCodeError(
      () => codes.exchangeCode({ ...base, redirectUri: `${redirectUri}/suffix` }),
      "invalid_grant"
    );
    expectCodeError(
      () => codes.exchangeCode({ ...base, audience: "https://other.example/mcp" }),
      "invalid_target"
    );
    expect(
      (db.prepare("SELECT used_at FROM mcp_authorization_codes WHERE id = ?").get(issued.codeId) as {
        used_at: string | null;
      }).used_at
    ).toBeNull();

    db.prepare("UPDATE mcp_authorization_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .run(issued.codeId);
    expectCodeError(() => codes.exchangeCode(base), "invalid_grant");
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM mcp_authorization_codes WHERE id = ?")
        .get(issued.codeId) as { count: number }).count
    ).toBe(1);
  });

  it("keeps a used code and kills its issued token family on replay (AC-7 blocker 3)", () => {
    const { db, codes, tokens, clientId, grantId } = createFixture();
    const issued = codes.issueCode({
      grantId,
      clientId,
      redirectUri,
      codeChallenge: createPkceS256Challenge(verifier),
      audience
    });
    const exchange = {
      code: issued.code,
      clientId,
      redirectUri,
      codeVerifier: verifier,
      audience
    };
    const pair = codes.exchangeCode(exchange);

    expect(tokens.verifyAccessToken(`Bearer ${pair.accessToken}`, audience)).not.toBeNull();
    const used = db
      .prepare("SELECT used_at, expires_at FROM mcp_authorization_codes WHERE id = ?")
      .get(issued.codeId) as { used_at: string | null; expires_at: string };
    expect(used.used_at).not.toBeNull();
    expect(Date.parse(used.expires_at)).toBeGreaterThan(Date.now());

    expectCodeError(() => codes.exchangeCode(exchange), "invalid_grant");
    expect(tokens.verifyAccessToken(`Bearer ${pair.accessToken}`, audience)).toBeNull();
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM mcp_tokens WHERE family_id = ? AND revoked = 0")
        .get(issued.familyId) as { count: number }).count
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM mcp_authorization_codes WHERE id = ?")
        .get(issued.codeId) as { count: number }).count
    ).toBe(1);

    const familyAudit = db
      .prepare("SELECT details FROM audit_log WHERE action_type = 'mcp_family_revoked'")
      .get() as { details: string };
    expect(JSON.parse(familyAudit.details)).toMatchObject({
      grant_id: grantId,
      client_id: clientId,
      reason: "authorization_code_replay"
    });
    const persisted = JSON.stringify({
      code: db.prepare("SELECT * FROM mcp_authorization_codes").all(),
      tokens: db.prepare("SELECT * FROM mcp_tokens").all(),
      audit: db.prepare("SELECT details FROM audit_log WHERE surface = 'mcp'").all()
    });
    for (const secret of [issued.code, verifier, pair.accessToken, pair.refreshToken]) {
      expect(persisted).not.toContain(secret);
    }
  });

  it("rejects non-S256 challenge shapes at issue time", () => {
    const { codes, clientId, grantId } = createFixture();
    expectCodeError(
      () =>
        codes.issueCode({
          grantId,
          clientId,
          redirectUri,
          codeChallenge: "plain",
          audience
        }),
      "invalid_request"
    );
  });
});
