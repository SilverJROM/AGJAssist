import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "../../auth/auth-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { DatabaseService } from "../../db/database.js";
import { TerminalGroupsService } from "../../services/terminal-groups-service.js";
import { MCP_TOOL_NAMES } from "../../mcp/mcp-constants.js";
import { McpClientRegistrationError, McpClientService, type McpClientRow } from "../../mcp/mcp-client-service.js";
import { McpCodeError, McpCodeService } from "../../mcp/mcp-code-service.js";
import { McpGrantError, McpGrantService } from "../../mcp/mcp-grant-service.js";
import { McpPoolService } from "../../mcp/mcp-pool-service.js";
import { McpTokenService } from "../../mcp/mcp-token-service.js";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
  resolveMcpOrigin
} from "../../mcp/oauth-metadata.js";

const CONSENT_HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/public/mcp-consent.html");
/** S256 challenge = BASE64URL(SHA256(verifier)) — 43 chars, A-Za-z0-9_- (B7). */
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE_MAX = 512;

export interface McpOauthRouteDeps {
  db: DatabaseService;
  authService: AuthService;
  clients: McpClientService;
  tokens: McpTokenService;
  codes: McpCodeService;
  grants: McpGrantService;
  pool: McpPoolService;
  groups: TerminalGroupsService;
}

function noStoreJson(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

function requireOrigin(request: FastifyRequest, reply: FastifyReply): string | null {
  const origin = resolveMcpOrigin(request);
  if (!origin) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  return origin;
}

function oauthHtmlHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "DENY");
  reply.header(
    "Content-Security-Policy",
    "frame-ancestors 'none'; script-src 'self'; base-uri 'none'; form-action 'self'"
  );
}

function qstr(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return value == null ? "" : String(value);
}

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

function validateAuthorizeParams(
  raw: Record<string, unknown>,
  clients: McpClientService
): { ok: true; params: AuthorizeParams; client: McpClientRow } | { ok: false; error: string } {
  const responseType = qstr(raw.response_type);
  const clientId = qstr(raw.client_id);
  const redirectUri = qstr(raw.redirect_uri);
  const method = qstr(raw.code_challenge_method);
  const challenge = qstr(raw.code_challenge);
  const state = qstr(raw.state);
  if (responseType !== "code") return { ok: false, error: "unsupported_response_type" };
  if (!clientId) return { ok: false, error: "invalid_request" };
  const client = clients.get(clientId);
  if (!client) return { ok: false, error: "invalid_client" };
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return { ok: false, error: "invalid_request" };
  }
  if (method !== "S256" || !PKCE_S256_CHALLENGE.test(challenge)) {
    return { ok: false, error: "invalid_request" };
  }
  if (state.length > STATE_MAX) return { ok: false, error: "invalid_request" };
  return { ok: true, params: { clientId, redirectUri, codeChallenge: challenge, state }, client };
}

function requireActiveOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  db: DatabaseService
): { id: number } | null {
  const user = request.sessionUser;
  if (!user || user.role !== "owner") {
    reply.code(403).send({ error: "Owner role required" });
    return null;
  }
  const row = db.prepare("SELECT active FROM users WHERE id = ?").get(user.id) as { active: number } | undefined;
  if (!row || row.active !== 1) {
    reply.code(403).send({ error: "Owner role required" });
    return null;
  }
  return { id: user.id };
}

