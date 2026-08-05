import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { lokalaiLinkCodeStore } from "../../bot/lokalai-link-code-store.js";

interface ConsumeLinkCodeBody {
  code?: unknown;
}

function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const v = String(ip).trim().replace(/^\[/, "").replace(/\]$/, "");
  if (v === "127.0.0.1" || v === "::1" || v === "::ffff:127.0.0.1") return true;
  if (v.startsWith("127.")) return true;
  return false;
}

function requireLoopback(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const direct = (request.raw as any)?.socket?.remoteAddress || (request.raw as any)?.connection?.remoteAddress;
  const ip = direct || request.ip || String((request.headers["x-forwarded-for"] as string) || "").split(",")[0].trim();
  if (!isLoopbackAddress(ip)) {
    reply.code(403).send({ ok: false, error: "loopback_required" });
    return;
  }
  done();
}

export function registerLokalaiLinkRoutes(app: FastifyInstance): void {
  app.post(
    "/api/lokalai/link-codes/consume",
    { preHandler: requireLoopback },
    async (request, reply) => {
      const body = request.body as ConsumeLinkCodeBody | undefined;

      if (!body || typeof body !== "object" || typeof body.code !== "string" || body.code.trim().length === 0) {
        reply.code(400).send({ ok: false, error: "invalid_code" });
        return;
      }

      const result = lokalaiLinkCodeStore.consume(body.code.trim());
      if (!result.ok) {
        const status = result.reason === "expired" ? 410 : 404;
        reply.code(status).send({ ok: false, error: result.reason === "expired" ? "code_expired" : "code_not_found" });
        return;
      }

      reply.send({ telegram_user_id: result.telegramUserId });
    }
  );
}
