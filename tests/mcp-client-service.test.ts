import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { McpClientRegistrationError, McpClientService, validateRedirectUriRaw } from "../src/mcp/mcp-client-service.js";
import { MCP_TOOL_NAMES } from "../src/mcp/mcp-constants.js";

let dir = "";

function makeService(): { db: DatabaseService; svc: McpClientService } {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-mcp-client-"));
  const db = new DatabaseService(path.join(dir, "test.sqlite"));
  return { db, svc: new McpClientService(db) };
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("mcp-constants", () => {
  it("exports the six chat-surface tool names", () => {
    expect([...MCP_TOOL_NAMES]).toEqual([
      "list_sessions",
      "read_session",
      "send_message",
      "send_keys",
      "upload_image",
      "read_image"
    ]);
  });
});

describe("AC-4 redirect URI validation (raw, no decode)", () => {
  const reject = [
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://evil.example/cb",
    "http://example.com:80/cb",
    "https://evil.com#x",
    "file:///etc/passwd"
  ];
  const accept = [
    "https://app.example.com/cb",
    "http://127.0.0.1:42831/cb",
    "http://localhost:9999/oauth/callback"
  ];

  for (const uri of reject) {
    it(`rejects ${uri}`, () => {
      expect(() => validateRedirectUriRaw(uri)).toThrow(McpClientRegistrationError);
    });
  }

  for (const uri of accept) {
    it(`accepts ${uri}`, () => {
      expect(() => validateRedirectUriRaw(uri)).not.toThrow();
    });
  }
});

describe("McpClientService DCR persist", () => {
  it("stores redirect_uris exactly as received (raw round-trip)", () => {
    const { db, svc } = makeService();
    const raw = "https://app.example.com/cb?next=%2Fhome%20page";
    const client = svc.register({
      client_name: "grok",
      redirect_uris: [raw, "http://127.0.0.1:42831/cb"]
    });
    expect(client.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(client.client_name).toBe("grok");
    expect(client.redirect_uris).toEqual([raw, "http://127.0.0.1:42831/cb"]);
    expect(client.redirect_uris[0]).toBe(raw);
    expect(client.redirect_uris[0]).toContain("%2Fhome%20page");
    expect(client.token_endpoint_auth_method).toBe("none");

    const stored = db
      .prepare("SELECT redirect_uris FROM mcp_clients WHERE id = ?")
      .get(client.id) as { redirect_uris: string };
    expect(stored.redirect_uris).toBe(JSON.stringify([raw, "http://127.0.0.1:42831/cb"]));
    expect(svc.get(client.id)?.redirect_uris[0]).toBe(raw);
    db.close();
  });

  it("rejects javascript, data, and non-loopback http at register", () => {
    const { db, svc } = makeService();
    expect(() =>
      svc.register({ client_name: "x", redirect_uris: ["javascript:alert(1)"] })
    ).toThrow(McpClientRegistrationError);
    expect(() =>
      svc.register({ client_name: "x", redirect_uris: ["data:text/plain,hi"] })
    ).toThrow(McpClientRegistrationError);
    expect(() =>
      svc.register({ client_name: "x", redirect_uris: ["http://evil.example/cb"] })
    ).toThrow(McpClientRegistrationError);
    const count = db.prepare("SELECT COUNT(*) AS n FROM mcp_clients").get() as { n: number };
    expect(count.n).toBe(0);
    db.close();
  });
});
