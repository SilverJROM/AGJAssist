import { FastifyInstance } from "fastify";
import { AuthService } from "../../auth/auth-service.js";
import { ProjectService } from "../../services/project-service.js";
import {
  FileService,
  PathTraversalError,
  FileNotFoundError,
  FileTooLargeError,
  BinaryFileError,
  FileExistsError
} from "../../services/file-service.js";
import { AuditService } from "../../services/audit-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";

export function registerFileRoutes(
  app: FastifyInstance,
  authService: AuthService,
  projectService: ProjectService,
  fileService: FileService,
  auditService: AuditService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  function getProjectRoot(projectId: number): string | null {
    const project = projectService.getById(projectId);
    if (!project) return null;
    return projectService.getFullPath(project);
  }

  function handleFileError(e: unknown, reply: any): void {
    if (e instanceof PathTraversalError) {
      reply.code(403).send({ error: "Access denied" });
    } else if (e instanceof FileNotFoundError) {
      reply.code(404).send({ error: (e as Error).message });
    } else if (e instanceof FileTooLargeError) {
      reply.code(413).send({ error: (e as Error).message });
    } else if (e instanceof BinaryFileError) {
      reply.code(422).send({ error: (e as Error).message });
    } else if (e instanceof FileExistsError) {
      reply.code(409).send({ error: (e as Error).message });
    } else {
      reply.code(500).send({ error: "Internal server error" });
    }
  }

  // List directory
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/api/projects/:id/files",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      try {
        const entries = fileService.listDirectory(root, (request.query as any).path || ".");
        return { entries };
      } catch (e) {
        handleFileError(e, reply);
      }
    }
  );

  // Read file
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    "/api/projects/:id/files/read",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      const filePath = (request.query as any).path;
      if (!filePath) return reply.code(400).send({ error: "path is required" });

      try {
        const file = fileService.readFile(root, filePath);
        return file;
      } catch (e) {
        handleFileError(e, reply);
      }
    }
  );

  // Write/update file
  app.put<{ Params: { id: string }; Querystring: { path: string }; Body: { content: string } }>(
    "/api/projects/:id/files",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      const filePath = (request.query as any).path;
      if (!filePath) return reply.code(400).send({ error: "path is required" });

      const { content } = request.body || {};
      if (content === undefined) return reply.code(400).send({ error: "content is required" });

      try {
        fileService.writeFile(root, filePath, content);
        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "file_write",
          resourceType: "file",
          resourceId: filePath,
          surface: "web"
        });
        return { ok: true };
      } catch (e) {
        handleFileError(e, reply);
      }
    }
  );

  // Create file or directory
  app.post<{ Params: { id: string }; Querystring: { path: string }; Body: { type: "file" | "directory"; content?: string } }>(
    "/api/projects/:id/files",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      const filePath = (request.query as any).path;
      if (!filePath) return reply.code(400).send({ error: "path is required" });

      const { type, content } = request.body || {};
      if (!type || !["file", "directory"].includes(type)) {
        return reply.code(400).send({ error: "type must be 'file' or 'directory'" });
      }

      try {
        if (type === "directory") {
          fileService.createDirectory(root, filePath);
        } else {
          fileService.createFile(root, filePath, content || "");
        }
        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "file_create",
          resourceType: type,
          resourceId: filePath,
          surface: "web"
        });
        return { ok: true };
      } catch (e) {
        handleFileError(e, reply);
      }
    }
  );

  // Delete file or directory
  app.delete<{ Params: { id: string }; Querystring: { path: string } }>(
    "/api/projects/:id/files",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      const filePath = (request.query as any).path;
      if (!filePath) return reply.code(400).send({ error: "path is required" });

      try {
        fileService.deleteEntry(root, filePath);
        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "file_delete",
          resourceType: "file",
          resourceId: filePath,
          surface: "web"
        });
        return { ok: true };
      } catch (e) {
        handleFileError(e, reply);
      }
    }
  );

  // Rename/move
  app.post<{ Params: { id: string }; Body: { oldPath: string; newPath: string } }>(
    "/api/projects/:id/files/rename",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      const { oldPath, newPath } = request.body || {};
      if (!oldPath || !newPath) return reply.code(400).send({ error: "oldPath and newPath are required" });

      try {
        fileService.renameEntry(root, oldPath, newPath);
        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "file_rename",
          resourceType: "file",
          resourceId: `${oldPath} -> ${newPath}`,
          surface: "web"
        });
        return { ok: true };
      } catch (e) {
        handleFileError(e, reply);
      }
    }
  );

  // Copy
  app.post<{ Params: { id: string }; Body: { srcPath: string; destPath: string } }>(
    "/api/projects/:id/files/copy",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      const { srcPath, destPath } = request.body || {};
      if (!srcPath || !destPath) return reply.code(400).send({ error: "srcPath and destPath are required" });

      try {
        fileService.copyEntry(root, srcPath, destPath);
        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "file_copy",
          resourceType: "file",
          resourceId: `${srcPath} -> ${destPath}`,
          surface: "web"
        });
        return { ok: true };
      } catch (e) {
        handleFileError(e, reply);
      }
    }
  );

  // Search files
  app.get<{ Params: { id: string }; Querystring: { q: string; limit?: string } }>(
    "/api/projects/:id/files/search",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const root = getProjectRoot(Number(request.params.id));
      if (!root) return reply.code(404).send({ error: "Project not found" });

      const q = (request.query as any).q;
      if (!q) return reply.code(400).send({ error: "q is required" });

      const limit = Math.min(Number((request.query as any).limit) || 20, 100);
      const files = fileService.searchFiles(root, q, limit);
      return { files };
    }
  );
}
