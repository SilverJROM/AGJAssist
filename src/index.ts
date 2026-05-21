import { loadConfig } from "./config/config.js";
import { DatabaseService } from "./db/database.js";
import { OllamaProvider } from "./llm/ollama-provider.js";
import { OpenRouterProvider } from "./llm/openrouter-provider.js";
import { TmuxService } from "./tmux/tmux-service.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { ToolAgent } from "./orchestration/tool-agent.js";
import { AssistantCore } from "./bot/assistant-core.js";
import { TelegramAssistant } from "./bot/telegram-bot.js";
import { DefaultAgentCliRunner } from "./cli/agent-cli-runner.js";
import { AuthService } from "./auth/auth-service.js";
import { ProjectService } from "./services/project-service.js";
import { SafetyService } from "./services/safety-service.js";
import { AuditService } from "./services/audit-service.js";
import { TmuxStreamManager } from "./tmux/tmux-stream-manager.js";
import { DelegationService } from "./services/delegation-service.js";
import { NoteService } from "./services/note-service.js";
import { PlanService } from "./services/plan-service.js";
import { TaskService } from "./services/task-service.js";
import { ConversationService } from "./services/conversation-service.js";
import { FileService } from "./services/file-service.js";
import { StepTemplateService } from "./services/step-template-service.js";
import { PersonalTaskService } from "./services/personal-task-service.js";
import { ReminderService } from "./services/reminder-service.js";
import { ChatSettingsService } from "./services/chat-settings-service.js";
import { createApiServer } from "./api/server.js";
import { ClaudeCliProvider } from "./llm/claude-cli-provider.js";
import { CodexCliProvider } from "./llm/codex-cli-provider.js";
import { OvermindService } from "./services/overmind-service.js";
import { OvermindWatcher, POLL_MS } from "./services/overmind-watcher.js";

