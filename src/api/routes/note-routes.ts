import { FastifyInstance } from "fastify";
import { NoteService } from "../../services/note-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerNoteRoutes(
  app: FastifyInstance,
  authService: AuthService,
  noteService: NoteService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  // ── Standalone notes (cross-project) ──

  app.get<{ Querystring: { project_id?: string; status?: string; search?: string; unattached?: string; sort?: string; page?: string; limit?: string } }>(
    "/api/notes",
    { preHandler: authMiddleware },
    async (request) => {
      const q = request.query;
      const filters: { projectId?: number | null; status?: string; search?: string; sort?: string; page?: number; limit?: number } = {};
      if (q.unattached === "1") {
        filters.projectId = null;
      } else if (q.project_id) {
        filters.projectId = Number(q.project_id);
      }
      if (q.status) filters.status = q.status;
      if (q.search) filters.search = q.search;
      if (q.sort) filters.sort = q.sort;
      if (q.page) filters.page = Number(q.page);
      if (q.limit) filters.limit = Number(q.limit);
      return noteService.listAll(filters);
    }
  );

  app.post<{ Body: { body: string; title?: string; project_id?: number | null; tags?: string[] } }>(
    "/api/notes",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { body, title, project_id, tags } = request.body || {};
      if (!body) return reply.code(400).send({ error: "body is required" });

      const note = noteService.create(body, request.sessionUser.id, project_id ?? null, title, tags);
      return reply.code(201).send({ note });
    }
  );

  // ── Project-scoped notes (existing, kept for backward compat) ──

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/notes",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;
      return {
        notes: noteService.list(Number(request.params.projectId), query.status)
      };
    }
  );

  app.post<{
    Params: { projectId: string };
    Body: { title?: string; body: string; tags?: string[] };
  }>(
    "/api/projects/:projectId/notes",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { title, body, tags } = request.body || {};
      if (!body) {
        return reply.code(400).send({ error: "body is required" });
      }

      const note = noteService.create(
        body,
        request.sessionUser.id,
        Number(request.params.projectId),
        title,
        tags
      );

      return reply.code(201).send({ note });
    }
  );

  // ── Single note operations ──

  app.get<{ Params: { id: string } }>(
    "/api/notes/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const note = noteService.getById(Number(request.params.id));
      if (!note) return reply.code(404).send({ error: "Note not found" });
      return { note };
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { title?: string; body?: string; status?: string; tags?: string[]; project_id?: number | null };
  }>(
    "/api/notes/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const note = noteService.update(
        Number(request.params.id),
        request.body || {},
        request.sessionUser.id
      );

      if (!note) return reply.code(404).send({ error: "Note not found" });
      return { note };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/notes/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = noteService.delete(Number(request.params.id), request.sessionUser.id);
      if (!deleted) return reply.code(404).send({ error: "Note not found" });
      return reply.code(204).send();
    }
  );

  // ── Plan integration ──

  app.post<{ Body: { noteIds: number[]; projectId: number; planId?: number; newPlanTitle?: string } }>(
    "/api/notes/add-to-plan",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { noteIds, projectId, planId, newPlanTitle } = request.body || {};
      if (!noteIds?.length || !projectId) {
        return reply.code(400).send({ error: "noteIds and projectId are required" });
      }
      if (!planId && !newPlanTitle) {
        return reply.code(400).send({ error: "Either planId or newPlanTitle is required" });
      }

      const result = noteService.addToPlan(
        noteIds,
        projectId,
        request.sessionUser.id,
        planId,
        newPlanTitle
      );

      if (!result) {
        return reply.code(400).send({ error: "Failed to add notes to plan. Check notes are open and belong to this project." });
      }

      return reply.code(200).send(result);
    }
  );

  app.post<{ Params: { id: string }; Body: { title: string; project_id?: number } }>(
    "/api/notes/:id/promote",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { title, project_id } = request.body || {};
      if (!title) return reply.code(400).send({ error: "title is required" });

      const result = noteService.promote(
        Number(request.params.id),
        title,
        request.sessionUser.id,
        project_id
      );

      if (!result) {
        return reply.code(400).send({ error: "Note not found or already promoted" });
      }

      return reply.code(201).send(result);
    }
  );
}
