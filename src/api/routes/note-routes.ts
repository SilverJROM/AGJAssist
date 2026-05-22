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

  // ── Note folders (new, N1b) ──

  app.get(
    "/api/note-folders",
    { preHandler: authMiddleware },
    async () => {
      return { folders: noteService.listFolders() };
    }
  );

  app.post<{ Body: { name: string } }>(
    "/api/note-folders",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }
      const { name } = request.body || {};
      if (!name) return reply.code(400).send({ error: "name is required" });
      const folder = noteService.createFolder(name, request.sessionUser.id);
      return reply.code(201).send({ folder });
    }
  );

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/note-folders/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }
      const { name } = request.body || {};
      if (!name) return reply.code(400).send({ error: "name is required" });
      const folder = noteService.renameFolder(Number(request.params.id), name);
      if (!folder) return reply.code(404).send({ error: "Folder not found" });
      return { folder };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/note-folders/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }
      const result = noteService.deleteFolder(Number(request.params.id));
      if (!result.ok) {
        if (result.reason === "not_found") return reply.code(404).send({ error: "Folder not found" });
        if (result.reason === "cannot_delete_default") return reply.code(400).send({ error: "Cannot delete the default Notes folder" });
        return reply.code(400).send({ error: result.reason });
      }
      return reply.code(204).send();
    }
  );

  // ── Standalone notes (cross-project) ──

  app.get<{ Querystring: { project_id?: string; status?: string; search?: string; unattached?: string; sort?: string; page?: string; limit?: string; folder_id?: string } }>(
    "/api/notes",
    { preHandler: authMiddleware },
    async (request) => {
      const q = request.query;

      // folder_id filter: list notes in a specific folder (pinned DESC, updated_at DESC)
      if (q.folder_id) {
        const notes = noteService.listByFolder(Number(q.folder_id), q.search);
        return { notes, total: notes.length, page: 1, totalPages: 1 };
      }

      // search across all folders (no folder_id supplied)
      if (q.search && !q.project_id && !q.status && !q.unattached) {
        const notes = noteService.searchAll(q.search);
        return { notes, total: notes.length, page: 1, totalPages: 1 };
      }

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

  app.post<{ Body: { body: string; title?: string; project_id?: number | null; tags?: string[]; folder_id?: number } }>(
    "/api/notes",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { body, title, project_id, tags, folder_id } = request.body || {};
      if (!body) return reply.code(400).send({ error: "body is required" });

      // Resolve folder_id: use supplied value or fall back to the default "Notes" folder.
      const resolvedFolderId = folder_id ?? noteService.defaultFolderId();

      // Use createNote (folder-aware) when there is no project association
      if (!project_id && !title && !tags) {
        const note = noteService.createNote(resolvedFolderId, body, request.sessionUser.id);
        return reply.code(201).send({ note });
      }

      // Legacy path: create with project/title/tags, then patch folder_id in
      const note = noteService.create(body, request.sessionUser.id, project_id ?? null, title, tags);
      if (note.folder_id === null || note.folder_id === undefined) {
        noteService.updateNote(note.id, { folder_id: resolvedFolderId }, request.sessionUser.id);
        return reply.code(201).send({ note: noteService.getById(note.id) });
      }
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
    Body: { title?: string; body?: string; status?: string; tags?: string[]; project_id?: number | null; pinned?: number; folder_id?: number };
  }>(
    "/api/notes/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const userId = request.sessionUser.id;
      const id = Number(request.params.id);
      const { pinned, folder_id, ...legacyFields } = request.body || {};

      // Handle pinned and folder_id via the new-model methods when supplied
      if (pinned !== undefined) {
        const result = noteService.setPinned(id, pinned, userId);
        if (!result) return reply.code(404).send({ error: "Note not found" });
      }

      if (folder_id !== undefined) {
        const result = noteService.moveToFolder(id, folder_id, userId);
        if (!result) return reply.code(404).send({ error: "Note not found" });
      }

      // Apply legacy fields (title/body/status/tags/project_id) if any provided
      if (Object.keys(legacyFields).length > 0) {
        const result = noteService.update(id, legacyFields, userId);
        if (!result) return reply.code(404).send({ error: "Note not found" });
      }

      const note = noteService.getById(id);
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
