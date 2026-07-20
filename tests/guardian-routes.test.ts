import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerGuardianRoutes } from "../src/api/routes/guardian-routes.js";
import { AppConfig } from "../src/config/config.js";
import type { TelegramAssistant } from "../src/bot/telegram-bot.js";

const OVERMIND_TOKEN = "ovm-test-token";

function testConfig(): AppConfig {
  return {
    telegram: {
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      authorizedUserId: 111222,
      authorizedChatIds: [111222],
      testMode: true,
      updateMode: "polling",
      webhookUrl: null,
      webhookPath: "/api/telegram/webhook",
      webhookSecretToken: "test-secret"
    },
    runtime: {
      workspaceRoot: "/tmp",
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1
    },
    api: {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: "test-secret",
      sessionExpiryHours: 24
    },
    db: {
      path: "data/test-guardian-routes.sqlite"
    },
    projects: {
      root: "/tmp"
    },
    tmux: {
      historyRetentionDays: 7,
      outputBufferLines: 5000,
      streamIntervalMs: 100
    },
    overmind: {
      token: OVERMIND_TOKEN
    }
  };
}

let app: FastifyInstance;
let sendMessage: ReturnType<typeof vi.fn>;
let telegramAssistant: TelegramAssistant;

// The dedupe map in guardian-routes.ts is a module-level singleton (by design —
// one process serves this route). Give each test its own run_id so dedupe
// windows from earlier tests in this file can't bleed into later ones.
let runCounter = 0;

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    run_id: `app-fixes-v2-${runCounter}`,
    severity: "BLOCKED",
    title: "coordinator session died",
    lines: ["session: rs-grok", "agent: grok45", "batch: B24c"],
    action: "restart rs-grok and reseed projcore from context-handoff.md",
    ...overrides
  };
}

beforeEach(async () => {
  runCounter += 1;
  sendMessage = vi.fn(async () => {});
  telegramAssistant = { sendMessage } as unknown as TelegramAssistant;
  app = Fastify({ logger: false });
  registerGuardianRoutes(app, testConfig(), telegramAssistant);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

async function postEscalate(
  payload: unknown,
  headers: Record<string, string> = {},
  remoteAddress = "127.0.0.1"
) {
  return app.inject({
    method: "POST",
    url: "/api/guardian/escalate",
    headers,
    remoteAddress,
    payload: payload as Record<string, unknown>
  });
}

describe("POST /api/guardian/escalate", () => {
  it("rejects a non-loopback caller even with a valid token", async () => {
    const res = await postEscalate(
      validPayload(),
      { "x-overmind-token": OVERMIND_TOKEN },
      "203.0.113.5"
    );
    expect(res.statusCode).toBe(403);
  });

  it("rejects a loopback caller with no token", async () => {
    const res = await postEscalate(validPayload());
    expect(res.statusCode).toBe(401);
  });

  it("rejects a loopback caller with the wrong token", async () => {
    const res = await postEscalate(validPayload(), { "x-overmind-token": "wrong" });
    expect(res.statusCode).toBe(401);
  });

  it("accepts x-overmind-token and delivers the formatted message to the authorized user", async () => {
    const res = await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "enqueued" });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const [chatId, text] = sendMessage.mock.calls[0];
    expect(chatId).toBe(111222);
    expect(text).toContain("🛑 BLOCKED · AGJAssist · guardian");
    expect(text).toContain(`Run: app-fixes-v2-${runCounter}`);
    expect(text).toContain("session: rs-grok");
    expect(text).toContain("Need from you: restart rs-grok and reseed projcore from context-handoff.md");
  });

  it("also accepts x-guardian-token (guardian isn't tied to overmind but shares the secret)", async () => {
    const res = await postEscalate(validPayload(), { "x-guardian-token": OVERMIND_TOKEN });

    expect(res.statusCode).toBe(202);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it("rejects a severity other than BLOCKED or URGENT", async () => {
    const res = await postEscalate(validPayload({ severity: "INFO" }), { "x-overmind-token": OVERMIND_TOKEN });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a payload missing required fields", async () => {
    const res = await postEscalate(
      { run_id: "app-fixes-v2", severity: "URGENT" },
      { "x-overmind-token": OVERMIND_TOKEN }
    );
    expect(res.statusCode).toBe(400);
  });

  it("dedupes a retried escalation with the same run_id and title within the window, without re-sending Telegram", async () => {
    const first = await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    const retry = await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toEqual({ status: "deduped" });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not dedupe a different title for the same run", async () => {
    await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    const res = await postEscalate(
      validPayload({ title: "a different failure" }),
      { "x-overmind-token": OVERMIND_TOKEN }
    );
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "enqueued" });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
  });
});
