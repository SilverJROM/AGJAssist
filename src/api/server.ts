import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppConfig } from "../config/config.js";
import { AuthService } from "../auth/auth-service.js";
import { ProjectService } from "../services/project-service.js";
import { SafetyService } from "../services/safety-service.js";
import { AuditService } from "../services/audit-service.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
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
import { ConversationService } from "../services/conversation-service.js";
import { registerConversationRoutes } from "./routes/conversation-routes.js";
import { FileService } from "../services/file-service.js";
import { registerFileRoutes } from "./routes/file-routes.js";
import { StepTemplateService } from "../services/step-template-service.js";
import { registerTemplateRoutes } from "./routes/template-routes.js";
import { PersonalTaskService } from "../services/personal-task-service.js";
import { registerPersonalTaskRoutes } from "./routes/personal-task-routes.js";
import { ReminderService } from "../services/reminder-service.js";
import { registerReminderRoutes } from "./routes/reminder-routes.js";
import { ChatSettingsService } from "../services/chat-settings-service.js";
import { registerChatSettingsRoutes } from "./routes/chat-settings-routes.js";
import { registerChatRoutes } from "./routes/chat-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { OllamaProvider } from "../llm/ollama-provider.js";
import { OpenRouterProvider } from "../llm/openrouter-provider.js";
import { ToolAgent } from "../orchestration/tool-agent.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { registerLocalLlmRoutes } from "./routes/local-llm-routes.js";
import { ClaudeCliProvider } from "../llm/claude-cli-provider.js";
import { CodexCliProvider } from "../llm/codex-cli-provider.js";
import { OvermindService } from "../services/overmind-service.js";
import { registerOvermindRoutes } from "./routes/overmind-routes.js";
import type { OvermindNotify } from "../services/overmind-watcher.js";

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
  conversationService: ConversationService;
  fileService: FileService;
  stepTemplateService: StepTemplateService;
  personalTaskService: PersonalTaskService;
  reminderService: ReminderService;
  chatSettingsService: ChatSettingsService;
  ollama: OllamaProvider;
  openRouter: OpenRouterProvider;
  ollamaAgent: ToolAgent;
  openRouterAgent: ToolAgent;
  tools: ToolRegistry;
  maxToolIterations: number;
  claudeCliProvider: ClaudeCliProvider;
  codexCliProvider: CodexCliProvider;
  overmindService: OvermindService;
  overmindNotify?: OvermindNotify;
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

  // Register route groups
  registerAuthRoutes(app, services.authService);
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
    services.safetyService
  );

  registerDelegationRoutes(app, services.authService, services.delegationService);
  registerNoteRoutes(app, services.authService, services.noteService);
  registerPlanRoutes(app, services.authService, services.planService, services.projectService);
  registerTaskRoutes(app, services.authService, services.taskService);
  registerConversationRoutes(app, services.authService, services.conversationService);
  registerFileRoutes(app, services.authService, services.projectService, services.fileService, services.auditService);
  registerTemplateRoutes(app, services.authService, services.stepTemplateService);
  registerPersonalTaskRoutes(app, services.authService, services.personalTaskService);
  registerReminderRoutes(app, services.authService, services.reminderService);
  registerChatSettingsRoutes(app, services.authService, services.chatSettingsService);
  registerChatRoutes(app, services.authService, services.ollama, services.openRouter, services.conversationService, services.chatSettingsService, services.ollamaAgent, services.openRouterAgent, services.claudeCliProvider, services.codexCliProvider, services.tools, services.maxToolIterations);
  registerAgentRoutes(app, services.authService);
  registerLocalLlmRoutes(app, services.authService, services.conversationService, services.chatSettingsService, services.tools, services.maxToolIterations);
  registerOvermindRoutes(app, config, services.authService, services.overmindService, services.overmindNotify);

  return app;
}
