import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { LOKALAI_LINK_CODE_TTL_MS, lokalaiLinkCodeStore } from "../src/bot/lokalai-link-code-store.js";
import { registerLokalaiLinkRoutes } from "../src/api/routes/lokalai-link-routes.js";

const TELEGRAM_USER_ID = 1000000001;

describe("lokalai link code store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
    lokalaiLinkCodeStore.clear();
  });

  afterEach(() => {
    lokalaiLinkCodeStore.clear();
    vi.useRealTimers();
  });

  it("issues a code bound to the contacting Telegram id and consumes it once", () => {
    const code = lokalaiLinkCodeStore.issue(TELEGRAM_USER_ID);
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);

    expect(lokalaiLinkCodeStore.consume(code)).toEqual({ ok: true, telegramUserId: TELEGRAM_USER_ID });
    expect(lokalaiLinkCodeStore.consume(code)).toEqual({ ok: false, reason: "missing" });
  });

  it("issues distinct codes on repeated calls for the same id", () => {
    const first = lokalaiLinkCodeStore.issue(TELEGRAM_USER_ID);
    const second = lokalaiLinkCodeStore.issue(TELEGRAM_USER_ID);
    expect(first).not.toEqual(second);
  });

  it("rejects an unknown code", () => {
    expect(lokalaiLinkCodeStore.consume("never-issued")).toEqual({ ok: false, reason: "missing" });
  });

  it("expires a code after the default TTL", () => {
    const code = lokalaiLinkCodeStore.issue(TELEGRAM_USER_ID);

    vi.advanceTimersByTime(LOKALAI_LINK_CODE_TTL_MS + 1);

    expect(lokalaiLinkCodeStore.consume(code)).toEqual({ ok: false, reason: "expired" });
    // Consuming an expired code still retires it — a replay cannot succeed even inside the old window.
    expect(lokalaiLinkCodeStore.consume(code)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("POST /api/lokalai/link-codes/consume", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    lokalaiLinkCodeStore.clear();
    app = Fastify({ logger: false });
    registerLokalaiLinkRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    lokalaiLinkCodeStore.clear();
    await app.close();
  });

  it("rejects non-loopback callers", async () => {
    const code = lokalaiLinkCodeStore.issue(TELEGRAM_USER_ID);

    const response = await app.inject({
      method: "POST",
      url: "/api/lokalai/link-codes/consume",
      remoteAddress: "10.0.0.5",
      payload: { code }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ ok: false, error: "loopback_required" });
    // Rejected before reaching the store: the code is still usable from loopback.
    expect(lokalaiLinkCodeStore.consume(code)).toEqual({ ok: true, telegramUserId: TELEGRAM_USER_ID });
  });

  it("rejects a missing or malformed code body", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/lokalai/link-codes/consume",
      remoteAddress: "127.0.0.1",
      payload: {}
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ ok: false, error: "invalid_code" });

    const wrongType = await app.inject({
      method: "POST",
      url: "/api/lokalai/link-codes/consume",
      remoteAddress: "127.0.0.1",
      payload: { code: 12345 }
    });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json()).toEqual({ ok: false, error: "invalid_code" });
  });

  it("rejects an unknown code", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/lokalai/link-codes/consume",
      remoteAddress: "127.0.0.1",
      payload: { code: "never-issued" }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ ok: false, error: "code_not_found" });
  });

  it("rejects an expired code", async () => {
    // Fastify's inject() relies on real timers, so this uses a genuinely short
    // TTL plus a real wait rather than vi.useFakeTimers (which hangs inject()).
    const code = lokalaiLinkCodeStore.issue(TELEGRAM_USER_ID, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const response = await app.inject({
      method: "POST",
      url: "/api/lokalai/link-codes/consume",
      remoteAddress: "127.0.0.1",
      payload: { code }
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ ok: false, error: "code_expired" });
  });

  it("atomically consumes a valid code from loopback and rejects replay", async () => {
    const code = lokalaiLinkCodeStore.issue(TELEGRAM_USER_ID);

    const first = await app.inject({
      method: "POST",
      url: "/api/lokalai/link-codes/consume",
      remoteAddress: "127.0.0.1",
      payload: { code }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ telegram_user_id: TELEGRAM_USER_ID });

    const replay = await app.inject({
      method: "POST",
      url: "/api/lokalai/link-codes/consume",
      remoteAddress: "127.0.0.1",
      payload: { code }
    });
    expect(replay.statusCode).toBe(404);
    expect(replay.json()).toEqual({ ok: false, error: "code_not_found" });
  });
});
