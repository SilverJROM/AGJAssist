import { describe, expect, it } from "vitest";
import {
  MCP_TOOLS_CALL_LIMIT,
  MCP_TOOLS_CALL_WINDOW_MS,
  McpRateLimiter,
  mcpRateLimitedEnvelope
} from "../src/mcp/mcp-rate-limit.js";

describe("McpRateLimiter (B14)", () => {
  it("allows 120 calls in the window and blocks the 121st; recovers after the window", () => {
    let now = 1_000_000;
    const limiter = new McpRateLimiter({ now: () => now });
    const tokenRowId = "token-row-1";

    for (let i = 0; i < MCP_TOOLS_CALL_LIMIT; i++) {
      expect(limiter.consume(tokenRowId)).toEqual({ allowed: true });
    }
    const blocked = limiter.consume(tokenRowId);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      const envelope = mcpRateLimitedEnvelope(7, blocked.retryAfterSeconds);
      expect(envelope.jsonrpc).toBe("2.0");
      expect(envelope.id).toBe(7);
      expect(envelope.result.isError).toBe(true);
      expect(envelope.result.structuredContent.code).toBe("mcp_rate_limited");
      expect(envelope.result.structuredContent.retry_after).toBe(blocked.retryAfterSeconds);
    }

    expect(limiter.consume("token-row-2").allowed).toBe(true);

    now += MCP_TOOLS_CALL_WINDOW_MS + 1;
    expect(limiter.consume(tokenRowId)).toEqual({ allowed: true });
  });
});

/*
 * Blocker 5 (AC-20 MCP limiter e2e) is NOT this file.
 * B15 must e2e: 120 tools/call on ONE access-token row → mcp_rate_limited
 * (HTTP 200 JSON-RPC tool error), then recovery after the window.
 */
