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
      const result = noteService.renameFolder(Number(request.params.id), name);
      if (!result.ok) {
        if (result.reason === "not_found") return reply.code(404).send({ error: "Folder not found" });
        if (result.reason === "cannot_rename_default") return reply.code(400).send({ error: "Cannot rename the default Notes folder" });
        return reply.code(400).send({ error: result.reason });
      }
      return { folder: result.folder };
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

  app.get<{ Querystring: { search?: string; folder_id?: string } }>(
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
      if (q.search) {
        const notes = noteService.searchAll(q.search);
        return { notes, total: notes.length, page: 1, totalPages: 1 };
      }

      // No filters — return all notes in default folder
      const folderId = noteService.defaultFolderId();
      const notes = noteService.listByFolder(folderId);
      return { notes, total: notes.length, page: 1, totalPages: 1 };
    }
  );

  app.post<{ Body: { body: string; folder_id?: number; pinned?: number } }>(
    "/api/notes",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { body = '', folder_id } = request.body || {};

      const resolvedFolderId = folder_id ?? noteService.defaultFolderId();
      const note = noteService.createNote(resolvedFolderId, body, request.sessionUser.id);
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
    Body: { body?: string; pinned?: number; folder_id?: number; font_size?: number };
  }>(
    "/api/notes/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const userId = request.sessionUser.id;
      const id = Number(request.params.id);
      const { body, pinned, folder_id, font_size } = request.body || {};

      const updates: { body?: string; pinned?: number; folder_id?: number; font_size?: number } = {};
      if (body !== undefined) updates.body = body;
      if (pinned !== undefined) updates.pinned = pinned;
      if (folder_id !== undefined) updates.folder_id = folder_id;
      if (font_size !== undefined) updates.font_size = font_size;

      if (Object.keys(updates).length > 0) {
        const result = noteService.updateNote(id, updates, userId);
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

}
