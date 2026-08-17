import { FastifyInstance } from "fastify";
import { TmuxService } from "../../tmux/tmux-service.js";
import { TmuxStreamManager } from "../../tmux/tmux-stream-manager.js";
import { DatabaseService } from "../../db/database.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { AuditService } from "../../services/audit-service.js";
import { SafetyService } from "../../services/safety-service.js";
import { ProjectService } from "../../services/project-service.js";
import { FileService, PathTraversalError } from "../../services/file-service.js";

const ATTACH_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

function sanitizeAttachImageBasename(filename: string): string | null {
  const raw = String(filename || "");
  const base = raw.replace(/\\/g, "/").split("/").pop() || "";
  const strippedDots = base.replace(/\.\./g, "");
  const cleaned = strippedDots.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) return null;
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0 || dot === cleaned.length - 1) return null;
  const ext = cleaned.slice(dot + 1).toLowerCase();
  if (!ATTACH_IMAGE_EXTS.has(ext)) return null;
  const stem = cleaned.slice(0, dot).replace(/^\.+/, "") || "image";
  if (!stem) return null;
  return `${stem}.${ext}`;
}

function utcAttachStamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

function decodeAttachImageBase64(dataBase64: string): Buffer | null {
  const stripped = String(dataBase64 || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  if (!stripped || !/^[A-Za-z0-9+/]+=*$/.test(stripped)) return null;
  const buf = Buffer.from(stripped, "base64");
  if (!buf.length) return null;
  return buf;
}

export function registerTmuxRoutes(
  app: FastifyInstance,
  authService: AuthService,
  tmuxService: TmuxService,
  streamManager: TmuxStreamManager,
  db: DatabaseService,
  auditService: AuditService,
  safetyService: SafetyService,
  projectService?: ProjectService,
  fileService?: FileService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  function resolveAttachProjectRoot(projectId: number | undefined): string | null {
    if (projectId !== undefined) {
      if (!projectService) return null;
      const project = projectService.getById(projectId);
      if (!project) return null;
      return projectService.getFullPath(project);
    }
    return process.cwd();
  }

  // List all tmux sessions with pane info
  app.get(
    "/api/tmux/sessions",
    { preHandler: authMiddleware },
    async () => {
      const panes = await tmuxService.listPanes();

      // Group by session
      const sessions = new Map<string, typeof panes>();
      for (const pane of panes) {
        const existing = sessions.get(pane.session) || [];
        existing.push(pane);
        sessions.set(pane.session, existing);
      }

      // Enrich with DB info
      const result = [];
      for (const [sessionName, sessionPanes] of sessions) {
        const dbSession = db
          .prepare("SELECT * FROM tmux_sessions WHERE session_name = ? AND status = 'active'")
          .get(sessionName) as { id: number; project_id: number | null } | undefined;

        result.push({
          session_name: sessionName,
          db_id: dbSession?.id || null,
          project_id: dbSession?.project_id || null,
          panes: sessionPanes
        });
      }

      return { sessions: result };
    }
  );

  // Create new tmux session
  app.post<{ Body: { project_id?: number; name?: string; cwd?: string } }>(
    "/api/tmux/sessions",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const { project_id, name, cwd } = request.body || {};

      let sessionName = name;
      let sessionCwd = cwd;

      if (project_id) {
        const project = db
          .prepare("SELECT * FROM projects WHERE id = ?")
          .get(project_id) as { directory_name: string } | undefined;

        if (!project) {
          return reply.code(404).send({ error: "Project not found" });
        }

        sessionName = sessionName || `agj-${project.directory_name}`;
        if (!sessionCwd) {
          const { ProjectService } = await import("../../services/project-service.js");
          sessionCwd = `${process.env.PROJECTS_ROOT || "/home/agjrom/websites"}/${project.directory_name}`;
        }
      }

      if (!sessionName) {
        return reply.code(400).send({ error: "name or project_id is required" });
      }

      try {
        const target = await tmuxService.createSession(sessionName, sessionCwd);

        // Track in DB
        const result = db
          .prepare(
            "INSERT INTO tmux_sessions (project_id, session_name, created_by) VALUES (?, ?, ?) RETURNING id"
          )
          .get(project_id || null, sessionName, request.sessionUser!.id) as { id: number };

        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "tmux_session_create",
          resourceType: "tmux",
          resourceId: String(result.id),
          details: { session_name: sessionName, target, project_id },
          surface: "web"
        });

        return reply.code(201).send({ id: result.id, session_name: sessionName, target });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // Terminate a tmux session
  app.delete<{ Params: { name: string } }>(
    "/api/tmux/sessions/:name",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const { name } = request.params;
      try {
        await tmuxService.terminateSession(name);

        // Update DB
        db.prepare(
          "UPDATE tmux_sessions SET status = 'terminated', terminated_at = datetime('now') WHERE session_name = ? AND status = 'active'"
        ).run(name);

        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "tmux_session_terminate",
          resourceType: "tmux",
          details: { session_name: name },
          surface: "web"
        });

        return reply.code(204).send();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // Get pane output (snapshot)
  app.get<{ Params: { target: string }; Querystring: { lines?: string } }>(
    "/api/tmux/panes/:target/output",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const target = decodeURIComponent(request.params.target);
      const lines = Number((request.query as Record<string, string>).lines || "200");
      try {
        const output = await tmuxService.peekPane(target, lines);
        return { target, output, lines };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // Get pane output history
  app.get<{ Params: { target: string } }>(
    "/api/tmux/panes/:target/history",
    { preHandler: authMiddleware },
    async (request) => {
      const target = decodeURIComponent(request.params.target);
      const query = request.query as Record<string, string>;
      const limit = Math.min(Number(query.limit || "50"), 200);
      const offset = Number(query.offset || "0");
      const search = query.search;

      let sql = "SELECT * FROM tmux_output_history WHERE pane_target = ?";
      const params: unknown[] = [target];

      if (search) {
        sql += " AND content LIKE ?";
        params.push(`%${search}%`);
      }

      sql += " ORDER BY captured_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const entries = db.prepare(sql).all(...params);
      return { entries };
    }
  );

  // Send command to pane
  app.post<{ Params: { target: string }; Body: { command?: string; enter?: boolean; force?: boolean; send_enter_only?: boolean } }>(
    "/api/tmux/panes/:target/send",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const target = decodeURIComponent(request.params.target);
      const { command, enter = true, force = false, send_enter_only = false } = request.body || {};

      if (!command && !send_enter_only) {
        return reply.code(400).send({ error: "command is required" });
      }

      try {
        const result = send_enter_only
          ? await tmuxService.sendEnter(target)
          : await tmuxService.sendCommand(target, command!, enter, force);

        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "tmux_command_send",
          resourceType: "tmux",
          tmuxTarget: target,
          details: { command: command || null, enter, send_enter_only, blocked: result.blocked },
          surface: "web"
        });

        if (result.blocked) {
          return reply.code(403).send({
            error: result.message,
            safety_pattern: result.safetyCheck?.pattern?.pattern
          });
        }

        return { message: result.message };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // Send named control keys (Down/Enter/Escape/…) so the chat UI can drive
  // interactive selections over plain REST — no WebSocket required (works over
  // the tunnel), no control-char issue (tmux key names, strictly allowlisted).
  app.post<{ Params: { target: string }; Body: { keys?: string[] } }>(
    "/api/tmux/panes/:target/keys",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const target = decodeURIComponent(request.params.target);
      const keys = request.body?.keys;
      if (!Array.isArray(keys) || keys.length === 0) {
        return reply.code(400).send({ error: "keys is required" });
      }
      try {
        const result = await tmuxService.sendNamedKeys(target, keys);
        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "tmux_keys_send",
          resourceType: "tmux",
          tmuxTarget: target,
          details: { keys },
          surface: "web"
        });
        return { message: result.message };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // Save a composer screenshot into the project's tmp/ and return a cwd-relative path.
  app.post<{ Body: { filename?: string; dataBase64?: string; project_id?: number } }>(
    "/api/tmux/attach-image",
    { preHandler: [authMiddleware, requireOwner], bodyLimit: 15 * 1024 * 1024 },
    async (request, reply) => {
      const { filename, dataBase64, project_id } = request.body || {};
      if (!filename || !dataBase64) {
        return reply.code(400).send({ error: "filename and dataBase64 are required" });
      }

      const sanitized = sanitizeAttachImageBasename(filename);
      if (!sanitized) {
        return reply.code(400).send({
          error: "filename must be an image (png, jpg, jpeg, gif, webp) without path separators"
        });
      }

      const buf = decodeAttachImageBase64(dataBase64);
      if (!buf) {
        return reply.code(400).send({ error: "dataBase64 is not valid base64" });
      }
      if (buf.length > ATTACH_IMAGE_MAX_BYTES) {
        return reply.code(413).send({ error: "image exceeds 10MB limit" });
      }

      let projectId: number | undefined;
      if (project_id !== undefined && project_id !== null) {
        const parsed = Number(project_id);
        if (!Number.isFinite(parsed)) {
          return reply.code(400).send({ error: "invalid project_id" });
        }
        projectId = parsed;
      }

      const projectRoot = resolveAttachProjectRoot(projectId);
      if (!projectRoot) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const relativePath = `tmp/term-${utcAttachStamp()}-${sanitized}`;
      try {
        if (fileService) {
          fileService.writeBinaryFile(projectRoot, relativePath, buf);
        } else {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const dest = path.resolve(projectRoot, relativePath);
          const root = path.resolve(projectRoot);
          if (!dest.startsWith(root + path.sep)) {
            return reply.code(403).send({ error: "Access denied" });
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, buf);
        }

        auditService.log({
          userId: request.sessionUser!.id,
          actionType: "tmux_attach_image",
          resourceType: "file",
          resourceId: relativePath,
          details: { filename: sanitized, size: buf.length, project_id: projectId ?? null },
          surface: "web"
        });

        return { ok: true, path: relativePath };
      } catch (error) {
        if (error instanceof PathTraversalError) {
          return reply.code(403).send({ error: "Access denied" });
        }
        const msg = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: msg });
      }
    }
  );

  // WebSocket endpoint for tmux streaming
  app.get<{ Params: { target: string }; Querystring: { token?: string } }>(
    "/ws/tmux/:target",
    { websocket: true },
    async (socket, request) => {
      const target = decodeURIComponent(request.params.target);
      const token = (request.query as Record<string, string>).token || "";
      await streamManager.handleConnection(socket, target, token);
    }
  );
}
