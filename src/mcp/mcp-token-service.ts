import crypto from "node:crypto";
import { DatabaseService } from "../db/database.js";
import { AuditService } from "../services/audit-service.js";
import {
  MCP_ACCESS_TOKEN_TTL_DAYS_MAX,
  MCP_ACCESS_TOKEN_TTL_DAYS_MIN,
  MCP_REFRESH_TOKEN_TTL_DAYS
} from "./mcp-constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPAQUE_SECRET_BYTES = 32;
const OPAQUE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type McpTokenErrorCode = "invalid_grant" | "invalid_client" | "invalid_target";

export class McpTokenError extends Error {
  constructor(readonly code: McpTokenErrorCode) {
    super(code);
    this.name = "McpTokenError";
  }
}

export interface MintMcpTokenPairInput {
  grantId: number;
  audience: string;
  familyId?: string;
  rotatedFrom?: string | null;
  expectedClientId?: string;
}

export interface RotateMcpRefreshContext {
  clientId?: string;
  audience?: string;
}

export interface McpTokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn?: number;
  accessTokenId: string;
  refreshTokenId: string;
  familyId: string;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
}

export interface McpGrantBinding {
  tokenId: string;
  familyId: string;
  audience: string;
  expiresAt: string | null;
  grantId: number;
  clientId: string;
  clientName: string;
  scopeType: "sessions" | "group";
  scopeRef: string;
  permissions: string;
  lifetime: boolean;
  tokenTtlDays: number;
  grantedBy: number;
}

interface GrantRow {
  id: number;
  client_id: string;
  client_name: string;
  lifetime: number;
  token_ttl_days: number;
  granted_by: number;
  status: "active" | "revoked";
}

interface TokenRow {
  id: string;
  grant_id: number;
  client_id: string;
  token_hash: string;
  token_type: "access" | "refresh";
  family_id: string;
  audience: string;
  expires_at: string | null;
  revoked: number;
  rotated_at: string | null;
  grant_status: "active" | "revoked";
}

interface VerifiedRow {
  token_id: string;
  family_id: string;
  audience: string;
  expires_at: string | null;
  grant_id: number;
  client_id: string;
  client_name: string;
  scope_type: "sessions" | "group";
  scope_ref: string;
  permissions: string;
  lifetime: number;
  token_ttl_days: number;
  granted_by: number;
  token_hash: string;
}

export function generateMcpOpaqueSecret(): string {
  return crypto.randomBytes(OPAQUE_SECRET_BYTES).toString("base64url");
}

export function hashMcpSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function hashesMatch(presentedHash: string, storedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedHash) || presentedHash.length !== storedHash.length) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(presentedHash, "hex"),
    Buffer.from(storedHash, "hex")
  );
}

function expiresAt(date: Date, days: number): string {
  return new Date(date.getTime() + days * DAY_MS).toISOString();
}

