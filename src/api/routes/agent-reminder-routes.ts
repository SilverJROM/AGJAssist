import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { AgentSolicitService } from "../../services/agent-solicit-service.js";
import { DatabaseService } from "../../db/database.js";

export function registerAgentReminderRoutes(
  app: FastifyInstance,
  authService: AuthService,
  db: DatabaseService
): void {
  const authMiddleware = createAuthMiddleware(authService);
  const solicitService = new AgentSolicitService(db);

  // Active reminders read (owner only)
  app.get(
    "/api/agent-reminders/active",
    { preHandler: [authMiddleware, requireOwner] },
    async (request: FastifyRequest) => {
      const userId = request.sessionUser!.id;
      return { reminders: solicitService.listActive(userId) };
    }
  );

  // Create reminder (owner only)
  app.post<{ Body: {
    folder_group: string;
    cadence_minutes: number;
    repeat_limit?: number | null;
    solicit_message?: string;
    next_fire?: string | null;
    recipients?: { agent_name: string; include?: number }[];
  } }>(
    "/api/agent-reminders",
    { preHandler: [authMiddleware, requireOwner] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;
      if (!body?.folder_group || typeof body.folder_group !== "string") {
        return reply.code(400).send({ error: "folder_group is required" });
      }
      const cadence = Number(body.cadence_minutes);
      if (!Number.isFinite(cadence) || cadence <= 0) {
        return reply.code(400).send({ error: "cadence_minutes must be > 0" });
      }
      if (body.repeat_limit !== undefined && body.repeat_limit !== null) {
        const rl = Number(body.repeat_limit);
        if (!Number.isInteger(rl) || rl < 0) {
          return reply.code(400).send({ error: "repeat_limit must be >= 0 or null" });
        }
      }

      try {
        const reminder = solicitService.create({
          user_id: request.sessionUser!.id,
          folder_group: body.folder_group,
          cadence_minutes: cadence,
          repeat_limit: body.repeat_limit ?? null,
          solicit_message: body.solicit_message,
          next_fire: body.next_fire ?? null,
          recipients: body.recipients ?? [],
          active: 1,
        });
        return reply.code(201).send({ reminder });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  // Update reminder (owner only)
  app.patch<{ Params: { id: string }; Body: {
    folder_group?: string;
    cadence_minutes?: number;
    repeat_limit?: number | null;
    next_fire?: string | null;
    solicit_message?: string;
    active?: number;
    recipients?: { agent_name: string; include?: number }[];
  } }>(
    "/api/agent-reminders/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number(request.params.id);
      const body = request.body as any;

      if (body.cadence_minutes !== undefined) {
        const cadence = Number(body.cadence_minutes);
        if (!Number.isFinite(cadence) || cadence <= 0) {
          return reply.code(400).send({ error: "cadence_minutes must be > 0" });
        }
      }
      if (body.repeat_limit !== undefined && body.repeat_limit !== null) {
        const rl = Number(body.repeat_limit);
        if (!Number.isInteger(rl) || rl < 0) {
          return reply.code(400).send({ error: "repeat_limit must be >= 0 or null" });
        }
      }

      try {
        const updated = solicitService.update(id, {
          folder_group: body.folder_group,
          cadence_minutes: body.cadence_minutes,
          repeat_limit: body.repeat_limit,
          next_fire: body.next_fire,
          solicit_message: body.solicit_message,
          active: body.active,
          recipients: body.recipients,
        });
        if (!updated) {
          return reply.code(404).send({ error: "Reminder not found" });
        }
        return { reminder: updated };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  // Cancel reminder (owner only)
  app.delete<{ Params: { id: string } }>(
    "/api/agent-reminders/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const id = Number(request.params.id);
      const ok = solicitService.delete(id);
      if (!ok) {
        return reply.code(404).send({ error: "Reminder not found" });
      }
      return reply.code(204).send();
    }
  );
}
