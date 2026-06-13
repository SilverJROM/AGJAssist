import { loadConfig } from "./config/config.js";
import { DatabaseService } from "./db/database.js";
import { TmuxService } from "./tmux/tmux-service.js";
import { AssistantCore } from "./bot/assistant-core.js";
import { TelegramAssistant } from "./bot/telegram-bot.js";
import { AuthService } from "./auth/auth-service.js";
import { ProjectService } from "./services/project-service.js";
import { SafetyService } from "./services/safety-service.js";
import { AuditService } from "./services/audit-service.js";
import { TmuxStreamManager } from "./tmux/tmux-stream-manager.js";
import { DelegationService } from "./services/delegation-service.js";
import { NoteService } from "./services/note-service.js";
import { PlanService } from "./services/plan-service.js";
import { TaskService } from "./services/task-service.js";
import { FileService } from "./services/file-service.js";
import { StepTemplateService } from "./services/step-template-service.js";
import { PersonalTaskService } from "./services/personal-task-service.js";
import { ReminderService } from "./services/reminder-service.js";
import { createApiServer } from "./api/server.js";
import { OvermindService } from "./services/overmind-service.js";
import { OvermindWatcher, POLL_MS } from "./services/overmind-watcher.js";
import { SonnetOvermindBrain } from "./services/overmind-brain.js";
import { AppSettingsService } from "./services/app-settings-service.js";
import { NudgeStateService } from "./services/nudge-state-service.js";
import { OvermindStreamManager } from "./api/websocket/overmind-stream-manager.js";
import { AgentEventsStreamManager } from "./api/websocket/agent-events-stream-manager.js";
import { OvmSessionService } from "./services/ovm-session.js";
import { AgentAssignmentService } from "./services/agent-assignment-service.js";
import { AgentEventsService } from "./services/agent-events-service.js";
import { CoordinatorLaunchService } from "./services/coordinator-launch-service.js";
import { AgentWakeScheduler } from "./services/agent-wake-scheduler.js";
import {
  formatError,
  installTelegramProcessGuards,
  startTelegramNonFatal
} from "./startup/telegram-resilience.js";

installTelegramProcessGuards();

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

  // Tmux + orchestration
  const tmuxService = new TmuxService();
  tmuxService.setSafetyService(safetyService);

  const core = new AssistantCore(
    config,
    tmuxService
  );

  // Delegation & Workflow
  const delegationService = new DelegationService(db, auditService);
  const noteService = new NoteService(db, auditService);
  const planService = new PlanService(db, auditService);
  const taskService = new TaskService(db, auditService);
  const fileService = new FileService();
  const stepTemplateService = new StepTemplateService(db, auditService);
  const personalTaskService = new PersonalTaskService(db, auditService);
  const reminderService = new ReminderService(db, auditService);
  const agentAssignmentService = new AgentAssignmentService(db);
  const coordinatorLaunchService = new CoordinatorLaunchService(agentAssignmentService);
  const agentEventsService = new AgentEventsService(db);
  const agentEventsStreamManager = new AgentEventsStreamManager(authService, agentEventsService);
  agentEventsService.onEvent((event) => agentEventsStreamManager.broadcast(event));
  const agentWakeScheduler = new AgentWakeScheduler(db, tmuxService, agentEventsService);
  const overmindService = new OvermindService(db);
  const appSettingsService = new AppSettingsService();
  await appSettingsService.load();
  const nudgeStateService = new NudgeStateService();
  await nudgeStateService.load();
  const ovmSessionService = new OvmSessionService(tmuxService, {
    overmindToken: config.overmind.token
  });

  // Wire services to bot core
  const ownerRow = db.prepare("SELECT id FROM users WHERE telegram_id = ?").get(config.telegram.authorizedUserId) as { id: number } | undefined;
  core.setServices(projectService, noteService, authService, ownerRow?.id || 1);
  core.setOvermindService(overmindService);
  core.setOvmSessionService(ovmSessionService);
  const telegramAssistant = config.telegram.testMode
    ? null
    : new TelegramAssistant(config.telegram.botToken, core);
  const overmindNotify = async (text: string): Promise<void> => {
    if (!telegramAssistant) return;
    await telegramAssistant.sendMessage(config.telegram.authorizedUserId, text);
  };
  const overmindBrain = new SonnetOvermindBrain();
  const overmindStreamManager = new OvermindStreamManager(authService, overmindService);
  const overmindWatcher = new OvermindWatcher(
    overmindService,
    tmuxService,
    overmindNotify,
    overmindBrain,
    (workflows) => overmindStreamManager.broadcast(workflows),
    appSettingsService,
    nudgeStateService,
    agentWakeScheduler
  );

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
    fileService,
    stepTemplateService,
    personalTaskService,
    reminderService,
    agentAssignmentService,
    coordinatorLaunchService,
    overmindService,
    overmindNotify,
    overmindStreamManager,
    agentEventsStreamManager,
    ovmSessionService,
    appSettingsService,
    nudgeStateService
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

  await startTelegramNonFatal(telegramAssistant);
}

main().catch((error) => {
  console.error("Fatal startup error:", formatError(error));
  process.exit(1);
});
