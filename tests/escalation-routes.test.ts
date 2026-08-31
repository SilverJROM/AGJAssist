import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerEscalationRoutes } from "../src/api/routes/escalation-routes.js";
import { EscalationService } from "../src/services/escalation-service.js";
import type { AppConfig } from "../src/config/config.js";
import type { TelegramAssistant } from "../src/bot/telegram-bot.js";

const TOKEN = "test-escalation-token";

function makeConfig(testMode = false): AppConfig {
  return { telegram: { authorizedUserId: 999, escalationToken: TOKEN, testMode } } as unknown as AppConfig;
}

describe("EscalationService", () => {
  it("formats a blocker verdict-led", () => {
    const svc = new EscalationService(async () => {});
    const out = svc.format({ type: "blocker", from: "hris-4430", message: "creds missing", session: "hris-4430:0.0", action: "add HRIS_KEY" });
    expect(out).toContain("🛑 BLOCKED — hris-4430");
    expect(out).toContain("creds missing");
    expect(out).toContain("Session: hris-4430:0.0");
    expect(out).toContain("👉 add HRIS_KEY");
  });

  it("de-dupes identical escalations inside the window, allows after it", async () => {
    const sent: string[] = [];
    let clock = 1_000_000;
    const svc = new EscalationService(async (t) => { sent.push(t); }, () => clock, 10 * 60 * 1000);
    const input = { type: "escalation" as const, from: "a", message: "same" };
    expect((await svc.escalate(input)).sent).toBe(true);
    expect((await svc.escalate(input)).deduped).toBe(true);
    expect(sent).toHaveLength(1);
    clock += 11 * 60 * 1000; // past the window
    expect((await svc.escalate(input)).sent).toBe(true);
    expect(sent).toHaveLength(2);
  });
});

describe("POST /api/escalate", () => {
  let app: any;
  let sent: string[];
  let telegram: TelegramAssistant;

  beforeEach(async () => {
    sent = [];
    telegram = { sendMessage: async (_chat: number | string, text: string) => { sent.push(text); } } as unknown as TelegramAssistant;
    app = Fastify({ logger: false });
    registerEscalationRoutes(app, makeConfig(), telegram);
    await app.ready();
  });

  const post = (body: unknown, token?: string) =>
    app.inject({ method: "POST", url: "/api/escalate", headers: token ? { "x-escalation-token": token } : {}, payload: body });

  it("401 without a token", async () => {
    const r = await post({ type: "blocker", from: "x", message: "y" });
    expect(r.statusCode).toBe(401);
  });

  it("401 with a wrong token", async () => {
    const r = await post({ type: "blocker", from: "x", message: "y" }, "nope");
    expect(r.statusCode).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("400 on bad type / missing fields", async () => {
    expect((await post({ type: "chatty", from: "x", message: "y" }, TOKEN)).statusCode).toBe(400);
    expect((await post({ type: "blocker", message: "y" }, TOKEN)).statusCode).toBe(400);
    expect((await post({ type: "blocker", from: "x" }, TOKEN)).statusCode).toBe(400);
  });

  it("200 delivers a valid escalation to the owner", async () => {
    const r = await post({ type: "blocker", from: "hris-4430", message: "stuck on X", action: "decide Y" }, TOKEN);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("🛑 BLOCKED — hris-4430");
  });

  it("de-dupes an identical repeat", async () => {
    const body = { type: "escalation", from: "a", message: "dup" };
    await post(body, TOKEN);
    const r2 = await post(body, TOKEN);
    expect(JSON.parse(r2.body)).toMatchObject({ ok: true, deduped: true });
    expect(sent).toHaveLength(1);
  });

  it("503 in testMode (no telegram)", async () => {
    const app2 = Fastify({ logger: false });
    registerEscalationRoutes(app2, makeConfig(true), telegram);
    await app2.ready();
    const r = await app2.inject({ method: "POST", url: "/api/escalate", headers: { "x-escalation-token": TOKEN }, payload: { type: "blocker", from: "x", message: "y" } });
    expect(r.statusCode).toBe(503);
  });
});
