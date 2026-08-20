import { DatabaseService } from "../db/database.js";
import { AuditService } from "../services/audit-service.js";
import {
  MCP_ACCESS_TOKEN_TTL_DAYS_DEFAULT,
  MCP_ACCESS_TOKEN_TTL_DAYS_MAX,
  MCP_ACCESS_TOKEN_TTL_DAYS_MIN,
  MCP_PERMISSION_SET,
  MCP_TOOL_NAMES,
  type McpToolName
} from "./mcp-constants.js";
import { McpTokenService } from "./mcp-token-service.js";

export class McpGrantError extends Error {
  constructor(
    readonly code: "already_active" | "not_found" | "invalid_scope" | "invalid_permissions" | "invalid_ttl",
    message: string
  ) {
    super(message);
    this.name = "McpGrantError";
  }
}

export type McpScopeType = "sessions" | "group";

export interface McpGrantRow {
  id: number;
  clientId: string;
  scopeType: McpScopeType;
  scopeRef: string;
  permissions: McpToolName[];
  lifetime: boolean;
  tokenTtlDays: number;
  grantedBy: number;
  status: "active" | "revoked";
}

export interface CreateMcpGrantInput {
  clientId: string;
  grantedBy: number;
  scopeType: McpScopeType;
  scopeRef: string;
  permissions: string[];
  lifetime?: boolean;
  tokenTtlDays?: number;
}

const SESSION_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export function isSqliteUniqueConstraint(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT" ||
    /UNIQUE constraint failed/i.test(message)
  );
}

function mapGrantWriteError(err: unknown): never {
  if (isSqliteUniqueConstraint(err)) {
    throw new McpGrantError("already_active", "An active grant already exists for this client");
  }
  throw err;
}

function normalizePermissions(perms: string[]): McpToolName[] {
  const out: McpToolName[] = [];
  const seen = new Set<string>();
  for (const raw of perms) {
    if (!MCP_PERMISSION_SET.has(raw as McpToolName)) {
      throw new McpGrantError("invalid_permissions", "permissions must be a subset of the six MCP tools");
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw as McpToolName);
  }
  out.sort((a, b) => MCP_TOOL_NAMES.indexOf(a) - MCP_TOOL_NAMES.indexOf(b));
  return out;
}

function normalizeScope(scopeType: McpScopeType, scopeRef: string): string {
  if (scopeType === "group") {
    const id = scopeRef.trim();
    if (!id || id.length > 80) throw new McpGrantError("invalid_scope", "invalid group id");
    return id;
  }
  if (scopeType !== "sessions") {
    throw new McpGrantError("invalid_scope", "scope_type must be sessions or group");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(scopeRef);
  } catch {
    throw new McpGrantError("invalid_scope", "sessions scope_ref must be a JSON array");
  }
  if (!Array.isArray(parsed)) {
    throw new McpGrantError("invalid_scope", "sessions scope_ref must be a JSON array");
  }
  const names = Array.from(
    new Set(parsed.map((s) => String(s).trim()).filter((s) => SESSION_NAME_RE.test(s)))
  ).sort();
  return JSON.stringify(names);
}

function parsePermissions(raw: string): McpToolName[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizePermissions(parsed.map(String)) : [];
  } catch {
    return [];
  }
}

