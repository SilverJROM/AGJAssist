import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppConfig } from "../../config/config.js";
import { isLoopbackAddress } from "./overmind-routes.js";
import { buildGuardianEscalationNotification } from "../../services/overmind-notifications.js";
import type { TelegramAssistant } from "../../bot/telegram-bot.js";

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 2000;
const SEVERITIES = new Set(["BLOCKED", "URGENT"]);

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Loopback + shared-secret guard, matching the pattern used for other
// daemon-facing overmind endpoints (e.g. GET /api/overmind/runs/active).
// The guardian daemon isn't tied to overmind, so it may send its token under
// either header name; both are accepted against the same configured secret.
function requireGuardianAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string
): boolean {
  if (!isLoopbackAddress(request.ip)) {
    reply.code(403).send({ error: "guardian escalate endpoint is localhost-only" });
    return false;
  }

  const token =
    firstHeaderValue(request.headers["x-overmind-token"]) ||
    firstHeaderValue(request.headers["x-guardian-token"]);
  if (!token || token !== expectedToken) {
    reply.code(401).send({ error: "missing or invalid guardian token" });
    return false;
  }

  return true;
}

interface EscalateBody {
  run_id?: string;
  severity?: string;
  title?: string;
  lines?: string[];
  action?: string;
}

// Module-level: one process serves this route, so an in-memory map is enough
// to dedupe a retrying daemon within the window. No persistence needed —
// losing this on restart just means a genuinely-repeated page goes through.
const recentEscalations = new Map<string, number>();

function pruneExpired(now: number): void {
  for (const [key, sentAt] of recentEscalations) {
    if (now - sentAt >= DEDUPE_WINDOW_MS) {
      recentEscalations.delete(key);
    }
  }
}

interface ValidEscalateBody {
  runId: string;
  severity: "BLOCKED" | "URGENT";
  title: string;
  lines: string[];
  action: string;
}

function validateBody(body: EscalateBody | undefined): ValidEscalateBody | string {
  if (!body) return "Request body is required";
  if (!body.run_id || typeof body.run_id !== "string") return "run_id is required";
  if (!body.severity || !SEVERITIES.has(body.severity)) return "severity must be BLOCKED or URGENT";
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.action || typeof body.action !== "string") return "action is required";
  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines) || body.lines.some((line) => typeof line !== "string")) {
      return "lines must be an array of strings";
    }
  }
  return {
    runId: body.run_id,
    severity: body.severity as "BLOCKED" | "URGENT",
    title: body.title,
    lines: body.lines ?? [],
    action: body.action
  };
}

async function deliverEscalation(
  telegramAssistant: TelegramAssistant | null | undefined,
  chatId: number,
  text: string
): Promise<void> {
  if (!telegramAssistant) {
    console.error("guardian escalate: no Telegram assistant available; message dropped:", text);
    return;
  }

  try {
    await telegramAssistant.sendMessage(chatId, text);
    return;
  } catch (error) {
    console.error("guardian escalate: first Telegram send attempt failed, retrying:", error);
  }

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

  try {
    await telegramAssistant.sendMessage(chatId, text);
  } catch (error) {
    console.error("guardian escalate: Telegram send failed after retry; message dropped:", error);
  }
}

export function registerGuardianRoutes(
  app: FastifyInstance,
  config: AppConfig,
  telegramAssistant: TelegramAssistant | null | undefined
): void {
  app.post<{ Body: EscalateBody }>(
    "/api/guardian/escalate",
    async (request, reply) => {
      if (!requireGuardianAuth(request, reply, config.overmind.token)) return;

      const validated = validateBody(request.body);
      if (typeof validated === "string") {
        reply.code(400).send({ error: validated });
        return;
      }

      const now = Date.now();
      pruneExpired(now);

      const key = `${validated.runId}::${validated.title}`;
      const lastSentAt = recentEscalations.get(key);
      if (lastSentAt !== undefined && now - lastSentAt < DEDUPE_WINDOW_MS) {
        reply.code(202).send({ status: "deduped" });
        return;
      }
      recentEscalations.set(key, now);

      reply.code(202).send({ status: "enqueued" });

      const text = buildGuardianEscalationNotification(validated);
      void deliverEscalation(telegramAssistant, config.telegram.authorizedUserId, text);
    }
  );
}
