import { afterEach, describe, expect, it } from "vitest";
import {
  MCP_PUBLIC_HOST_DEFAULT,
  MCP_TOKEN_TTL_DAYS_DEFAULT,
  loadConfig,
  parseMcpTokenTtlDays
} from "../../src/config/config.js";

const SAVED: Record<string, string | undefined> = {};
const KEYS = ["BOT_TOKEN", "AUTHORIZED_USER_ID", "MCP_TOKEN_LIFETIME_DAYS", "MCP_PUBLIC_HOST"];

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const key of KEYS) {
    if (!(key in SAVED)) SAVED[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  process.env.BOT_TOKEN ??= "test-bot-token";
  process.env.AUTHORIZED_USER_ID ??= "12345";
}

afterEach(() => {
  for (const key of KEYS) {
    const prev = SAVED[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
    delete SAVED[key];
  }
});

describe("parseMcpTokenTtlDays", () => {
  it("defaults to 7 when unset or empty", () => {
    expect(parseMcpTokenTtlDays(undefined)).toBe(MCP_TOKEN_TTL_DAYS_DEFAULT);
    expect(parseMcpTokenTtlDays("")).toBe(7);
    expect(parseMcpTokenTtlDays("   ")).toBe(7);
  });

  it("accepts integers in 7..10", () => {
    expect(parseMcpTokenTtlDays("7")).toBe(7);
    expect(parseMcpTokenTtlDays("10")).toBe(10);
  });

  it("rejects 6, 11, and non-integers", () => {
    expect(() => parseMcpTokenTtlDays("6")).toThrow(/integer 7\.\.10/);
    expect(() => parseMcpTokenTtlDays("11")).toThrow(/integer 7\.\.10/);
    expect(() => parseMcpTokenTtlDays("8.5")).toThrow(/integer 7\.\.10/);
    expect(() => parseMcpTokenTtlDays("seven")).toThrow(/integer 7\.\.10/);
    expect(() => parseMcpTokenTtlDays("-7")).toThrow(/integer 7\.\.10/);
  });
});

describe("loadConfig mcp", () => {
  it("defaults publicHost and tokenTtlDays to 7", () => {
    setEnv({ MCP_TOKEN_LIFETIME_DAYS: undefined, MCP_PUBLIC_HOST: undefined });
    const cfg = loadConfig();
    expect(cfg.mcp.publicHost).toBe(MCP_PUBLIC_HOST_DEFAULT);
    expect(cfg.mcp.tokenTtlDays).toBe(7);
  });

  it("rejects out-of-range and non-int MCP_TOKEN_LIFETIME_DAYS", () => {
    setEnv({ MCP_TOKEN_LIFETIME_DAYS: "6" });
    expect(() => loadConfig()).toThrow(/MCP_TOKEN_LIFETIME_DAYS/);
    setEnv({ MCP_TOKEN_LIFETIME_DAYS: "11" });
    expect(() => loadConfig()).toThrow(/MCP_TOKEN_LIFETIME_DAYS/);
    setEnv({ MCP_TOKEN_LIFETIME_DAYS: "nope" });
    expect(() => loadConfig()).toThrow(/MCP_TOKEN_LIFETIME_DAYS/);
  });
});
