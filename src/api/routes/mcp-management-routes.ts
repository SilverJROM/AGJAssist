import { FastifyInstance, FastifyReply } from "fastify";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { DatabaseService } from "../../db/database.js";
import { AuditService } from "../../services/audit-service.js";
import { McpClientService } from "../../mcp/mcp-client-service.js";
import { McpGrantError, McpGrantService, type McpScopeType } from "../../mcp/mcp-grant-service.js";
import { McpPoolError, McpPoolService } from "../../mcp/mcp-pool-service.js";

const LIFETIME_CONFIRM = "LIFETIME";
const SESSION_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export interface McpManagementRouteDeps {
  db: DatabaseService;
  authService: AuthService;
  pool: McpPoolService;
  grants: McpGrantService;
  clients: McpClientService;
  audit: AuditService;
}

function parseGrantId(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function loadMutableGrant(
  grants: McpGrantService,
  id: number,
  reply: FastifyReply
): ReturnType<McpGrantService["get"]> {
  const grant = grants.get(id);
  if (!grant) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  if (grant.status !== "active") {
    reply.code(409).send({ error: "grant_not_active" });
    return null;
  }
  return grant;
}

function mapGrantError(err: unknown, reply: FastifyReply) {
  if (err instanceof McpGrantError) {
    const status = err.code === "not_found" ? 404 : 400;
    return reply.code(status).send({ error: err.code, error_description: err.message });
  }
  throw err;
}

export function registerMcpManagementRoutes(app: FastifyInstance, deps: McpManagementRouteDeps): void {
  const authMiddleware = createAuthMiddleware(deps.authService);
  const gate = { preHandler: [authMiddleware, requireOwner] };

  app.get("/api/mcp/pool", gate, async () => {
    return { sessions: deps.pool.list() };
  });

  app.put("/api/mcp/pool", gate, async (request, reply) => {
    const body = (request.body ?? {}) as { sessions?: unknown };
    if (!Array.isArray(body.sessions)) {
      return reply.code(400).send({ error: "sessions must be an array" });
    }
    try {
      const sessions = deps.pool.replaceSet(request.sessionUser!.id, body.sessions.map(String));
      return { sessions };
    } catch (err) {
      if (err instanceof McpPoolError) {
        return reply.code(400).send({ error: "invalid_pool", error_description: err.message });
      }
      throw err;
    }
  });

  app.get("/api/mcp/grants", gate, async () => {
    const grants = deps.grants.listConnected().map((g) => ({
      id: g.id,
      client_id: g.clientId,
      client_id_suffix: g.clientId.slice(-8),
      client_name: g.clientName,
      scope_type: g.scopeType,
      scope_ref: g.scopeRef,
      permissions: g.permissions,
      lifetime: g.lifetime,
      token_ttl_days: g.tokenTtlDays,
      status: g.status,
      granted_at: g.grantedAt,
      last_used_at: g.lastUsedAt,
      access_expires_at: g.lifetime ? null : g.accessExpiresAt
    }));
    return { grants };
  });

  app.patch("/api/mcp/grants/:id/scope", gate, async (request, reply) => {
    const id = parseGrantId((request.params as { id: string }).id);
    if (id == null) return reply.code(404).send({ error: "not_found" });
    if (!loadMutableGrant(deps.grants, id, reply)) return;

    const body = (request.body ?? {}) as {
      sessions?: unknown;
      scope_type?: unknown;
      scope_ref?: unknown;
    };
    let scopeType: McpScopeType = "sessions";
    let scopeRef: string;
    if (Array.isArray(body.sessions)) {
      const names = body.sessions.map(String);
      const pool = new Set(deps.pool.list());
      if (names.length > 0 && pool.size === 0) {
        return reply.code(400).send({ error: "empty_pool" });
      }
      for (const name of names) {
        if (!SESSION_NAME_RE.test(name) || !pool.has(name)) {
          return reply.code(400).send({ error: "outside_pool" });
        }
      }
      scopeType = "sessions";
      scopeRef = JSON.stringify(names);
    } else if (typeof body.scope_type === "string" && typeof body.scope_ref === "string") {
      if (body.scope_type !== "sessions" && body.scope_type !== "group") {
        return reply.code(400).send({ error: "invalid_scope" });
      }
      scopeType = body.scope_type;
      scopeRef = body.scope_ref;
      if (scopeType === "sessions") {
        let names: unknown[] = [];
        try {
          names = JSON.parse(scopeRef) as unknown[];
        } catch {
          return reply.code(400).send({ error: "invalid_scope" });
        }
        if (!Array.isArray(names)) return reply.code(400).send({ error: "invalid_scope" });
        const pool = new Set(deps.pool.list());
        if (names.length > 0 && pool.size === 0) {
          return reply.code(400).send({ error: "empty_pool" });
        }
        for (const name of names) {
          if (!pool.has(String(name))) {
            return reply.code(400).send({ error: "outside_pool" });
          }
        }
      }
    } else {
      return reply.code(400).send({ error: "invalid_scope" });
    }

    try {
      const grant = deps.grants.editScope(id, scopeType, scopeRef);
      return {
        id: grant.id,
        scope_type: grant.scopeType,
        scope_ref: grant.scopeRef
      };
    } catch (err) {
      return mapGrantError(err, reply);
    }
  });

  app.patch("/api/mcp/grants/:id/permissions", gate, async (request, reply) => {
    const id = parseGrantId((request.params as { id: string }).id);
    if (id == null) return reply.code(404).send({ error: "not_found" });
    if (!loadMutableGrant(deps.grants, id, reply)) return;
    const body = (request.body ?? {}) as { permissions?: unknown };
    if (!Array.isArray(body.permissions)) {
      return reply.code(400).send({ error: "invalid_permissions" });
    }
    try {
      const grant = deps.grants.editPermissions(id, body.permissions.map(String));
      return { id: grant.id, permissions: grant.permissions };
    } catch (err) {
      return mapGrantError(err, reply);
    }
  });

  app.patch("/api/mcp/grants/:id/lifetime", gate, async (request, reply) => {
    const id = parseGrantId((request.params as { id: string }).id);
    if (id == null) return reply.code(404).send({ error: "not_found" });
    if (!loadMutableGrant(deps.grants, id, reply)) return;
    const body = (request.body ?? {}) as { lifetime?: unknown; confirm?: unknown };
    if (body.confirm !== LIFETIME_CONFIRM) {
      return reply.code(400).send({ error: "confirm_required" });
    }
    if (typeof body.lifetime !== "boolean") {
      return reply.code(400).send({ error: "invalid_lifetime" });
    }
    try {
      const grant = deps.grants.setLifetime(id, body.lifetime);
      return { id: grant.id, lifetime: grant.lifetime };
    } catch (err) {
      return mapGrantError(err, reply);
    }
  });

  app.post("/api/mcp/grants/:id/revoke", gate, async (request, reply) => {
    const id = parseGrantId((request.params as { id: string }).id);
    if (id == null) return reply.code(404).send({ error: "not_found" });
    if (!loadMutableGrant(deps.grants, id, reply)) return;
    try {
      const grant = deps.grants.revoke(id);
      return { id: grant.id, status: grant.status };
    } catch (err) {
      return mapGrantError(err, reply);
    }
  });

  app.get("/api/mcp/audit", gate, async (request) => {
    const query = (request.query ?? {}) as { limit?: unknown; offset?: unknown };
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const entries = deps.audit.query({
      surface: "mcp",
      limit,
      offset
    });
    return { entries, limit, offset };
  });

  app.get("/api/mcp/clients", gate, async () => {
    return { clients: deps.clients.list() };
  });

  app.delete("/api/mcp/clients/:id", gate, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const result = deps.clients.remove(id);
    if (result === "missing") return reply.code(404).send({ error: "not_found" });
    if (result === "in_use") return reply.code(409).send({ error: "has_grant_history" });
    return reply.code(204).send();
  });
}
