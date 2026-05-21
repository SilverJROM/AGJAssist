import path from "node:path";
import fs from "node:fs";
import { AppConfig } from "../config/config.js";
import { LlmProvider } from "../llm/base-provider.js";
import { OllamaProvider } from "../llm/ollama-provider.js";
import { ClaudeCliProvider } from "../llm/claude-cli-provider.js";
import { CodexCliProvider } from "../llm/codex-cli-provider.js";
import { ToolAgent } from "../orchestration/tool-agent.js";
import { TmuxService } from "../tmux/tmux-service.js";
import { AgentCliRunner } from "../cli/agent-cli-runner.js";
import { ProjectService } from "../services/project-service.js";
import { NoteService } from "../services/note-service.js";
import { ConversationService } from "../services/conversation-service.js";
import { ChatSettingsService } from "../services/chat-settings-service.js";
import { AuthService } from "../auth/auth-service.js";
import { OvermindService, OvermindWorkflow, OvermindWorkflowStatus } from "../services/overmind-service.js";
import type { OvmSessionManager } from "../services/ovm-session.js";

const ALLOWED_OM_MODELS = new Set(["qwek32k:latest", "granite4:64k"]);
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
const OVM_SESSION_TARGET = "OVM";
const OVM_RELAY_TIMEOUT_MS = 12_000;
const OVM_RELAY_POLL_MS = 700;
const OVM_RELAY_STABLE_READS = 2;
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
    private readonly openRouterAgent: ToolAgent,
    private readonly ollamaToolAgent: ToolAgent,
    private readonly ollamaProvider: OllamaProvider,
    private readonly tmuxService: TmuxService,
    private readonly agentCliRunner: AgentCliRunner
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
          "/note <project> <text> - create a quick note",
          "/notes <project> - list recent notes",
          "/weblogin - generate a login code for the web app",
          "/app - open the web app",
          "/llm - show LLM routing info",
          "/timeout [minutes] - show or set command timeout (default 60)",
          "/ommodel [qwek32k:latest|granite4:64k] - show or set OM model",
          "/overmind - show active Overmind workflows",
          "/om_tasks <id> - show an Overmind workflow tasklist",
          "/om_pause <id> - pause an Overmind workflow",
          "/om_resume <id> - resume an Overmind workflow",
          "/om_drop <id> - drop an Overmind workflow",
          "/ovm_start - enter OVM chat mode",
          "/ovm_end - exit OVM chat mode",
          "",
          "Chat commands:",
          "new haiku|sonnet|opus|codex <prompt> - start new conversation",
          "cont haiku|sonnet|opus|codex <prompt> - continue last conversation",
          "haiku|sonnet|opus|claude|codex <prompt> - auto (continues if active)",
          "",
          "Directory commands:",
          "cd <dir> - change directory (within /home/agjrom/websites/)",
          "cd - return to /home/agjrom/websites/",
          "ls - list current directory",
          "pwd - show current directory",
          "",
          "Tool agent modes:",
          "op <prompt> - OpenRouter + tools",
          "om <prompt> - Ollama + tools"
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

      case "/llm":
        return [
          `OpenRouter model: ${this.config.llm.openrouterModel}`,
          `Ollama chat model: ${this.ollamaProvider.getModel()}`,
          `OM tool models: ${Array.from(ALLOWED_OM_MODELS).join(", ")}`,
          `Current timeout: ${this.timeoutMinutes} minutes`,
          "Headless prefixes: new/cont haiku|sonnet|opus|codex",
          "Prefix with 'op ' to force OpenRouter + tools",
          "Prefix with 'om ' to force Ollama + tools"
        ].join("\n");

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

      case "/ommodel":
      case "/om_model": {
        const requested = parts[1];
        if (!requested) {
          return [
            `Current OM model: ${this.ollamaProvider.getModel()}`,
            `Allowed: ${Array.from(ALLOWED_OM_MODELS).join(", ")}`,
            "Usage: /ommodel <qwek32k:latest|granite4:64k>"
          ].join("\n");
        }

        if (!ALLOWED_OM_MODELS.has(requested)) {
          return `Invalid OM model. Allowed: ${Array.from(ALLOWED_OM_MODELS).join(", ")}`;
        }

        this.ollamaProvider.setModel(requested);
        return `OM model updated to: ${requested}`;
      }

      case "/overmind":
        return this.handleOvermindStatusCommand();

      case "/om_tasks":
        return this.handleOvermindTasksCommand(parts[1]);

      case "/om_pause":
        return this.handleOvermindStatusMutation(parts[1], "paused", "Paused");

      case "/om_resume":
        return this.handleOvermindStatusMutation(parts[1], "active", "Resumed");

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
        if (!this.noteService || !this.projectService) return "Note service not available.";
        const projectName = parts[1];
        if (!projectName) return "Usage: /note <project> <text>";
        const noteText = parts.slice(2).join(" ").trim();
        if (!noteText) return "Usage: /note <project> <text>";

        const project = this.projectService.getByName(projectName);
        if (!project) return `Project not found: ${projectName}`;

        const note = this.noteService.create(noteText, this.ownerUserId || 1, project.id);
        return `Note #${note.id} created on ${projectName}`;
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
        if (!this.noteService || !this.projectService) return "Note service not available.";
        const projectName = parts[1];
        if (!projectName) return "Usage: /notes <project>";

        const project = this.projectService.getByName(projectName);
        if (!project) return `Project not found: ${projectName}`;

        const notes = this.noteService.list(project.id, "open");
        if (!notes.length) return `No open notes for ${projectName}`;
        return notes
          .slice(0, 10)
          .map((n) => `#${n.id} [${n.status}] ${n.title || n.body.slice(0, 60)}`)
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

  private handleOvermindStatusMutation(
    rawId: string | undefined,
    status: OvermindWorkflowStatus,
    action: string
  ): string {
    const id = this.parseOvermindId(rawId, status === "paused" ? "/om_pause <id>" : "/om_resume <id>");
    if (typeof id === "string") return id;
    if (!this.overmindService) return "Overmind service not available.";
    const workflow = this.overmindService.setStatus(id, status);
    if (!workflow) return `Workflow not found: ${id}`;
    return `${action} workflow ${id}: ${this.overmindDisplayName(workflow)}`;
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
      await this.ovmSessionService.open();
      const before = await this.tmuxService.capturePane(OVM_SESSION_TARGET, 500);
      await this.tmuxService.sendCommand(OVM_SESSION_TARGET, input, true, true);
      const reply = await this.captureOvmReply(before, input);
      return reply || OVM_RELAY_FALLBACK;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `OVM relay error: ${message}`;
    }
  }

  private async captureOvmReply(before: string, input: string): Promise<string> {
    const deadline = Date.now() + OVM_RELAY_TIMEOUT_MS;
    let latest = before;
    let changed = false;
    let stableReads = 0;
    let bestReply = "";

    while (Date.now() < deadline) {
      await this.sleep(OVM_RELAY_POLL_MS);
      const current = await this.tmuxService.capturePane(OVM_SESSION_TARGET, 500);
      if (current !== latest) {
        latest = current;
        changed = true;
        stableReads = 0;
        bestReply = this.extractOvmReply(this.diffTerminalOutput(before, latest), input) || bestReply;
        continue;
      }

      if (changed) {
        stableReads += 1;
        bestReply = this.extractOvmReply(this.diffTerminalOutput(before, latest), input) || bestReply;
        if (stableReads >= OVM_RELAY_STABLE_READS) break;
      }
    }

    return bestReply;
  }

  private extractOvmReply(diff: string, input: string): string {
    const cleanInput = input.trim();
    const lines = this.stripAnsi(diff)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && line !== cleanInput)
      .filter((line) => !this.isOvmChromeLine(line));

    return lines.join("\n").trim();
  }

  private isOvmChromeLine(line: string): boolean {
    return (
      /^[╭╰│]/.test(line) ||
      /^>\s*$/.test(line) ||
      /^esc to interrupt/i.test(line) ||
      /^\? for shortcuts/i.test(line) ||
      /^cwd:/i.test(line) ||
      /^claude\b/i.test(line)
    );
  }

  private diffTerminalOutput(beforeText: string, afterText: string): string {
    const before = this.normalizeTerminalOutput(this.stripAnsi(beforeText));
    const after = this.normalizeTerminalOutput(this.stripAnsi(afterText));
    if (!after) return "";
    if (!before) return after;
    if (after === before) return "";
    if (after.startsWith(before)) return after.slice(before.length).trim();

    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    let idx = 0;
    while (idx < beforeLines.length && idx < afterLines.length && beforeLines[idx] === afterLines[idx]) {
      idx += 1;
    }
    return afterLines.slice(idx).join("\n").trim();
  }

  private normalizeTerminalOutput(text: string): string {
    return (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  private stripAnsi(text: string): string {
    return (text || "")
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async handleText(input: string, userId?: number): Promise<string> {
    const trimmed = input.trim();
    const timeoutMs = this.timeoutMinutes * 60 * 1000;
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

    // --- new/cont conversation commands ---
    const newMatch = trimmed.match(/^new\s+(haiku|sonnet|opus|claude|codex)\s+(.+)/is);
    if (newMatch) {
      const provider = newMatch[1].toLowerCase();
      const prompt = newMatch[2].trim();
      return this.handleConversationChat(uid, provider, prompt, true, timeoutMs);
    }

    const contMatch = trimmed.match(/^cont\s+(haiku|sonnet|opus|claude|codex)\s+(.+)/is);
    if (contMatch) {
      const provider = contMatch[1].toLowerCase();
      const prompt = contMatch[2].trim();
      return this.handleConversationChat(uid, provider, prompt, false, timeoutMs);
    }

    // --- Existing CLI prefixes (auto-continue if active conversation matches) ---
    if (/^claude\b/i.test(trimmed)) {
      const prompt = trimmed.replace(/^claude\b[\s,:-]*/i, "").trim();
      if (!prompt) return "Usage: claude <prompt>";
      return this.handleConversationChat(uid, "claude", prompt, false, timeoutMs);
    }

    if (/^opus\b/i.test(trimmed)) {
      const prompt = trimmed.replace(/^opus\b[\s,:-]*/i, "").trim();
      if (!prompt) return "Usage: opus <prompt>";
      return this.handleConversationChat(uid, "opus", prompt, false, timeoutMs);
    }

    if (/^sonnet\b/i.test(trimmed)) {
      const prompt = trimmed.replace(/^sonnet\b[\s,:-]*/i, "").trim();
      if (!prompt) return "Usage: sonnet <prompt>";
      return this.handleConversationChat(uid, "sonnet", prompt, false, timeoutMs);
    }

    if (/^haiku\b/i.test(trimmed)) {
      const prompt = trimmed.replace(/^haiku\b[\s,:-]*/i, "").trim();
      if (!prompt) return "Usage: haiku <prompt>";
      return this.handleConversationChat(uid, "haiku", prompt, false, timeoutMs);
    }

    if (/^codex\b/i.test(trimmed)) {
      const prompt = trimmed.replace(/^codex\b[\s,:-]*/i, "").trim();
      if (!prompt) return "Usage: codex <prompt>";
      return this.handleConversationChat(uid, "codex", prompt, false, timeoutMs);
    }

    if (/^op\b/i.test(trimmed)) {
      const prompt = trimmed.replace(/^op\b[\s,:-]*/i, "").trim();
      if (!prompt) {
        return "Usage: op <your request>";
      }
      return this.openRouterAgent.run(prompt);
    }

    if (/^om\b/i.test(trimmed)) {
      const prompt = trimmed.replace(/^om\b[\s,:-]*/i, "").trim();
      if (!prompt) {
        return "Usage: om <your request>";
      }
      return this.ollamaToolAgent.run(prompt);
    }

    // Default simple local chat path.
    return this.ollamaProvider.chat([
      {
        role: "system",
        content: "You are AGJAssist local helper. Keep responses short and practical."
      },
      { role: "user", content: trimmed }
    ], 600);
  }

  private async handleConversationChat(
    userId: number,
    provider: string,
    prompt: string,
    forceNew: boolean,
    timeoutMs: number
  ): Promise<string> {
    if (!this.conversationService || !this.chatSettingsService) {
      // Fallback: no conversation service, use stateless CLI
      return this.statelessCliChat(provider, prompt, timeoutMs);
    }

    const state = this.getState(userId);
    const dbUserId = this.ownerUserId || 1;

    // Normalize provider name for agent_name
    const agentName = provider === "claude" ? "claude" : (["haiku", "sonnet", "opus"].includes(provider) ? "claude" : "codex");
    const model = ["haiku", "sonnet", "opus"].includes(provider) ? provider : undefined;

    // Determine if we should continue or start new
    let convId = state.activeConversationId;
    let isNew = forceNew;

    if (!forceNew && convId) {
      // Check if the conversation still exists and matches provider
      const existing = this.conversationService.getById(convId);
      if (!existing || existing.agent_name !== agentName) {
        isNew = true;
      }
    } else if (!forceNew && !convId) {
      isNew = true;
    }

    if (isNew) {
      const conv = this.conversationService.create(agentName, dbUserId);
      convId = conv.id;
      this.conversationService.setCwd(convId, state.cwd);
      state.activeConversationId = convId;
      state.activeProvider = provider;
    }

    // Save user message
    this.conversationService.addMessage(convId!, {
      role: "user",
      content: prompt,
      timestamp: new Date().toISOString()
    }, dbUserId);

    // Build history
    const conversation = this.conversationService.getById(convId!);
    if (!conversation) return "Error: conversation not found after creation";

    const history = conversation.messages
      .filter(msg => (msg.role === "user" || msg.role === "assistant") && !msg.content.startsWith("Error:"))
      .slice(-20);

    const soulMd = this.chatSettingsService.get("soul_md") || "";
    const contextMd = this.chatSettingsService.get("context_md") || "";

    try {
      let responseText: string;

      if (agentName === "claude" && this.claudeCliProvider) {
        if (model) this.claudeCliProvider.setModel(model);
        const existingSessionId = this.conversationService.getCliSessionId(convId!);
        const result = await this.claudeCliProvider.chatWithSession(
          [
            { role: "system", content: [soulMd, contextMd].filter(Boolean).join("\n\n") || "Be concise." },
            ...history.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
          ],
          undefined,
          existingSessionId || undefined,
          state.cwd
        );
        responseText = result.content;
        if (result.sessionId) {
          this.conversationService.setCliSessionId(convId!, result.sessionId);
        }
      } else if (agentName === "codex" && this.codexCliProvider) {
        const existingSessionId = this.conversationService.getCliSessionId(convId!);
        const result = await this.codexCliProvider.chatWithSession(
          [
            { role: "system", content: [soulMd, contextMd].filter(Boolean).join("\n\n") || "Be concise." },
            ...history.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
          ],
          undefined,
          existingSessionId || undefined,
          state.cwd
        );
        responseText = result.content;
        if (result.sessionId) {
          this.conversationService.setCliSessionId(convId!, result.sessionId);
        }
      } else {
        // Fallback to stateless
        return this.statelessCliChat(provider, prompt, timeoutMs);
      }

      // Clean and save assistant response
      const cleanResponse = responseText.replace(/<ACTION>[\s\S]*?<\/ACTION>/g, "").trim();
      this.conversationService.addMessage(convId!, {
        role: "assistant",
        content: cleanResponse,
        timestamp: new Date().toISOString()
      }, dbUserId);

      const prefix = isNew ? `🆕 Conv #${convId} | 📂 ${state.cwd}\n\n` : `💬 Conv #${convId}\n\n`;
      return prefix + cleanResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.conversationService.addMessage(convId!, {
        role: "system",
        content: `Error: ${errorMessage}`,
        timestamp: new Date().toISOString()
      }, dbUserId);
      return `Error: ${errorMessage}`;
    }
  }

  private async statelessCliChat(provider: string, prompt: string, timeoutMs: number): Promise<string> {
    const model = ["haiku", "sonnet", "opus"].includes(provider) ? provider as "haiku" | "sonnet" | "opus" : undefined;
    if (provider === "codex") {
      return this.agentCliRunner.runCodex(prompt, { timeoutMs });
    }
    return this.agentCliRunner.runClaude(prompt, { model, timeoutMs });
  }
}
