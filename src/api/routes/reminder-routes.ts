import { FastifyInstance } from "fastify";
import { ReminderService } from "../../services/reminder-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerReminderRoutes(
  app: FastifyInstance,
  authService: AuthService,
  reminderService: ReminderService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get<{ Querystring: { all?: string; view?: string } }>(
    "/api/reminders",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;

      // Tasks view: only reminders with fired alerts or passed event_date
      if (query.view === "tasks") {
        return {
          reminders: reminderService.listForTasksView(request.sessionUser!.id)
        };
      }

      const includeAll = query.all === "true";
      return {
        reminders: includeAll
          ? reminderService.listAllWithAlerts(request.sessionUser!.id)
          : reminderService.listWithAlerts(request.sessionUser!.id)
      };
    }
  );

  app.post<{
    Body: {
      title: string;
      description?: string;
      event_date: string;
      reminder_1?: string;
      reminder_2?: string;
      recurrence?: string;
      alerts?: { offset_value: number; offset_unit: string }[];
    };
  }>(
    "/api/reminders",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { title, description, event_date, reminder_1, reminder_2, recurrence, alerts } = request.body || {};
      if (!title) return reply.code(400).send({ error: "title is required" });
      if (!event_date) return reply.code(400).send({ error: "event_date is required" });

      const reminder = reminderService.create({
        title,
        description: description || null,
        event_date,
        reminder_1: reminder_1 || null,
        reminder_2: reminder_2 || null,
        recurrence: recurrence || null,
        alerts: alerts || [],
        createdBy: request.sessionUser.id
      });

      return reply.code(201).send({ reminder: reminderService.getByIdWithAlerts(reminder.id) });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/reminders/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const reminder = reminderService.getByIdWithAlerts(Number(request.params.id));
      if (!reminder) return reply.code(404).send({ error: "Reminder not found" });
      return { reminder };
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      event_date?: string;
      reminder_1?: string;
      reminder_2?: string;
      recurrence?: string;
      active?: number;
      alerts?: { offset_value: number; offset_unit: string }[];
    };
  }>(
    "/api/reminders/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const reminder = reminderService.update(
        Number(request.params.id),
        request.body || {},
        request.sessionUser.id
      );

      if (!reminder) return reply.code(404).send({ error: "Reminder not found" });
      return { reminder: reminderService.getByIdWithAlerts(reminder.id) };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/reminders/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = reminderService.delete(Number(request.params.id), request.sessionUser.id);
      if (!deleted) return reply.code(404).send({ error: "Reminder not found" });
      return { ok: true };
    }
  );

  // ===================== ALERT ENDPOINTS =====================

  app.get<{ Params: { id: string } }>(
    "/api/reminders/:id/alerts",
    { preHandler: authMiddleware },
    async (request) => {
      return { alerts: reminderService.listAlerts(Number(request.params.id)) };
    }
  );

  app.post<{ Params: { id: string }; Body: { offset_value: number; offset_unit: string } }>(
    "/api/reminders/:id/alerts",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { offset_value, offset_unit } = request.body || {};
      if (!offset_value || !offset_unit) {
        return reply.code(400).send({ error: "offset_value and offset_unit are required" });
      }

      try {
        const alert = reminderService.createAlert(
          Number(request.params.id),
          offset_value,
          offset_unit
        );
        return reply.code(201).send({ alert });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/reminder-alerts/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = reminderService.deleteAlert(Number(request.params.id));
      if (!deleted) return reply.code(404).send({ error: "Alert not found" });
      return { ok: true };
    }
  );
}