function isExpired(value: string | null, now: Date): boolean {
  if (value === null) return false;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

function tokenError(code: McpTokenErrorCode): never {
  throw new McpTokenError(code);
}

export class McpTokenService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService = new AuditService(db)
  ) {}

  mintPair(input: MintMcpTokenPairInput): McpTokenPair {
    return this.db.transaction(() => {
      const grant = this.requireActiveGrant(input.grantId, input.expectedClientId);
      return this.insertPair(
        grant,
        input.audience,
        input.familyId ?? crypto.randomUUID(),
        input.rotatedFrom ?? null,
        "mcp_token_issued"
      );
    });
  }

  rotateRefresh(rawRefreshToken: string, expected: RotateMcpRefreshContext = {}): McpTokenPair {
    const presentedHash = hashMcpSecret(rawRefreshToken);
    const found = this.findTokenByHash(presentedHash);
    if (!found || !hashesMatch(presentedHash, found.token_hash) || found.token_type !== "refresh") {
      return tokenError("invalid_grant");
    }

    if (found.rotated_at !== null) {
      this.revokeFamily(found.family_id, "refresh_reuse");
      return tokenError("invalid_grant");
    }

    if (expected.clientId !== undefined && found.client_id !== expected.clientId) {
      return tokenError("invalid_client");
    }
    if (expected.audience !== undefined && found.audience !== expected.audience) {
      return tokenError("invalid_target");
    }
    if (found.revoked !== 0 || found.grant_status !== "active" || isExpired(found.expires_at, new Date())) {
      return tokenError("invalid_grant");
    }

    const result = this.db.transaction(() => {
      const current = this.findTokenById(found.id);
      if (!current || current.rotated_at !== null) {
        return { reusedFamilyId: found.family_id } as const;
      }
      if (current.revoked !== 0 || current.grant_status !== "active" || isExpired(current.expires_at, new Date())) {
        return tokenError("invalid_grant");
      }

      const now = new Date().toISOString();
      const rotated = this.db
        .prepare(
          `UPDATE mcp_tokens
           SET revoked = 1, revoked_at = ?, rotated_at = ?
           WHERE id = ? AND revoked = 0 AND rotated_at IS NULL`
        )
        .run(now, now, current.id);
      if (rotated.changes !== 1) {
        return { reusedFamilyId: current.family_id } as const;
      }

      this.db
        .prepare(
          `UPDATE mcp_tokens
           SET revoked = 1, revoked_at = COALESCE(revoked_at, ?)
           WHERE family_id = ? AND token_type = 'access' AND revoked = 0`
        )
        .run(now, current.family_id);

      const grant = this.requireActiveGrant(current.grant_id, current.client_id);
      return this.insertPair(
        grant,
        current.audience,
        current.family_id,
        current.id,
        "mcp_token_refreshed"
      );
    });

    if ("reusedFamilyId" in result) {
      this.revokeFamily(result.reusedFamilyId, "refresh_reuse");
      return tokenError("invalid_grant");
    }
    return result;
  }

  verifyAccessToken(
    authorizationHeader: string | string[] | null | undefined,
    expectedAudience?: string
  ): McpGrantBinding | null {
    if (typeof authorizationHeader !== "string") return null;
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorizationHeader);
    if (!match || !OPAQUE_SECRET_PATTERN.test(match[1])) return null;

    const presentedHash = hashMcpSecret(match[1]);
    let row: VerifiedRow | undefined;
    try {
      row = this.db
        .prepare(
          `SELECT
             t.id AS token_id, t.family_id, t.audience, t.expires_at, t.token_hash,
             g.id AS grant_id, g.client_id, c.client_name, g.scope_type, g.scope_ref,
             g.permissions, g.lifetime, g.token_ttl_days, g.granted_by
           FROM mcp_tokens t
           JOIN mcp_grants g ON g.id = t.grant_id
           JOIN mcp_clients c ON c.id = g.client_id
           WHERE t.token_hash = ?
             AND t.token_type = 'access'
             AND t.revoked = 0
             AND t.client_id = g.client_id
             AND (t.expires_at IS NULL OR julianday(t.expires_at) > julianday(?))
             AND g.status = 'active'`
        )
        .get(presentedHash, new Date().toISOString()) as VerifiedRow | undefined;
    } catch {
      return null;
    }

    if (!row || !hashesMatch(presentedHash, row.token_hash)) return null;
    if (expectedAudience !== undefined && row.audience !== expectedAudience) return null;

    const binding: McpGrantBinding = {
      tokenId: row.token_id,
      familyId: row.family_id,
      audience: row.audience,
      expiresAt: row.expires_at,
      grantId: row.grant_id,
      clientId: row.client_id,
      clientName: row.client_name,
      scopeType: row.scope_type,
      scopeRef: row.scope_ref,
      permissions: row.permissions,
      lifetime: row.lifetime === 1,
      tokenTtlDays: row.token_ttl_days,
      grantedBy: row.granted_by
    };

    try {
      const now = new Date().toISOString();
      this.db.transaction(() => {
        this.db.prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?").run(now, row.token_id);
        this.db.prepare("UPDATE mcp_grants SET last_used_at = ? WHERE id = ?").run(now, row.grant_id);
      });
    } catch {
      // Usage timestamps are explicitly best-effort and never invalidate an accepted bearer.
    }

    return binding;
  }

  revokeFamily(familyId: string, reason: string = "security_event"): number {
    const context = this.db
      .prepare(
        `SELECT g.id AS grant_id, g.client_id, g.granted_by, c.client_name
         FROM mcp_tokens t
         JOIN mcp_grants g ON g.id = t.grant_id
         JOIN mcp_clients c ON c.id = g.client_id
         WHERE t.family_id = ?
         LIMIT 1`
      )
      .get(familyId) as
      | { grant_id: number; client_id: string; granted_by: number; client_name: string }
      | undefined;

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE mcp_tokens
         SET revoked = 1, revoked_at = COALESCE(revoked_at, ?)
         WHERE family_id = ? AND revoked = 0`
      )
      .run(now, familyId);

    if (context) {
      try {
        this.audit.log({
          userId: context.granted_by,
          agentName: context.client_name,
          actionType: "mcp_family_revoked",
          resourceType: "mcp_grant",
          resourceId: String(context.grant_id),
          details: {
            grant_id: context.grant_id,
            client_id: context.client_id,
            reason
          },
          surface: "mcp"
        });
      } catch {
        // Revocation is the security boundary; an audit write cannot undo it.
      }
    }

    return result.changes;
  }

  private requireActiveGrant(grantId: number, expectedClientId?: string): GrantRow {
    const grant = this.db
      .prepare(
        `SELECT g.id, g.client_id, c.client_name, g.lifetime, g.token_ttl_days, g.granted_by, g.status
         FROM mcp_grants g
         JOIN mcp_clients c ON c.id = g.client_id
         WHERE g.id = ?`
      )
      .get(grantId) as GrantRow | undefined;
    if (!grant || grant.status !== "active") return tokenError("invalid_grant");
    if (expectedClientId !== undefined && grant.client_id !== expectedClientId) {
      return tokenError("invalid_client");
    }
    if (
      !Number.isInteger(grant.token_ttl_days) ||
      grant.token_ttl_days < MCP_ACCESS_TOKEN_TTL_DAYS_MIN ||
      grant.token_ttl_days > MCP_ACCESS_TOKEN_TTL_DAYS_MAX
    ) {
      return tokenError("invalid_grant");
    }
    return grant;
  }

  private insertPair(
    grant: GrantRow,
    audience: string,
    familyId: string,
    rotatedFrom: string | null,
    auditAction: "mcp_token_issued" | "mcp_token_refreshed"
  ): McpTokenPair {
    if (audience.length === 0 || familyId.length === 0 || familyId.length > 128) {
      return tokenError("invalid_grant");
    }

    const issuedAt = new Date();
    const accessToken = generateMcpOpaqueSecret();
    const refreshToken = generateMcpOpaqueSecret();
    const accessTokenId = crypto.randomUUID();
    const refreshTokenId = crypto.randomUUID();
    const accessExpiry = grant.lifetime === 1 ? null : expiresAt(issuedAt, grant.token_ttl_days);
    const refreshExpiry = grant.lifetime === 1 ? null : expiresAt(issuedAt, MCP_REFRESH_TOKEN_TTL_DAYS);
    const insert = this.db.prepare(
      `INSERT INTO mcp_tokens
         (id, grant_id, client_id, token_hash, token_type, family_id, rotated_from, audience, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insert.run(
      accessTokenId,
      grant.id,
      grant.client_id,
      hashMcpSecret(accessToken),
      "access",
      familyId,
      rotatedFrom,
      audience,
      accessExpiry
    );
    insert.run(
      refreshTokenId,
      grant.id,
      grant.client_id,
      hashMcpSecret(refreshToken),
      "refresh",
      familyId,
      rotatedFrom,
      audience,
      refreshExpiry
    );

    this.audit.log({
      userId: grant.granted_by,
      agentName: grant.client_name,
      actionType: auditAction,
      resourceType: "mcp_grant",
      resourceId: String(grant.id),
      details: {
        grant_id: grant.id,
        client_id: grant.client_id,
        lifetime: grant.lifetime === 1
      },
      surface: "mcp"
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      ...(grant.lifetime === 1 ? {} : { expiresIn: grant.token_ttl_days * DAY_MS / 1000 }),
      accessTokenId,
      refreshTokenId,
      familyId,
      accessExpiresAt: accessExpiry,
      refreshExpiresAt: refreshExpiry
    };
  }

  private findTokenByHash(tokenHash: string): TokenRow | undefined {
    return this.db
      .prepare(
        `SELECT
           t.id, t.grant_id, t.client_id, t.token_hash, t.token_type, t.family_id,
           t.audience, t.expires_at, t.revoked, t.rotated_at, g.status AS grant_status
         FROM mcp_tokens t
         JOIN mcp_grants g ON g.id = t.grant_id
         WHERE t.token_hash = ?`
      )
      .get(tokenHash) as TokenRow | undefined;
  }

  private findTokenById(id: string): TokenRow | undefined {
    return this.db
      .prepare(
        `SELECT
           t.id, t.grant_id, t.client_id, t.token_hash, t.token_type, t.family_id,
           t.audience, t.expires_at, t.revoked, t.rotated_at, g.status AS grant_status
         FROM mcp_tokens t
         JOIN mcp_grants g ON g.id = t.grant_id
         WHERE t.id = ?`
      )
      .get(id) as TokenRow | undefined;
  }
}
