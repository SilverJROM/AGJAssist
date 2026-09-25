import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import fastifyFormbody from "@fastify/formbody";
import fastifyRateLimit from "@fastify/rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppConfig } from "../config/config.js";
import { AuthService } from "../auth/auth-service.js";
import { ProjectService } from "../services/project-service.js";
import { SafetyService } from "../services/safety-service.js";
import { AuditService } from "../services/audit-service.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerEscalationRoutes } from "./routes/escalation-routes.js";
import { registerProjectRoutes } from "./routes/project-routes.js";
import { registerSafetyRoutes } from "./routes/safety-routes.js";
import { registerAuditRoutes } from "./routes/audit-routes.js";
import { registerTmuxRoutes } from "./routes/tmux-routes.js";
import { TmuxService } from "../tmux/tmux-service.js";
import { TmuxStreamManager } from "../tmux/tmux-stream-manager.js";
import { DatabaseService } from "../db/database.js";
import { DelegationService } from "../services/delegation-service.js";
import { registerDelegationRoutes } from "./routes/delegation-routes.js";
import { NoteService } from "../services/note-service.js";
import { PlanService } from "../services/plan-service.js";
import { TaskService } from "../services/task-service.js";
import { registerNoteRoutes } from "./routes/note-routes.js";
import { registerPlanRoutes } from "./routes/plan-routes.js";
import { registerTaskRoutes } from "./routes/task-routes.js";
import { FileService } from "../services/file-service.js";
import { registerFileRoutes } from "./routes/file-routes.js";
import { StepTemplateService } from "../services/step-template-service.js";
import { registerTemplateRoutes } from "./routes/template-routes.js";
import { PersonalTaskService } from "../services/personal-task-service.js";
import { registerPersonalTaskRoutes } from "./routes/personal-task-routes.js";
import { ReminderService } from "../services/reminder-service.js";
import { registerReminderRoutes } from "./routes/reminder-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerAgentReminderRoutes } from "./routes/agent-reminder-routes.js";
import { registerAgentWakeupRoutes } from "./routes/agent-wakeup-routes.js";
import { AgentAssignmentService } from "../services/agent-assignment-service.js";
import { CoordinatorLaunchService } from "../services/coordinator-launch-service.js";
import { AgentEventsStreamManager } from "./websocket/agent-events-stream-manager.js";
import { registerAgentEventsRoutes } from "./routes/agent-events-routes.js";
import type { TelegramAssistant } from "../bot/telegram-bot.js";
import { registerTgLoginRoutes } from "./routes/tg-login-routes.js";
import { registerLokalaiLinkRoutes } from "./routes/lokalai-link-routes.js";
import { registerTelegramWebhookRoutes } from "./routes/telegram-webhook-routes.js";
import { registerTerminalGroupsRoutes } from "./routes/terminal-groups-routes.js";
import { TerminalGroupsService } from "../services/terminal-groups-service.js";
import { registerMcpOauthRoutes } from "./routes/mcp-oauth-routes.js";
import { McpClientService } from "../mcp/mcp-client-service.js";
import { McpCodeService } from "../mcp/mcp-code-service.js";
import { McpTokenService } from "../mcp/mcp-token-service.js";
import { McpGrantService } from "../mcp/mcp-grant-service.js";
import { McpPoolService } from "../mcp/mcp-pool-service.js";
import { McpScopeService } from "../mcp/mcp-scope-service.js";
import { McpBearerService } from "../mcp/mcp-bearer-service.js";
import { McpRateLimiter } from "../mcp/mcp-rate-limit.js";
import { registerMcpRoutes } from "./routes/mcp-routes.js";
import { registerMcpManagementRoutes } from "./routes/mcp-management-routes.js";
import { registerSummaryRoutes } from "./routes/summary-routes.js";
import { registerXmachinesRoutes } from "./routes/xmachines-routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ApiServices {
  authService: AuthService;
  projectService: ProjectService;
  safetyService: SafetyService;
  auditService: AuditService;
  tmuxService: TmuxService;
  tmuxStreamManager: TmuxStreamManager;
  db: DatabaseService;
  delegationService: DelegationService;
  noteService: NoteService;
  planService: PlanService;
  taskService: TaskService;
  fileService: FileService;
  stepTemplateService: StepTemplateService;
  personalTaskService: PersonalTaskService;
  reminderService: ReminderService;
  agentAssignmentService: AgentAssignmentService;
  coordinatorLaunchService?: CoordinatorLaunchService;
  agentEventsStreamManager?: AgentEventsStreamManager;
  telegramAssistant?: TelegramAssistant | null;
}

