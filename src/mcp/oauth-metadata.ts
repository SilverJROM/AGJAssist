import type { FastifyRequest } from "fastify";
import { MCP_PUBLIC_HOST } from "./mcp-constants.js";

function headerFirst(raw: string | string[] | undefined): string {
  const header = Array.isArray(raw) ? raw[0] : raw;
  return String(header || "").split(",")[0].trim().toLowerCase();
}

export function hostFromRequest(request: FastifyRequest): string {
  const forwarded = headerFirst(request.headers["x-forwarded-host"]);
  if (forwarded) return forwarded;
  return headerFirst(request.headers.host);
}

/** Validate Host against the allowlist. Unknown/forged Host → null (caller 404s). */
export function resolveMcpOrigin(request: FastifyRequest): string | null {
  const host = hostFromRequest(request);
  if (!host) return null;
  if (host === "localhost:3101") return "http://localhost:3101";
  if (host === "127.0.0.1:3101") return "http://127.0.0.1:3101";
  const hostname = host.includes("]") ? host.slice(0, host.lastIndexOf("]") + 1) : host.split(":")[0];
  if (hostname === MCP_PUBLIC_HOST.toLowerCase()) return `https://${MCP_PUBLIC_HOST}`;
  return null;
}

export function mcpAudience(origin: string): string {
  return `${origin}/mcp`;
}

export function authorizationServerMetadata(origin: string): Record<string, unknown> {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true
  };
}

export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  return {
    resource: mcpAudience(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"]
  };
}
