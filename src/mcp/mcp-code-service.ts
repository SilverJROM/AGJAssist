import crypto from "node:crypto";
import { DatabaseService } from "../db/database.js";
import { MCP_AUTH_CODE_TTL_MS } from "./mcp-constants.js";
import {
  generateMcpOpaqueSecret,
  hashMcpSecret,
  McpTokenPair,
  McpTokenService
} from "./mcp-token-service.js";

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_S256_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type McpCodeErrorCode =
  | "invalid_grant"
  | "invalid_request"
  | "invalid_target";

export class McpCodeError extends Error {
  constructor(readonly code: McpCodeErrorCode) {
    super(code);
    this.name = "McpCodeError";
  }
}

export interface IssueMcpCodeInput {
  grantId: number;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  audience: string;
  familyId?: string;
}

export interface IssuedMcpCode {
  code: string;
  codeId: string;
  familyId: string;
  expiresAt: string;
}

export interface ExchangeMcpCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  audience: string;
}

interface CodeRow {
  id: string;
  code_hash: string;
  grant_id: number;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  audience: string;
  family_id: string;
  expires_at: string;
  used_at: string | null;
  grant_client_id: string;
  grant_status: "active" | "revoked";
}

function codeError(code: McpCodeErrorCode): never {
  throw new McpCodeError(code);
}

function secureTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return crypto.timingSafeEqual(leftBytes, rightBytes);
}

function isExpired(value: string, now: Date): boolean {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

export function createPkceS256Challenge(codeVerifier: string): string {
  if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) return codeError("invalid_grant");
  return crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export class McpCodeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: McpTokenService
  ) {}

  issueCode(input: IssueMcpCodeInput): IssuedMcpCode {
    if (
      input.clientId.length === 0 ||
      input.redirectUri.length === 0 ||
      input.audience.length === 0 ||
      !PKCE_S256_CHALLENGE_PATTERN.test(input.codeChallenge)
    ) {
      return codeError("invalid_request");
    }

    return this.db.transaction(() => {
      const grant = this.db
        .prepare("SELECT client_id, status FROM mcp_grants WHERE id = ?")
        .get(input.grantId) as
        | { client_id: string; status: "active" | "revoked" }
        | undefined;
      if (!grant || grant.status !== "active" || grant.client_id !== input.clientId) {
        return codeError("invalid_grant");
      }

      const code = generateMcpOpaqueSecret();
      const codeId = crypto.randomUUID();
      const familyId = input.familyId ?? crypto.randomUUID();
      if (familyId.length === 0 || familyId.length > 128) return codeError("invalid_request");
      const expiresAt = new Date(Date.now() + MCP_AUTH_CODE_TTL_MS).toISOString();

      this.db
        .prepare(
          `INSERT INTO mcp_authorization_codes
             (id, code_hash, grant_id, client_id, redirect_uri, code_challenge, audience, family_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          codeId,
          hashMcpSecret(code),
          input.grantId,
          input.clientId,
          input.redirectUri,
          input.codeChallenge,
          input.audience,
          familyId,
          expiresAt
        );

      return { code, codeId, familyId, expiresAt };
    });
  }

  exchangeCode(input: ExchangeMcpCodeInput): McpTokenPair {
    const presentedHash = hashMcpSecret(input.code);
    const found = this.findCodeByHash(presentedHash);
    if (!found || !secureTextEqual(presentedHash, found.code_hash)) {
      return codeError("invalid_grant");
    }

    if (found.used_at !== null) {
      this.tokens.revokeFamily(found.family_id, "authorization_code_replay");
      return codeError("invalid_grant");
    }
    if (
      found.grant_status !== "active" ||
      found.client_id !== found.grant_client_id ||
      found.client_id !== input.clientId ||
      found.redirect_uri !== input.redirectUri ||
      isExpired(found.expires_at, new Date())
    ) {
      return codeError("invalid_grant");
    }
    if (found.audience !== input.audience) return codeError("invalid_target");

    let challenge: string;
    try {
      challenge = createPkceS256Challenge(input.codeVerifier);
    } catch {
      return codeError("invalid_grant");
    }
    if (!secureTextEqual(challenge, found.code_challenge)) {
      return codeError("invalid_grant");
    }

    const exchanged = this.db.transaction(() => {
      const now = new Date().toISOString();
      const used = this.db
        .prepare(
          `UPDATE mcp_authorization_codes
           SET used_at = ?
           WHERE id = ? AND used_at IS NULL AND julianday(expires_at) > julianday(?)`
        )
        .run(now, found.id, now);
      if (used.changes !== 1) return null;

      return this.tokens.mintPair({
        grantId: found.grant_id,
        expectedClientId: found.client_id,
        audience: found.audience,
        familyId: found.family_id
      });
    });

    if (exchanged === null) {
      const current = this.findCodeById(found.id);
      if (current?.used_at !== null) {
        this.tokens.revokeFamily(found.family_id, "authorization_code_replay");
      }
      return codeError("invalid_grant");
    }
    return exchanged;
  }

  private findCodeByHash(codeHash: string): CodeRow | undefined {
    return this.db
      .prepare(
        `SELECT
           c.id, c.code_hash, c.grant_id, c.client_id, c.redirect_uri, c.code_challenge,
           c.audience, c.family_id, c.expires_at, c.used_at,
           g.client_id AS grant_client_id, g.status AS grant_status
         FROM mcp_authorization_codes c
         JOIN mcp_grants g ON g.id = c.grant_id
         WHERE c.code_hash = ?`
      )
      .get(codeHash) as CodeRow | undefined;
  }

  private findCodeById(id: string): CodeRow | undefined {
    return this.db
      .prepare(
        `SELECT
           c.id, c.code_hash, c.grant_id, c.client_id, c.redirect_uri, c.code_challenge,
           c.audience, c.family_id, c.expires_at, c.used_at,
           g.client_id AS grant_client_id, g.status AS grant_status
         FROM mcp_authorization_codes c
         JOIN mcp_grants g ON g.id = c.grant_id
         WHERE c.id = ?`
      )
      .get(id) as CodeRow | undefined;
  }
}