export async function createApiServer(
  config: AppConfig,
  services: ApiServices
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, {
    origin: true,
    credentials: true
  });

  await app.register(fastifyFormbody);
  await app.register(fastifyRateLimit, { global: false });

  await app.register(fastifyWebsocket);

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "web", "public"),
    prefix: "/",
    cacheControl: false
  });

  // Prevent caching of static assets (critical for Telegram WebView)
  app.addHook("onSend", (request, reply, payload, done) => {
    if (!request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
    }
    done();
  });

  // Health check
  app.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));

  // FENCE_STUB pre-registration patch: this hook must be added before any
  // register*Routes() call below, because a Fastify hook only applies to
  // routes declared after it in the same encapsulation context — added
  // late (post-registration), it silently never fires for existing routes.
  if (process.env.FENCE_STUB) {
    const stub = process.env.FENCE_STUB;
    if (stub !== "B2") {
      app.addHook("preHandler", async (request, reply) => {
        const url = request.url || "";
        // C3: make reminders active fail
        if (stub === "C3" && url.startsWith("/api/agent-reminders/active") && !url.includes("c4_probe=1") && !url.includes("c6_probe=1")) {
          reply.code(500).type("application/json").send({ stubbed: true, contributor: "C3" });
          return reply;
        }
        // D3: make summary endpoints fail
        if (stub === "D3" && url.startsWith("/api/summary-endpoints")) {
          reply.code(500).type("application/json").send({ stubbed: true, contributor: "D3" });
          return reply;
        }
        // E2: make wakeups fire fail
        if (stub === "E2" && url.startsWith("/api/agent-wakeups/fire")) {
          reply.code(500).type("application/json").send({ stubbed: true, contributor: "E2" });
          return reply;
        }
        // F1: make the agent-session refresh data path (backs G3's
        // refresh-from-session surface) fail
        if (stub === "F1" && url.startsWith("/api/agent-session/refresh")) {
          reply.code(500).type("application/json").send({ stubbed: true, contributor: "F1" });
          return reply;
        }
      });
    }
  }

  // Register route groups
  registerTgLoginRoutes(app, config, services.telegramAssistant);
  registerLokalaiLinkRoutes(app, config);
  registerTelegramWebhookRoutes(app, config, services.telegramAssistant);
  registerAuthRoutes(app, services.authService, config, services.telegramAssistant);
  registerEscalationRoutes(app, config, services.telegramAssistant, services.auditService);
  registerProjectRoutes(app, services.authService, services.projectService, services.auditService);
  registerSafetyRoutes(app, services.authService, services.safetyService);
  registerAuditRoutes(app, services.authService, services.auditService);
  registerTmuxRoutes(
    app,
    services.authService,
    services.tmuxService,
    services.tmuxStreamManager,
    services.db,
    services.auditService,
    services.safetyService,
    services.projectService,
    services.fileService
  );

  registerDelegationRoutes(app, services.authService, services.delegationService);
  registerNoteRoutes(app, services.authService, services.noteService);
  registerPlanRoutes(app, services.authService, services.planService, services.projectService);
  registerTaskRoutes(app, services.authService, services.taskService);
  registerFileRoutes(app, services.authService, services.projectService, services.fileService, services.auditService);
  registerTemplateRoutes(app, services.authService, services.stepTemplateService);
  registerPersonalTaskRoutes(app, services.authService, services.personalTaskService);
  registerReminderRoutes(app, services.authService, services.reminderService);
  registerAgentRoutes(app, services.authService, services.agentAssignmentService, services.coordinatorLaunchService, services.tmuxService, services.projectService, services.safetyService);
  registerAgentReminderRoutes(app, services.authService, services.db);
  registerAgentWakeupRoutes(app, services.authService, services.db);
  registerSummaryRoutes(app, services.authService, services.db);
  registerXmachinesRoutes(app, services.authService);

  if (services.agentEventsStreamManager) {
    registerAgentEventsRoutes(app, services.agentEventsStreamManager);
  }

  const terminalGroupsService = new TerminalGroupsService(services.db);
  registerTerminalGroupsRoutes(
    app,
    services.authService,
    terminalGroupsService
  );

  const mcpClients = new McpClientService(services.db);
  const mcpTokens = new McpTokenService(services.db, services.auditService);
  const mcpCodes = new McpCodeService(services.db, mcpTokens);
  const mcpGrants = new McpGrantService(services.db, mcpTokens, services.auditService);
  const mcpPool = new McpPoolService(services.db, services.auditService);
  const mcpScope = new McpScopeService(services.db, terminalGroupsService, mcpPool);
  const mcpBearer = new McpBearerService(
    mcpTokens,
    mcpGrants,
    mcpScope,
    services.tmuxService
  );
  registerMcpOauthRoutes(app, {
    db: services.db,
    authService: services.authService,
    clients: mcpClients,
    tokens: mcpTokens,
    codes: mcpCodes,
    grants: mcpGrants,
    pool: mcpPool,
    groups: terminalGroupsService
  });
  registerMcpRoutes(app, {
    bearer: mcpBearer,
    limiter: new McpRateLimiter(),
    audit: services.auditService,
    tmux: services.tmuxService,
    db: services.db,
    files: services.fileService,
    projects: services.projectService
  });
  registerMcpManagementRoutes(app, {
    db: services.db,
    authService: services.authService,
    pool: mcpPool,
    grants: mcpGrants,
    clients: mcpClients,
    audit: services.auditService
  });

  return app;
}
