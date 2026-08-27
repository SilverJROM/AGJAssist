import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { AgentWakeupService } from "../../services/agent-wakeup-service.js";
import { DatabaseService } from "../../db/database.js";

export function registerAgentWakeupRoutes(
  app: FastifyInstance,
  authService: AuthService,
  db: DatabaseService
): void {
  const authMiddleware = createAuthMiddleware(authService);
  const wakeupService = new AgentWakeupService(db);

  // Pending read (owner only)
  app.get(
    "/api/agent-wakeups/pending",
    { preHandler: [authMiddleware, requireOwner] },
    async (request: FastifyRequest) => {
      const pending = wakeupService.listPending();
      return { wakeups: pending };
    }
  );

  // Schedule wakeup (owner only)
  app.post<{ Body: { pane_target: string; manual_fire_time: string; action: string } }>(
    "/api/agent-wakeups",
    { preHandler: [authMiddleware, requireOwner] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;

      if (!body?.pane_target || typeof body.pane_target !== "string" || body.pane_target.trim() === "") {
        return reply.code(400).send({ error: "pane_target is required" });
      }
      if (!body?.action || typeof body.action !== "string" || body.action.trim() === "") {
        return reply.code(400).send({ error: "action is required" });
      }
      if (!body?.manual_fire_time || typeof body.manual_fire_time !== "string") {
        return reply.code(400).send({ error: "manual_fire_time is required" });
      }

      // Validate pane_target format to prevent cross-pane access
      const panePattern = /^[a-zA-Z0-9_\-:]+$/;
      if (!panePattern.test(body.pane_target)) {
        return reply.code(400).send({ error: "Invalid pane_target" });
      }

      const fireTime = new Date(body.manual_fire_time);
      if (isNaN(fireTime.getTime())) {
        return reply.code(400).send({ error: "manual_fire_time must be a valid ISO date" });
      }
      const now = new Date();
      if (fireTime.getTime() <= now.getTime()) {
        return reply.code(400).send({ error: "manual_fire_time must be in the future" });
      }

      try {
        const wakeup = wakeupService.create({
          paneTarget: body.pane_target,
          manualFireTime: fireTime.toISOString(),
          action: body.action.trim(),
        });
        return reply.code(201).send({ wakeup });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  // Cancel wakeup (owner only)
  app.delete<{ Params: { id: string } }>(
    "/api/agent-wakeups/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: "Invalid id" });
      }

      const wakeup = wakeupService.getById(id);
      if (!wakeup) {
        return reply.code(404).send({ error: "Wakeup not found" });
      }

      // Cross-pane access fail-closed: ensure pane_target format is valid
      const panePattern = /^[a-zA-Z0-9_\-:]+$/;
      if (!panePattern.test(wakeup.pane_target)) {
        return reply.code(403).send({ error: "Cross-pane access denied" });
      }

      const ok = wakeupService.cancel(id);
      if (!ok) {
        return reply.code(404).send({ error: "Wakeup not found or already processed" });
      }
      return reply.code(204).send();
    }
  );
}
