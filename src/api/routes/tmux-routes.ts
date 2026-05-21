import { FastifyInstance } from "fastify";
import { TmuxService } from "../../tmux/tmux-service.js";
import { TmuxStreamManager } from "../../tmux/tmux-stream-manager.js";
import { DatabaseService } from "../../db/database.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { AuditService } from "../../services/audit-service.js";
import { SafetyService } from "../../services/safety-service.js";

export function registerTmuxRoutes(
  app: FastifyInstance,
  authService: AuthService,
  tmuxService: TmuxService,
  streamManager: TmuxStreamManager,
  db: DatabaseService,
  auditService: AuditService,
  safetyService: SafetyService
): void {
  const authMiddleware = createAuthMiddleware(authService);

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
