import path from "node:path";
import fs from "node:fs";
import { AppConfig } from "../config/config.js";
import { ClaudeCliProvider } from "../llm/claude-cli-provider.js";
import { CodexCliProvider } from "../llm/codex-cli-provider.js";
import { TmuxService } from "../tmux/tmux-service.js";
import { ProjectService } from "../services/project-service.js";
import { NoteService } from "../services/note-service.js";
import { ConversationService } from "../services/conversation-service.js";
import { ChatSettingsService } from "../services/chat-settings-service.js";
import { AuthService } from "../auth/auth-service.js";
import { OvermindService, OvermindWorkflow, OvermindWorkflowStatus } from "../services/overmind-service.js";
import type { OvmSessionManager } from "../services/ovm-session.js";

const WEBSITES_ROOT = "/home/agjrom/websites";
const OVERMIND_ACTIVE_STATUSES: OvermindWorkflowStatus[] = [
  "active",
  "working",
  "waiting_human",
  "awaiting_decision",
  "stuck",
  "paused"
];
const OVERMIND_STATUS_ICONS: Record<OvermindWorkflowStatus, string> = {
  active: "•",
  working: "▶",
  waiting_human: "⏸",
  awaiting_decision: "❓",
  stuck: "⚠",
  paused: "⏯",
  completed: "•",
  failed: "•"
};
const OVERMIND_TASK_GLYPHS = {
  done: "[x]",
  processing: "[~]",
  pending: "[ ]"
} as const;
const OVM_RELAY_FALLBACK = "OVM is taking a while / still working.";

interface UserState {
  cwd: string;
  activeConversationId: number | null;
  activeProvider: string | null;
  ovmChatMode: boolean;
}

export class AssistantCore {
  private timeoutMinutes: number;
  private projectService: ProjectService | null = null;
  private noteService: NoteService | null = null;
  private authService: AuthService | null = null;
  private ownerUserId: number | null = null;
  private conversationService: ConversationService | null = null;
  private chatSettingsService: ChatSettingsService | null = null;
  private claudeCliProvider: ClaudeCliProvider | null = null;
  private codexCliProvider: CodexCliProvider | null = null;
  private overmindService: OvermindService | null = null;
  private ovmSessionService: OvmSessionManager | null = null;

  // Per-user state for TG conversations
  private userState: Map<number, UserState> = new Map();

  constructor(
    private readonly config: AppConfig,
    private readonly tmuxService: TmuxService
  ) {
    this.timeoutMinutes = config.runtime.defaultTimeoutMinutes;
  }

  setServices(projectService: ProjectService, noteService: NoteService, authService: AuthService, ownerUserId: number): void {
    this.projectService = projectService;
    this.noteService = noteService;
    this.authService = authService;
    this.ownerUserId = ownerUserId;
  }

  setChatServices(
    conversationService: ConversationService,
    chatSettingsService: ChatSettingsService,
    claudeCliProvider: ClaudeCliProvider,
    codexCliProvider: CodexCliProvider
  ): void {
    this.conversationService = conversationService;
    this.chatSettingsService = chatSettingsService;
    this.claudeCliProvider = claudeCliProvider;
    this.codexCliProvider = codexCliProvider;
  }

  setOvermindService(overmindService: OvermindService): void {
    this.overmindService = overmindService;
  }

  setOvmSessionService(ovmSessionService: OvmSessionManager): void {
    this.ovmSessionService = ovmSessionService;
  }

  private getState(userId: number): UserState {
    if (!this.userState.has(userId)) {
      this.userState.set(userId, {
        cwd: WEBSITES_ROOT,
        activeConversationId: null,
        activeProvider: null,
        ovmChatMode: false
      });
    }
    return this.userState.get(userId)!;
  }

  private resolveCwd(dir: string, currentCwd: string): string {
    // "cd" alone goes back to WEBSITES_ROOT
    if (!dir) return WEBSITES_ROOT;
    const resolved = path.resolve(currentCwd, dir);
    // Must stay within WEBSITES_ROOT
    if (!resolved.startsWith(WEBSITES_ROOT)) return WEBSITES_ROOT;
    return resolved;
  }

