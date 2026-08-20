import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "../../auth/auth-service.js";
import { DatabaseService } from "../../db/database.js";
import { TerminalGroupsService } from "../../services/terminal-groups-service.js";
import { McpClientRegistrationError, McpClientService } from "../../mcp/mcp-client-service.js";
import { McpCodeService } from "../../mcp/mcp-code-service.js";
import { McpGrantService } from "../../mcp/mcp-grant-service.js";
import { McpPoolService } from "../../mcp/mcp-pool-service.js";
import { McpTokenService } from "../../mcp/mcp-token-service.js";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
  resolveMcpOrigin
} from "../../mcp/oauth-metadata.js";

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
}