export class McpGrantService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: McpTokenService = new McpTokenService(db),
    private readonly audit: AuditService = new AuditService(db)
  ) {}

  create(input: CreateMcpGrantInput): McpGrantRow {
    const scopeRef = normalizeScope(input.scopeType, input.scopeRef);
    const permissions = normalizePermissions(input.permissions);
    const ttl = input.tokenTtlDays ?? MCP_ACCESS_TOKEN_TTL_DAYS_DEFAULT;
    if (!Number.isInteger(ttl) || ttl < MCP_ACCESS_TOKEN_TTL_DAYS_MIN || ttl > MCP_ACCESS_TOKEN_TTL_DAYS_MAX) {
      throw new McpGrantError("invalid_ttl", "token_ttl_days must be an integer 7..10");
    }
    const lifetime = input.lifetime ? 1 : 0;

    try {
      return this.db.transaction(() => {
        this.supersedeActiveLocked(input.clientId, input.grantedBy);
        const result = this.db
          .prepare(
            `INSERT INTO mcp_grants
               (client_id, scope_type, scope_ref, permissions, lifetime, token_ttl_days, granted_by, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
          )
          .run(
            input.clientId,
            input.scopeType,
            scopeRef,
            JSON.stringify(permissions),
            lifetime,
            ttl,
            input.grantedBy
          );
        const id = Number(result.lastInsertRowid);
        this.audit.log({
          userId: input.grantedBy,
          actionType: "mcp_consent_granted",
          resourceType: "mcp_grant",
          resourceId: String(id),
          details: { grant_id: id, client_id: input.clientId, superseded: true },
          surface: "mcp"
        });
        return this.require(id);
      });
    } catch (err) {
      mapGrantWriteError(err);
    }
  }

  editScope(grantId: number, scopeType: McpScopeType, scopeRef: string): McpGrantRow {
    const grant = this.requireActive(grantId);
    const next = normalizeScope(scopeType, scopeRef);
    this.db
      .prepare("UPDATE mcp_grants SET scope_type = ?, scope_ref = ? WHERE id = ? AND status = 'active'")
      .run(scopeType, next, grant.id);
    this.audit.log({
      userId: grant.grantedBy,
      actionType: "mcp_grant_scope_updated",
      resourceType: "mcp_grant",
      resourceId: String(grant.id),
      details: { grant_id: grant.id, scope_type: scopeType },
      surface: "mcp"
    });
    return this.require(grantId);
  }

  editPermissions(grantId: number, perms: string[]): McpGrantRow {
    const grant = this.requireActive(grantId);
    const next = normalizePermissions(perms);
    this.db
      .prepare("UPDATE mcp_grants SET permissions = ? WHERE id = ? AND status = 'active'")
      .run(JSON.stringify(next), grant.id);
    this.audit.log({
      userId: grant.grantedBy,
      actionType: "mcp_grant_permissions_updated",
      resourceType: "mcp_grant",
      resourceId: String(grant.id),
      details: { grant_id: grant.id, permissions: next },
      surface: "mcp"
    });
    return this.require(grantId);
  }

  setLifetime(grantId: number, on: boolean): McpGrantRow {
    const grant = this.requireActive(grantId);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE mcp_grants SET lifetime = ? WHERE id = ? AND status = 'active'").run(on ? 1 : 0, grant.id);
      if (on) {
        this.db
          .prepare(
            `UPDATE mcp_tokens
             SET expires_at = NULL
             WHERE grant_id = ? AND token_type = 'access' AND revoked = 0`
          )
          .run(grant.id);
      } else {
        const ttlMs = grant.tokenTtlDays * 24 * 60 * 60 * 1000;
        const expires = new Date(Date.now() + ttlMs).toISOString();
        this.db
          .prepare(
            `UPDATE mcp_tokens
             SET expires_at = ?
             WHERE grant_id = ? AND token_type = 'access' AND revoked = 0 AND expires_at IS NULL`
          )
          .run(expires, grant.id);
      }
    });
    this.audit.log({
      userId: grant.grantedBy,
      actionType: "mcp_grant_lifetime_updated",
      resourceType: "mcp_grant",
      resourceId: String(grant.id),
      details: { grant_id: grant.id, lifetime: on, at: now },
      surface: "mcp"
    });
    return this.require(grantId);
  }

  get(grantId: number): McpGrantRow | null {
    const row = this.db
      .prepare(
        `SELECT id, client_id, scope_type, scope_ref, permissions, lifetime, token_ttl_days, granted_by, status
         FROM mcp_grants WHERE id = ?`
      )
      .get(grantId) as
      | {
          id: number;
          client_id: string;
          scope_type: McpScopeType;
          scope_ref: string;
          permissions: string;
          lifetime: number;
          token_ttl_days: number;
          granted_by: number;
          status: "active" | "revoked";
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      clientId: row.client_id,
      scopeType: row.scope_type,
      scopeRef: row.scope_ref,
      permissions: parsePermissions(row.permissions),
      lifetime: row.lifetime === 1,
      tokenTtlDays: row.token_ttl_days,
      grantedBy: row.granted_by,
      status: row.status
    };
  }

  private require(grantId: number): McpGrantRow {
    const row = this.get(grantId);
    if (!row) throw new McpGrantError("not_found", "grant not found");
    return row;
  }

  private requireActive(grantId: number): McpGrantRow {
    const row = this.require(grantId);
    if (row.status !== "active") throw new McpGrantError("not_found", "grant is not active");
    return row;
  }

  private supersedeActiveLocked(clientId: string, grantedBy: number): void {
    const prior = this.db
      .prepare("SELECT id FROM mcp_grants WHERE client_id = ? AND status = 'active'")
      .all(clientId) as { id: number }[];
    const now = new Date().toISOString();
    for (const old of prior) {
      const families = this.db
        .prepare("SELECT DISTINCT family_id FROM mcp_tokens WHERE grant_id = ?")
        .all(old.id) as { family_id: string }[];
      for (const fam of families) {
        this.tokens.revokeFamily(fam.family_id, "supersede");
      }
      this.db
        .prepare("UPDATE mcp_grants SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'")
        .run(now, old.id);
      this.audit.log({
        userId: grantedBy,
        actionType: "mcp_grant_revoked",
        resourceType: "mcp_grant",
        resourceId: String(old.id),
        details: { grant_id: old.id, client_id: clientId, reason: "supersede" },
        surface: "mcp"
      });
    }
  }
}
