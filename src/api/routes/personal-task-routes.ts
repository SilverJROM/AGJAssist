import { FastifyInstance } from "fastify";
import { PersonalTaskService } from "../../services/personal-task-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerPersonalTaskRoutes(
  app: FastifyInstance,
  authService: AuthService,
  personalTaskService: PersonalTaskService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get<{ Querystring: { frequency?: string; day?: string; inactive?: string; view?: string; date?: string; days?: string } }>(
    "/api/personal-tasks",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;

      // Return inactive/archived tasks
      if (query.inactive === "true") {
        return {
          tasks: personalTaskService.listInactive(request.sessionUser!.id, query.frequency)
        };
      }

      // Templates view (for Setup tab)
      if (query.view === "templates") {
        return {
          tasks: personalTaskService.listTemplates(request.sessionUser!.id, query.frequency)
        };
      }

      // Instances view (for Action tab)
      if (query.view === "instances") {
        const targetDate = query.date || new Date().toISOString().slice(0, 10);
        return {
          tasks: personalTaskService.listInstances(request.sessionUser!.id, targetDate)
        };
      }

      // Daily instances view
      if (query.view === "daily-instances") {
        const targetDate = query.date || new Date().toISOString().slice(0, 10);
        return {
          tasks: personalTaskService.listDailyInstances(request.sessionUser!.id, targetDate)
        };
      }

      // Weekly instances view
      if (query.view === "weekly-instances") {
        const targetDate = query.date || new Date().toISOString().slice(0, 10);
        return {
          tasks: personalTaskService.listWeeklyInstances(request.sessionUser!.id, targetDate)
        };
      }

      // One-off tasks for a date
      if (query.view === "oneoffs") {
        const targetDate = query.date || new Date().toISOString().slice(0, 10);
        return {
          tasks: personalTaskService.listOneOffs(request.sessionUser!.id, targetDate)
        };
      }

      // Completed tasks (active but completed, grouped by date)
      if (query.view === "completed") {
        // Auto-complete old instances before listing
        personalTaskService.autoCompleteOldInstances(request.sessionUser!.id);
        const days = query.days ? Number(query.days) : undefined;
        return {
          tasks: personalTaskService.listCompleted(request.sessionUser!.id, days)
        };
      }

      // Day filtering for daily tasks (legacy, now returns instances for today)
      if (query.frequency === "daily" && query.day !== undefined) {
        return {
          tasks: personalTaskService.listForDay(request.sessionUser!.id, Number(query.day))
        };
      }

      return {
        tasks: personalTaskService.list(request.sessionUser!.id, query.frequency)
      };
    }
  );

  app.post<{
    Body: {
      title: string;
      description?: string;
      frequency: string;
      day_of_week?: number;
      due_date?: string;
      template_id?: number;
      target_date?: string;
    };
  }>(
    "/api/personal-tasks",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { title, description, frequency, day_of_week, due_date, template_id, target_date } = request.body || {};
      if (!title) return reply.code(400).send({ error: "title is required" });
      if (!frequency) return reply.code(400).send({ error: "frequency is required" });

      const task = personalTaskService.create({
        title,
        description: description || null,
        frequency,
        day_of_week: day_of_week ?? null,
        due_date: due_date || null,
        template_id: template_id ?? null,
        target_date: target_date || null,
        createdBy: request.sessionUser.id
      });

      return reply.code(201).send({ task });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/personal-tasks/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const task = personalTaskService.getById(Number(request.params.id));
      if (!task) return reply.code(404).send({ error: "Task not found" });
      return { task };
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      frequency?: string;
      day_of_week?: number;
      due_date?: string;
      active?: number;
      template_id?: number | null;
    };
  }>(
    "/api/personal-tasks/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const task = personalTaskService.update(
        Number(request.params.id),
        request.body || {},
        request.sessionUser.id
      );

      if (!task) return reply.code(404).send({ error: "Task not found" });
      return { task };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/personal-tasks/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = personalTaskService.delete(Number(request.params.id), request.sessionUser.id);
      if (!deleted) return reply.code(404).send({ error: "Task not found" });
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string }; Body: { date?: string } }>(
    "/api/personal-tasks/:id/toggle",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const date = request.body?.date || new Date().toISOString().slice(0, 10);

      const result = personalTaskService.toggleCompletion(
        Number(request.params.id),
        date
      );

      if (!result) return reply.code(404).send({ error: "Task not found" });
      return { completion: result };
    }
  );

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    "/api/personal-tasks/:id/completions",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const query = request.query as Record<string, string>;

      const completions = personalTaskService.getCompletions(
        Number(request.params.id),
        query.from,
        query.to
      );

      return { completions };
    }
  );

  // ===================== TASK ITEMS (sub-items) =====================

  app.get<{ Params: { id: string } }>(
    "/api/personal-tasks/:id/items",
    { preHandler: authMiddleware },
    async (request) => {
      return { items: personalTaskService.listItems(Number(request.params.id)) };
    }
  );

  app.post<{ Params: { id: string }; Body: { description: string; sort_order?: number } }>(
    "/api/personal-tasks/:id/items",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { description, sort_order } = request.body || {};
      if (!description) return reply.code(400).send({ error: "description is required" });

      const item = personalTaskService.addItem(
        Number(request.params.id),
        description,
        sort_order
      );

      return reply.code(201).send({ item });
    }
  );

  app.patch<{ Params: { id: string }; Body: { description?: string; sort_order?: number; completed?: number } }>(
    "/api/personal-task-items/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const item = personalTaskService.updateItem(
        Number(request.params.id),
        request.body || {}
      );

      if (!item) return reply.code(404).send({ error: "Item not found" });
      return { item };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/personal-task-items/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = personalTaskService.deleteItem(Number(request.params.id));
      if (!deleted) return reply.code(404).send({ error: "Item not found" });
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/personal-task-items/:id/toggle",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const item = personalTaskService.toggleItemCompletion(Number(request.params.id));
      if (!item) return reply.code(404).send({ error: "Item not found" });
      return { item };
    }
  );

  app.post<{ Body: { date?: string; type?: string; force?: boolean } }>(
    "/api/personal-tasks/generate",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const body = (request.body || {}) as Record<string, unknown>;
      const today = (body.date as string) || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      const genType = (body.type as string) || "both";
      const force = !!body.force;
      const userId = request.sessionUser.id;

      if (genType === "daily" || genType === "both") {
        if (force) {
          personalTaskService.deleteInstancesForDate(userId, today, "daily");
        }
        const dailyCount = personalTaskService.generateDailyInstances(userId, today);
        if (genType === "daily") {
          if (dailyCount === 0 && !force) {
            // Check if it's because instances exist or no templates for this day
            const hasInstances = personalTaskService.hasInstancesForDate(userId, today, "daily");
            if (hasInstances) {
              return reply.code(409).send({ error: "Daily tasks already exist for " + today });
            }
            return reply.code(200).send({ generated: 0, type: "daily", date: today, message: "No daily templates active for this day" });
          }
          return { generated: dailyCount, type: "daily", date: today };
        }
      }

      if (genType === "weekly" || genType === "both") {
        const d = new Date(today + "T00:00:00Z");
        const dayOfWeek = d.getUTCDay();
        const satDiff = dayOfWeek === 6 ? 0 : 6 - dayOfWeek;
        const satDate = new Date(d);
        satDate.setUTCDate(satDate.getUTCDate() + satDiff);
        const saturday = satDate.toISOString().slice(0, 10);
        if (force) {
          personalTaskService.deleteInstancesForDate(userId, saturday, "weekly");
        }
        const weeklyCount = personalTaskService.generateWeeklyInstances(userId, saturday);
        if (genType === "weekly") {
          if (weeklyCount === 0 && !force) {
            const hasInstances = personalTaskService.hasInstancesForDate(userId, saturday, "weekly");
            if (hasInstances) {
              return reply.code(409).send({ error: "Weekly tasks already exist for week of " + saturday });
            }
            return reply.code(200).send({ generated: 0, type: "weekly", date: saturday, message: "No weekly templates active" });
          }
          return { generated: weeklyCount, type: "weekly", date: saturday };
        }
      }

      // "both" fallback
      if (force) {
        personalTaskService.deleteInstancesForDate(userId, today, "daily");
      }
      const dailyCount = personalTaskService.generateDailyInstances(userId, today);
      const d2 = new Date(today + "T00:00:00Z");
      const dayOfWeek2 = d2.getUTCDay();
      const satDiff2 = dayOfWeek2 === 6 ? 0 : 6 - dayOfWeek2;
      const satDate2 = new Date(d2);
      satDate2.setUTCDate(satDate2.getUTCDate() + satDiff2);
      const saturday2 = satDate2.toISOString().slice(0, 10);
      if (force) {
        personalTaskService.deleteInstancesForDate(userId, saturday2, "weekly");
      }
      const weeklyCount = personalTaskService.generateWeeklyInstances(userId, saturday2);

      return { daily: dailyCount, weekly: weeklyCount, date: today, saturday: saturday2 };
    }
  );

  app.post(
    "/api/personal-tasks/auto-archive",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const count = personalTaskService.autoArchive();
      return { archived: count };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/personal-tasks/:id/archive",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const task = personalTaskService.archiveTask(
        Number(request.params.id),
        request.sessionUser.id
      );
      if (!task) return reply.code(404).send({ error: "Task not found" });
      return { task };
    }
  );
}
