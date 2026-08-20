import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MCP_ERROR, type McpToolName } from "../../mcp/mcp-constants.js";
import { McpBearerService, type McpBearerContext } from "../../mcp/mcp-bearer-service.js";
import {
  McpRateLimiter,
  mcpRateLimitedEnvelope
} from "../../mcp/mcp-rate-limit.js";
import { createMcpServerForRequest } from "../../mcp/mcp-server-factory.js";
import { resolveMcpOrigin } from "../../mcp/oauth-metadata.js";
import { AuditService } from "../../services/audit-service.js";

const MCP_BODY_LIMIT = 15 * 1024 * 1024;
const MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call"
]);

interface JsonRpcBody {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface McpRouteDeps {
  bearer: McpBearerService;
  limiter: McpRateLimiter;
  audit: AuditService;
}

function noStore(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
}

function jsonRpcId(body: JsonRpcBody): unknown {
  return typeof body.id === "string" || typeof body.id === "number" || body.id === null
    ? body.id
    : null;
}

function sendJsonRpcError(
  reply: FastifyReply,
  status: number,
  id: unknown,
  code: number,
  message: string,
  data?: Record<string, unknown>
) {
  noStore(reply);
  return reply.code(status).send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {})
    }
  });
}

function auditEvent(
  audit: AuditService,
  context: McpBearerContext,
  actionType: string,
  details: Record<string, unknown>
): void {
  try {
    audit.log({
      userId: context.grant.grantedBy,
      agentName: context.binding.clientName,
      actionType,
      resourceType: "mcp_grant",
      resourceId: String(context.grant.id),
      details: {
        grant_id: context.grant.id,
        client_id: context.grant.clientId,
        ...details
      },
      surface: "mcp"
    });
  } catch {
    // Authorization and rate-limit enforcement must not depend on audit availability.
  }
}

function sendUnauthorized(reply: FastifyReply, origin: string) {
  noStore(reply);
  reply.header(
    "WWW-Authenticate",
    `Bearer realm="mcp", error="invalid_token", resource_metadata="${origin}/.well-known/oauth-protected-resource"`
  );
  return reply.code(401).send({ error: "invalid_token" });
}

function sendToolDenied(reply: FastifyReply, id: unknown) {
  noStore(reply);
  return reply.code(200).send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: MCP_ERROR.toolDenied.text }],
      isError: true,
      structuredContent: { code: MCP_ERROR.toolDenied.code }
    }
  });
}

export function registerMcpRoutes(app: FastifyInstance, deps: McpRouteDeps): void {
  const contexts = new WeakMap<FastifyRequest, McpBearerContext>();

  const preHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = resolveMcpOrigin(request);
    if (!origin) {
      return reply.code(404).send({ error: "not_found" });
    }

    const context = await deps.bearer.resolve(request.headers.authorization, origin);
    if (!context) return sendUnauthorized(reply, origin);
    contexts.set(request, context);

    if (Array.isArray(request.body)) {
      auditEvent(deps.audit, context, "mcp_tool_denied", { reason: "batch" });
      return sendJsonRpcError(reply, 400, null, -32600, "Invalid Request");
    }
    if (!request.body || typeof request.body !== "object") {
      return sendJsonRpcError(reply, 400, null, -32600, "Invalid Request");
    }

    const body = request.body as JsonRpcBody;
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return sendJsonRpcError(reply, 400, jsonRpcId(body), -32600, "Invalid Request");
    }
    if (!MCP_METHODS.has(body.method)) {
      auditEvent(deps.audit, context, "mcp_tool_denied", {
        reason: "method",
        method: body.method.slice(0, 128)
      });
      return sendJsonRpcError(reply, 200, jsonRpcId(body), -32601, "Method not found", {
        code: MCP_ERROR.toolDenied.code,
        reason: "method"
      });
    }

    if (body.method === "tools/call") {
      const decision = deps.limiter.consume(context.binding.tokenId);
      if (!decision.allowed) {
        auditEvent(deps.audit, context, "mcp_rate_limited", {
          retry_after: decision.retryAfterSeconds
        });
        noStore(reply);
        return reply
          .code(200)
          .send(mcpRateLimitedEnvelope(jsonRpcId(body), decision.retryAfterSeconds));
      }

      const params = body.params;
      const toolName =
        params && typeof params === "object" && "name" in params
          ? (params as { name?: unknown }).name
          : undefined;
      if (
        typeof toolName === "string" &&
        !context.permissions.has(toolName as McpToolName)
      ) {
        auditEvent(deps.audit, context, "mcp_tool_denied", {
          reason: "permission",
          tool: toolName.slice(0, 128)
        });
        return sendToolDenied(reply, jsonRpcId(body));
      }
    }
  };

  app.post(
    "/mcp",
    { bodyLimit: MCP_BODY_LIMIT, preHandler },
    async (request, reply) => {
      const context = contexts.get(request);
      if (!context) return sendUnauthorized(reply, resolveMcpOrigin(request) ?? "");

      const server = createMcpServerForRequest(context);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });
      await server.connect(transport);

      reply.raw.setHeader("Cache-Control", "no-store");
      reply.hijack();
      try {
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch {
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.setHeader("Content-Type", "application/json");
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32603, message: "Internal error" }
            })
          );
        } else if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      } finally {
        await server.close();
      }
    }
  );

  app.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    handler: async (_request, reply) => {
      noStore(reply);
      reply.header("Allow", "POST");
      return reply.code(405).send({ error: "method_not_allowed" });
    }
  });
}