  isAuthorized(userId?: number): boolean {
    return Boolean(userId) && userId === this.config.telegram.authorizedUserId;
  }

  async handleCommand(input: string, userId?: number): Promise<string> {
    const parts = input.trim().split(/\s+/);
    const command = (parts[0] || "").toLowerCase();
    const uid = userId || this.config.telegram.authorizedUserId;

    switch (command) {
      case "/start":
      case "/help":
        return [
          "AGJAssist Commands:",
          "/jobs or /tmux - list tmux jobs and pane targets",
          "/peek <session:window.pane> [lines] - inspect a pane",
          "/tmux_send <session:window.pane> <command> [--no-enter] - send headless command to pane",
          "/tmux_create <project> [name] - create tmux session for project",
          "/tmux_kill <session> - terminate tmux session",
          "/projects - list all projects",
          "/note <text> - create a quick note in Notes folder",
          "/notes - list recent notes from Notes folder",
          "/weblogin - generate a login code for the web app",
          "/app - open the web app",
          "/timeout [minutes] - show or set command timeout (default 60)",
          "/overmind - show active Overmind workflows",
          "/om_tasks <id> - show an Overmind workflow tasklist",
          "/om_pause <id> - pause Overmind checks (no interrupts while you talk to it)",
          "/om_resume <id> - resume Overmind checks",
          "/om_drop <id> - drop an Overmind workflow",
          "/ovm_start - enter OVM chat mode",
          "/ovm_end - exit OVM chat mode",
          "",
          "Directory commands:",
          "cd <dir> - change directory (within /home/agjrom/websites/)",
          "cd - return to /home/agjrom/websites/",
          "ls - list current directory",
          "pwd - show current directory"
        ].join("\n");

      case "/jobs":
      case "/tmux":
        return this.tmuxService.listJobsSummary();

      case "/peek": {
        const target = parts[1];
        const lines = Number(parts[2] || 200);
        if (!target) {
          return "Usage: /peek <session:window.pane> [lines]";
        }
        return this.tmuxService.peekPane(target, lines);
      }

      case "/tmux_send":
      case "/sendtmux": {
        const target = parts[1];
        if (!target) {
          return "Usage: /tmux_send <session:window.pane> <command> [--no-enter]";
        }

        const commandTextRaw = input.trim().split(/\s+/).slice(2).join(" ").trim();
        if (!commandTextRaw) {
          return "Usage: /tmux_send <session:window.pane> <command> [--no-enter]";
        }

        let pressEnter = true;
        let commandText = commandTextRaw;
        if (commandTextRaw.endsWith(" --no-enter")) {
          pressEnter = false;
          commandText = commandTextRaw.slice(0, -11).trim();
        }

        if (!commandText) {
          return "Usage: /tmux_send <session:window.pane> <command> [--no-enter]";
        }

        const result = await this.tmuxService.sendCommand(target, commandText, pressEnter);
        return result.message;
      }

      case "/timeout": {
        const minutesRaw = parts[1];
        if (!minutesRaw) {
          return `Current timeout: ${this.timeoutMinutes} minutes\\nUsage: /timeout <minutes>`;
        }
        const minutes = Number(minutesRaw);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 360) {
          return "Invalid timeout. Use an integer between 1 and 360 minutes.";
        }
        this.timeoutMinutes = minutes;
        return `Timeout updated: ${this.timeoutMinutes} minutes`;
      }

      case "/overmind":
        return this.handleOvermindStatusCommand();

      case "/om_tasks":
        return this.handleOvermindTasksCommand(parts[1]);

      case "/om_pause":
        return this.handleOvermindPauseMutation(parts[1], true);

      case "/om_resume":
        return this.handleOvermindPauseMutation(parts[1], false);

      case "/om_drop":
        return this.handleOvermindDropCommand(parts[1]);

      case "/ovm_start":
        return this.handleOvmStartCommand(uid);

      case "/ovm_end":
        return this.handleOvmEndCommand(uid);

      case "/tmux_create": {
        const projectName = parts[1];
        if (!projectName) return "Usage: /tmux_create <project> [name]";
        const sessionName = parts[2] || `agj-${projectName}`;
        try {
          const target = await this.tmuxService.createSession(
            sessionName,
            `${this.config.projects.root}/${projectName}`
          );
          return `Created tmux session: ${target}`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      case "/tmux_kill": {
        const session = parts[1];
        if (!session) return "Usage: /tmux_kill <session>";
        try {
          await this.tmuxService.terminateSession(session);
          return `Terminated session: ${session}`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      case "/projects": {
        if (!this.projectService) return "Project service not available.";
        const projects = this.projectService.list();
        if (!projects.length) return "No projects found.";
        return projects
          .map(
            (p) =>
              `- ${p.display_name || p.directory_name} | sessions=${p.tmux_session_count} notes=${p.open_notes_count} plans=${p.active_plans_count} tasks=${p.pending_tasks_count}`
          )
          .join("\n");
      }

      case "/note": {
        if (!this.noteService) return "Note service not available.";
        const noteText = parts.slice(1).join(" ").trim();
        if (!noteText) return "Usage: /note <text>";

        const folderId = this.noteService.defaultFolderId();
        const note = this.noteService.createNote(folderId, noteText, this.ownerUserId || 1);
        return `Note #${note.id} saved to Notes folder`;
      }

      case "/weblogin": {
        if (!this.authService) return "Auth service not available.";
        const hoursArg = Number(parts[1]);
        const validHours = [2, 4, 8, 16];
        const hours = validHours.includes(hoursArg) ? hoursArg : 4;
        const code = this.authService.generateLoginCode(this.config.telegram.authorizedUserId, hours);
        return `Login code: ${code}\nValid for: ${hours}h session\nExpires in 5 minutes.\n\nUsage: /weblogin [2|4|8|16]`;
      }

      case "/app":
        return "Open AGJAssist: https://agjasst.silverjrom.app";

      case "/notes": {
        if (!this.noteService) return "Note service not available.";

        const folderId = this.noteService.defaultFolderId();
        const notes = this.noteService.listByFolder(folderId);
        if (!notes.length) return "No notes in Notes folder";
        return notes
          .slice(0, 10)
          .map((n) => `#${n.id}${n.pinned ? " 📌" : ""} ${n.body.slice(0, 60)}`)
          .join("\n");
      }

      default:
        return "Unknown command. Use /help.";
    }
  }

  private handleOvermindStatusCommand(): string {
    if (!this.overmindService) return "Overmind service not available.";
    const workflows = this.overmindService
      .list()
      .filter((workflow) => OVERMIND_ACTIVE_STATUSES.includes(workflow.status));
    if (!workflows.length) return "No active workflows.";
    return workflows.map((workflow) => this.formatOvermindWorkflowLine(workflow)).join("\n");
  }

  private handleOvermindTasksCommand(rawId: string | undefined): string {
    const id = this.parseOvermindId(rawId, "/om_tasks <id>");
    if (typeof id === "string") return id;
    if (!this.overmindService) return "Overmind service not available.";
    const workflow = this.overmindService.get(id);
    if (!workflow) return `Workflow not found: ${id}`;

    const lines = [`${this.overmindDisplayName(workflow)} ${OVERMIND_STATUS_ICONS[workflow.status]} ${workflow.status}`];
    if (!workflow.tasks.length) {
      lines.push("No tasks.");
      return lines.join("\n");
    }

    lines.push(
      ...workflow.tasks.map((task) => `${OVERMIND_TASK_GLYPHS[task.state]} ${task.label}`)
    );
    return lines.join("\n");
  }

  // Pause/resume overmind's monitoring of a workflow (suppresses nudges/requests/brain
  // while JROM talks to the coordinator). Separate from status — the card stays visible.
  private handleOvermindPauseMutation(rawId: string | undefined, paused: boolean): string {
    const id = this.parseOvermindId(rawId, paused ? "/om_pause <id>" : "/om_resume <id>");
    if (typeof id === "string") return id;
    if (!this.overmindService) return "Overmind service not available.";
    const workflow = this.overmindService.setMonitoringPaused(id, paused, paused ? "jrom" : null);
    if (!workflow) return `Workflow not found: ${id}`;
    const name = this.overmindDisplayName(workflow);
    return paused
      ? `⏸ Paused overmind checks for ${id}: ${name}. I won't interrupt — /om_resume ${id} when done.`
      : `▶ Resumed overmind checks for ${id}: ${name}.`;
  }

  private handleOvermindDropCommand(rawId: string | undefined): string {
    const id = this.parseOvermindId(rawId, "/om_drop <id>");
    if (typeof id === "string") return id;
    if (!this.overmindService) return "Overmind service not available.";
    const workflow = this.overmindService.get(id);
    if (!workflow) return `Workflow not found: ${id}`;
    this.overmindService.delete(id);
    return `Dropped workflow ${id}: ${this.overmindDisplayName(workflow)}`;
  }

  private async handleOvmStartCommand(userId: number): Promise<string> {
    if (!this.ovmSessionService) return "OVM session service not available.";
    await this.ovmSessionService.open();
    this.getState(userId).ovmChatMode = true;
    return "OVM chat on - talk to me; /ovm_end to stop";
  }

  private handleOvmEndCommand(userId: number): string {
    this.getState(userId).ovmChatMode = false;
    return "OVM chat off.";
  }

  private formatOvermindWorkflowLine(workflow: OvermindWorkflow): string {
    const doneCount = workflow.tasks.filter((task) => task.state === "done").length;
    const currentTask = workflow.current_task || "—";
    return `${this.overmindDisplayName(workflow)} ${OVERMIND_STATUS_ICONS[workflow.status]} ${workflow.status} · "${currentTask}" · ${doneCount}/${workflow.tasks.length}`;
  }

  private overmindDisplayName(workflow: OvermindWorkflow): string {
    return workflow.display_name || workflow.label;
  }

  private parseOvermindId(rawId: string | undefined, usage: string): number | string {
    if (!rawId) return `Usage: ${usage}`;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 1) return `Usage: ${usage}`;
    return id;
  }

  private async relayOvmMessage(input: string): Promise<string> {
    if (!this.ovmSessionService) return "OVM session service not available.";

    try {
      const result = await this.ovmSessionService.sendAndAwaitReply(input);
      if (result.pending) return OVM_RELAY_FALLBACK;
      return result.reply || OVM_RELAY_FALLBACK;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `OVM relay error: ${message}`;
    }
  }

    private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async handleText(input: string, userId?: number): Promise<string> {
    const trimmed = input.trim();
    const uid = userId || this.config.telegram.authorizedUserId;
    const state = this.getState(uid);

    if (state.ovmChatMode) {
      return this.relayOvmMessage(trimmed);
    }

    // --- Directory commands ---
    if (/^cd(\s|$)/i.test(trimmed)) {
      const dir = trimmed.replace(/^cd\s*/i, "").trim();
      const newCwd = this.resolveCwd(dir, state.cwd);
      try {
        if (!fs.existsSync(newCwd) || !fs.statSync(newCwd).isDirectory()) {
          return `Directory not found: ${newCwd}`;
        }
      } catch {
        return `Directory not found: ${newCwd}`;
      }
      const oldCwd = state.cwd;
      state.cwd = newCwd;
      // Directory change resets active conversation
      if (oldCwd !== newCwd) {
        state.activeConversationId = null;
        state.activeProvider = null;
      }
      return `📂 ${newCwd}\n(new conversation will start on next message)`;
    }

    if (/^pwd$/i.test(trimmed)) {
      return `📂 ${state.cwd}`;
    }

    if (/^ls(\s|$)/i.test(trimmed)) {
      const dir = trimmed.replace(/^ls\s*/i, "").trim();
      const targetDir = dir ? this.resolveCwd(dir, state.cwd) : state.cwd;
      try {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        const formatted = entries
          .filter(e => !e.name.startsWith("."))
          .sort((a, b) => {
            // Directories first
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          })
          .map(e => e.isDirectory() ? `📁 ${e.name}/` : `  ${e.name}`)
          .slice(0, 50);
        return `📂 ${targetDir}\n${formatted.join("\n")}${entries.length > 50 ? "\n... and more" : ""}`;
      } catch {
        return `Cannot read directory: ${targetDir}`;
      }
    }

    // Not in OVM chat mode — return a short hint.
    return "Use /ovm_start to chat with OVM, or a slash command. /help for the list.";
  }

}