async function main(): Promise<void> {
  const config = loadConfig();

  // Database
  const db = new DatabaseService(config.db.path);
  db.ensureOwner(config.telegram.authorizedUserId);

  // Services
  const authService = new AuthService(
    db,
    config.telegram.botToken,
    config.api.jwtSecret,
    config.api.sessionExpiryHours
  );
  const projectService = new ProjectService(db, config.projects.root);
  const safetyService = new SafetyService(db);
  const auditService = new AuditService(db);

  // Scan projects on startup
  projectService.scanAndSync();

  // LLM providers
  const ollama = new OllamaProvider(
    config.llm.ollamaBaseUrl,
    config.llm.ollamaModel,
    config.llm.ollamaTimeoutMs
  );

  const openRouter = new OpenRouterProvider(
    config.llm.openrouterApiKey,
    config.llm.openrouterBaseUrl,
    config.llm.openrouterModel,
    config.llm.openrouterTimeoutMs
  );

  // Existing orchestration
  const tmuxService = new TmuxService();
  tmuxService.setSafetyService(safetyService);
  const tools = new ToolRegistry(config, tmuxService);
  const openRouterAgent = new ToolAgent(openRouter, tools, config.runtime.maxToolIterations);
  const ollamaToolAgent = new ToolAgent(ollama, tools, config.runtime.maxToolIterations);
  const agentCliRunner = new DefaultAgentCliRunner();

  const core = new AssistantCore(
    config,
    openRouterAgent,
    ollamaToolAgent,
    ollama,
    tmuxService,
    agentCliRunner
  );

  // Delegation & Workflow
  const delegationService = new DelegationService(db, auditService);
  const noteService = new NoteService(db, auditService);
  const planService = new PlanService(db, auditService);
  const taskService = new TaskService(db, auditService);
  const conversationService = new ConversationService(db, auditService);
  const fileService = new FileService();
  const stepTemplateService = new StepTemplateService(db, auditService);
  const personalTaskService = new PersonalTaskService(db, auditService);
  const reminderService = new ReminderService(db, auditService);
  const chatSettingsService = new ChatSettingsService(db);
  const overmindService = new OvermindService(db);
  const overmindWatcher = new OvermindWatcher(overmindService, tmuxService);

  // Seed default soul.md and context.md if not set
  if (!chatSettingsService.get("soul_md")) {
    chatSettingsService.set("soul_md", [
      "You are AGJAssist, a concise and practical server management assistant.",
      "You have access to tools: tmux sessions, log reading, and safe command execution.",
      "When the user asks you to check logs, sessions, or run commands, use your tools to do it.",
      "Keep responses SHORT and actionable. No lengthy reasoning or step-by-step thinking.",
      "Give direct answers. If you used a tool, summarize the result clearly.",
      "Do not explain what you would do — just do it using your tools."
    ].join("\n"));
  }
  if (!chatSettingsService.get("context_md")) {
    chatSettingsService.set("context_md", [
      "System context:",
      "- Server runs multiple projects managed via PM2 and tmux",
      "- Projects are in /home/agjrom/websites/ and /home/agjrom/TGBOTS/",
      "- You can list tmux sessions, peek at pane output, send commands, read logs, and run safe commands",
      "- Common PM2 apps: agjassist (port 3101), ehr-backend, ehr-frontend, hris-be, hris-fe, lokalbase-be, lokalbase-fe",
      "- Be concise. The user is a developer who wants quick answers."
    ].join("\n"));
  }

  // Wire services to bot core
  const ownerRow = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(config.telegram.authorizedUserId) as { id: number } | undefined;
  core.setServices(projectService, noteService, authService, ownerRow?.id || 1);
  const claudeCliProvider = new ClaudeCliProvider("sonnet", 180_000);
  const codexCliProvider = new CodexCliProvider(180_000);
  core.setChatServices(conversationService, chatSettingsService, claudeCliProvider, codexCliProvider);
  core.setOvermindService(overmindService);

  // Tmux streaming
  const tmuxStreamManager = new TmuxStreamManager(
    tmuxService,
    safetyService,
    authService,
    config.tmux.streamIntervalMs,
    config.tmux.outputBufferLines
  );

  // API Server
  const apiServer = await createApiServer(config, {
    authService,
    projectService,
    safetyService,
    auditService,
    tmuxService,
    tmuxStreamManager,
    db,
    delegationService,
    noteService,
    planService,
    taskService,
    conversationService,
    fileService,
    stepTemplateService,
    personalTaskService,
    reminderService,
    chatSettingsService,
    ollama,
    openRouter,
    ollamaAgent: ollamaToolAgent,
    openRouterAgent,
    tools,
    maxToolIterations: config.runtime.maxToolIterations,
    claudeCliProvider,
    codexCliProvider,
    overmindService
  });

  await apiServer.listen({ port: config.api.port, host: config.api.host });
  console.log(`AGJAssist API server listening on ${config.api.host}:${config.api.port}`);
  overmindWatcher.start();
  console.log(`Overmind watcher started (${Math.round(POLL_MS / 1000)}s)`);

  // Reminder scheduler — check every 60 seconds for due reminders
  setInterval(async () => {
    try {
      // New alert-based system
      const dueAlerts = reminderService.getDueAlerts();
      for (const { reminder, alert } of dueAlerts) {
        const label = `${alert.offset_value} ${alert.offset_unit} before`;
        const text = `[Reminder Alert] ${label}: ${reminder.title}${reminder.description ? "\n" + reminder.description : ""}\nEvent: ${reminder.event_date}`;
        try {
          const botUrl = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
          await fetch(botUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: config.telegram.authorizedUserId,
              text,
              parse_mode: "HTML"
            })
          });
        } catch {}
        reminderService.markAlertSent(alert.id);
      }

      // Legacy reminder_1/reminder_2 system (backward compat)
      const dueReminders = reminderService.getDueReminders();
      for (const { reminder, type } of dueReminders) {
        const label = type === "event" ? "EVENT NOW" : type === "reminder_1" ? "Reminder 1" : "Reminder 2";
        const text = `[Reminder] ${label}: ${reminder.title}${reminder.description ? "\n" + reminder.description : ""}\nEvent: ${reminder.event_date}`;
        try {
          const botUrl = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
          await fetch(botUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: config.telegram.authorizedUserId,
              text,
              parse_mode: "HTML"
            })
          });
        } catch {}
        reminderService.markSent(reminder.id, type);

        // Handle recurrence when event fires
        if (type === "event" && reminder.recurrence) {
          reminderService.advanceRecurrence(reminder.id);
        }
      }
    } catch {}

    // Auto-archive tasks and reminders
    try {
      const tasksArchived = personalTaskService.autoArchive();
      const remindersArchived = reminderService.autoArchiveReminders();
      if (tasksArchived > 0 || remindersArchived > 0) {
        console.log(`Auto-archived: ${tasksArchived} tasks, ${remindersArchived} reminders`);
      }
    } catch {}

    // Instance generation — ensure today's instances always exist
    try {
      const now = new Date();
      const manilaTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
      const manilaYear = manilaTime.getFullYear();
      const manilaMonth = String(manilaTime.getMonth() + 1).padStart(2, "0");
      const manilaDay = String(manilaTime.getDate()).padStart(2, "0");
      const today = `${manilaYear}-${manilaMonth}-${manilaDay}`;
      const ownerId = ownerRow?.id || 1;

      // Always generate daily instances if missing for today
      const dailyCount = personalTaskService.generateDailyInstances(ownerId, today);
      if (dailyCount > 0) {
        console.log(`Generated ${dailyCount} daily task instances for ${today}`);
      }

      // Always generate weekly instances if missing (target Saturday of this week)
      const dayOfWeek = manilaTime.getDay();
      const satDiff = dayOfWeek === 6 ? 0 : 6 - dayOfWeek;
      const satDate = new Date(manilaTime);
      satDate.setDate(satDate.getDate() + satDiff);
      const satYear = satDate.getFullYear();
      const satMonth = String(satDate.getMonth() + 1).padStart(2, "0");
      const satDay = String(satDate.getDate()).padStart(2, "0");
      const saturday = `${satYear}-${satMonth}-${satDay}`;
      const weeklyCount = personalTaskService.generateWeeklyInstances(ownerId, saturday);
      if (weeklyCount > 0) {
        console.log(`Generated ${weeklyCount} weekly task instances for ${saturday}`);
      }

      // Cleanup old instances at 2am only
      const manilaHour = manilaTime.getHours();
      const manilaMinute = manilaTime.getMinutes();
      if (manilaHour === 2 && manilaMinute === 0) {
        const cleaned = personalTaskService.cleanupOldInstances(3);
        if (cleaned > 0) {
          console.log(`Cleaned up ${cleaned} old task instances`);
        }
      }
    } catch (err) {
      console.error("Instance generation error:", err);
    }
  }, 60_000);

  if (config.telegram.testMode) {
    console.log("AGJAssist booted in TEST_MODE=true (Telegram polling not started)");
    return;
  }

  // Telegram bot
  const bot = new TelegramAssistant(config.telegram.botToken, core);
  await bot.start();
  console.log("AGJAssist Telegram bot started");
}

main().catch((error) => {
  const msg = error instanceof Error ? error.stack || error.message : String(error);
  console.error("Fatal startup error:", msg);
  process.exit(1);
});