export function registerMcpOauthRoutes(app: FastifyInstance, deps: McpOauthRouteDeps): void {
  app.get("/.well-known/oauth-authorization-server", async (request, reply) => {
    const origin = requireOrigin(request, reply);
    if (!origin) return;
    noStoreJson(reply);
    return authorizationServerMetadata(origin);
  });

  app.get("/.well-known/oauth-protected-resource", async (request, reply) => {
    const origin = requireOrigin(request, reply);
    if (!origin) return;
    noStoreJson(reply);
    return protectedResourceMetadata(origin);
  });

  app.post("/oauth/register", async (request, reply) => {
    const origin = requireOrigin(request, reply);
    if (!origin) return;
    noStoreJson(reply);
    try {
      const client = deps.clients.register((request.body ?? {}) as Record<string, unknown>);
      return reply.code(201).send({
        client_id: client.id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: client.token_endpoint_auth_method
      });
    } catch (err) {
      if (err instanceof McpClientRegistrationError) {
        return reply.code(400).send({ error: "invalid_client_metadata", error_description: err.message });
      }
      throw err;
    }
  });

  app.post("/oauth/revoke", async (request, reply) => {
    const origin = requireOrigin(request, reply);
    if (!origin) return;
    noStoreJson(reply);
    const body = (request.body ?? {}) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    deps.tokens.revokePresentedToken(token);
    return reply.code(200).send();
  });

  app.get("/oauth/authorize", async (request, reply) => {
    const origin = requireOrigin(request, reply);
    if (!origin) return;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const validated = validateAuthorizeParams(query, deps.clients);
    if (!validated.ok) {
      oauthHtmlHeaders(reply);
      return reply.code(400).send({ error: validated.error });
    }
    oauthHtmlHeaders(reply);
    const html = fs.readFileSync(CONSENT_HTML_PATH, "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });

  const authMiddleware = createAuthMiddleware(deps.authService);

  app.post(
    "/api/mcp/consent/context",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const origin = requireOrigin(request, reply);
      if (!origin) return;
      const owner = requireActiveOwner(request, reply, deps.db);
      if (!owner) return;
      const validated = validateAuthorizeParams((request.body ?? {}) as Record<string, unknown>, deps.clients);
      if (!validated.ok) return reply.code(400).send({ error: validated.error });
      noStoreJson(reply);
      const pool = deps.pool.list();
      const groups = deps.groups.get(owner.id).groups.map((g) => ({
        id: g.id,
        name: g.name,
        sessions: g.sessions
      }));
      return {
        client_id: validated.client.id,
        client_name: validated.client.client_name,
        client_id_suffix: validated.client.id.slice(-8),
        redirect_uri: validated.params.redirectUri,
        state: validated.params.state,
        pool,
        groups,
        permissions: [...MCP_TOOL_NAMES]
      };
    }
  );

  app.post(
    "/api/mcp/consent/decision",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const origin = requireOrigin(request, reply);
      if (!origin) return;
      const owner = requireActiveOwner(request, reply, deps.db);
      if (!owner) return;
      noStoreJson(reply);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const validated = validateAuthorizeParams(body, deps.clients);
      if (!validated.ok) return reply.code(400).send({ error: validated.error });

      const decision = qstr(body.decision);
      if (decision === "deny") {
        return {
          error: "access_denied",
          state: validated.params.state,
          redirect_uri: validated.params.redirectUri
        };
      }
      if (decision !== "approve") {
        return reply.code(400).send({ error: "invalid_request" });
      }

      const pool = deps.pool.list();
      if (pool.length === 0) {
        return reply.code(403).send({ error: "empty_pool" });
      }

      const scopeType = qstr(body.scope_type) === "group" ? "group" : "sessions";
      let scopeRef = typeof body.scope_ref === "string" ? body.scope_ref : JSON.stringify(body.scope_ref ?? []);
      if (scopeType === "group") {
        const group = deps.groups.get(owner.id).groups.find((g) => g.id === scopeRef);
        if (!group || group.sessions.length === 0) {
          return reply.code(403).send({ error: "empty_group" });
        }
      } else {
        let names: unknown[] = [];
        try {
          names = JSON.parse(scopeRef) as unknown[];
        } catch {
          return reply.code(400).send({ error: "invalid_request" });
        }
        if (!Array.isArray(names) || names.length === 0) {
          return reply.code(403).send({ error: "empty_scope" });
        }
        const poolSet = new Set(pool);
        if (!names.every((n) => poolSet.has(String(n)))) {
          return reply.code(403).send({ error: "empty_scope" });
        }
      }

      const permissions = Array.isArray(body.permissions)
        ? body.permissions.map(String)
        : [...MCP_TOOL_NAMES];
      try {
        const grant = deps.grants.create({
          clientId: validated.params.clientId,
          grantedBy: owner.id,
          scopeType,
          scopeRef,
          permissions,
          lifetime: body.lifetime === true
        });
        const issued = deps.codes.issueCode({
          grantId: grant.id,
          clientId: validated.params.clientId,
          redirectUri: validated.params.redirectUri,
          codeChallenge: validated.params.codeChallenge,
          audience: `${origin}/mcp`
        });
        return {
          code: issued.code,
          state: validated.params.state,
          iss: origin,
          redirect_uri: validated.params.redirectUri
        };
      } catch (err) {
        if (err instanceof McpGrantError) {
          const status = err.code === "already_active" ? 409 : 400;
          return reply.code(status).send({ error: err.code, error_description: err.message });
        }
        if (err instanceof McpCodeError) {
          return reply.code(400).send({ error: err.code });
        }
        throw err;
      }
    }
  );
}
