import { MCP_ERROR } from "./mcp-constants.js";

export const MCP_TOOLS_CALL_LIMIT = 120;
export const MCP_TOOLS_CALL_WINDOW_MS = 60_000;

export interface McpRateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

export interface McpRateLimitOk {
  allowed: true;
}

export interface McpRateLimitBlocked {
  allowed: false;
  retryAfterSeconds: number;
}

export type McpRateLimitDecision = McpRateLimitOk | McpRateLimitBlocked;

/** JSON-RPC tool-error envelope (HTTP 200). Wire from B15 /mcp tools/call. */
export function mcpRateLimitedEnvelope(id: unknown, retryAfterSeconds: number): {
  jsonrpc: "2.0";
  id: unknown;
  result: {
    content: Array<{ type: "text"; text: string }>;
    isError: true;
    structuredContent: { code: string; retry_after: number };
  };
} {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: MCP_ERROR.rateLimited.text }],
      isError: true,
      structuredContent: {
        code: MCP_ERROR.rateLimited.code,
        retry_after: retryAfterSeconds
      }
    }
  };
}

/**
 * Per-access-token-row sliding window for MCP tools/call (NFR-7).
 * Keyed by resolved token row id, not the raw secret. In-memory; resets on process restart.
 *
 * Blocker 5 / AC-20 MCP path: B15 e2e must drive 120 tools/call on ONE access-token
 * row → mcp_rate_limited (HTTP 200 JSON-RPC tool error), then recovery after the window.
 */
export class McpRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: McpRateLimiterOptions = {}) {
    this.limit = options.limit ?? MCP_TOOLS_CALL_LIMIT;
    this.windowMs = options.windowMs ?? MCP_TOOLS_CALL_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  consume(tokenRowId: string): McpRateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const prior = (this.hits.get(tokenRowId) ?? []).filter((ts) => ts > cutoff);
    if (prior.length >= this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((prior[0] + this.windowMs - now) / 1000));
      this.hits.set(tokenRowId, prior);
      return { allowed: false, retryAfterSeconds };
    }
    prior.push(now);
    this.hits.set(tokenRowId, prior);
    return { allowed: true };
  }
}
