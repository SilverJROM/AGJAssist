import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import {
  authorizationServerMetadata,
  mcpAudience,
  protectedResourceMetadata,
  resolveMcpOrigin
} from "../src/mcp/oauth-metadata.js";

function req(host: string): FastifyRequest {
  return { headers: { host } } as FastifyRequest;
}

describe("resolveMcpOrigin (AC-3)", () => {
  it("accepts both allowlisted loopback origins and the tunnel host", () => {
    expect(resolveMcpOrigin(req("localhost:3101"))).toBe("http://localhost:3101");
    expect(resolveMcpOrigin(req("127.0.0.1:3101"))).toBe("http://127.0.0.1:3101");
    expect(resolveMcpOrigin(req("agjasst.silverjrom.app"))).toBe("https://agjasst.silverjrom.app");
    expect(resolveMcpOrigin(req("agjasst.silverjrom.app:443"))).toBe("https://agjasst.silverjrom.app");
  });

  it("returns null for a forged Host (caller 404s)", () => {
    expect(resolveMcpOrigin(req("evil.example"))).toBeNull();
    expect(resolveMcpOrigin(req("localhost:9999"))).toBeNull();
    expect(resolveMcpOrigin(req(""))).toBeNull();
  });
});

describe("discovery documents", () => {
  it("advertises S256 only and a per-origin audience", () => {
    const origin = "http://localhost:3101";
    const as = authorizationServerMetadata(origin);
    expect(as.issuer).toBe(origin);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.code_challenge_methods_supported).not.toContain("plain");
    expect(as.authorization_endpoint).toBe(`${origin}/oauth/authorize`);
    expect(as.token_endpoint).toBe(`${origin}/oauth/token`);

    const pr = protectedResourceMetadata(origin);
    expect(pr.resource).toBe(mcpAudience(origin));
    expect(pr.resource).toBe("http://localhost:3101/mcp");
    expect(pr.authorization_servers).toEqual([origin]);

    const tunnel = authorizationServerMetadata("https://agjasst.silverjrom.app");
    expect(tunnel.issuer).toBe("https://agjasst.silverjrom.app");
    expect(protectedResourceMetadata("https://agjasst.silverjrom.app").resource).toBe(
      "https://agjasst.silverjrom.app/mcp"
    );
  });
});
