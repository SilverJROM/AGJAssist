import crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/config.js";
import type { TelegramAssistant } from "../../bot/telegram-bot.js";
import type { AuditService } from "../../services/audit-service.js";
import { EscalationService, type EscalationType } from "../../services/escalation-service.js";

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(headers: Record<string, unknown>): string | undefined {
  const x = headers["x-escalation-token"];
  if (typeof x === "string" && x) return x;
  const auth = headers["authorization"];
  if (typeof auth === "string" && /^Bearer /i.test(auth)) return auth.slice(7).trim();
  return undefined;
}

/**
 * POST /api/escalate — the single clean channel for an agent to reach JROM on
 * Telegram for a TRUE BLOCKER or a FULL ESCALATION. Auth by shared token
 * (config.telegram.escalationToken); body is validated + de-duped; delivery
 * goes to the owner via the bot.
 */
export function registerEscalationRoutes(
  app: FastifyInstance,
  config: AppConfig,
  telegramAssistant?: TelegramAssistant | null,
  auditService?: AuditService
): void {
  const service = new EscalationService(async (text) => {
    if (!telegramAssistant) throw new Error("telegram unavailable");
    await telegramAssistant.sendMessage(config.telegram.authorizedUserId, text);
  });

  app.post<{
    Body: { type?: string; from?: string; message?: string; session?: string; action?: string };
  }>(
    "/api/escalate",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      // Fail-closed: with no configured secret the wire is disabled entirely
      // (no BOT_TOKEN-derived fallback), so an unconfigured server can't be paged.
      if (!config.telegram.escalationToken) {
        return reply.code(503).send({ error: "escalation endpoint not configured" });
      }
      if (!tokenMatches(presentedToken(request.headers as Record<string, unknown>), config.telegram.escalationToken)) {
        return reply.code(401).send({ error: "invalid or missing escalation token" });
      }

      const body = request.body || {};
      const type: EscalationType | null =
        body.type === "blocker" ? "blocker" : body.type === "escalation" ? "escalation" : null;
      if (!type) {
        return reply.code(400).send({ error: "type must be 'blocker' or 'escalation'" });
      }
      const from = String(body.from || "").trim();
      const message = String(body.message || "").trim();
      if (!from) return reply.code(400).send({ error: "from is required" });
      if (!message) return reply.code(400).send({ error: "message is required" });
      if (message.length > 3500) return reply.code(400).send({ error: "message exceeds 3500 chars" });

      if (!telegramAssistant || config.telegram.testMode) {
        return reply.code(503).send({ error: "telegram delivery unavailable" });
      }

      const session = body.session ? String(body.session).slice(0, 200) : undefined;
      const action = body.action ? String(body.action).slice(0, 1000) : undefined;

      let result;
      try {
        result = await service.escalate({ type, from, message, session, action });
      } catch {
        return reply.code(502).send({ error: "could not deliver escalation" });
      }

      // Best-effort audit trail — never let it break delivery. user_id is null:
      // the escalation is from an agent, not an owner session, and audit_log.user_id
      // references users(id) (an internal id), which an agent doesn't have.
      try {
        auditService?.log({
          userId: null,
          agentName: from,
          actionType: "agent_escalation",
          resourceType: "escalation",
          resourceId: type,
          details: { type, from, session, delivered: result.sent, deduped: !!result.deduped, message: message.slice(0, 300) },
          surface: "agent"
        });
      } catch {
        /* audit is best-effort */
      }

      return { ok: true, ...result };
    }
  );
}
