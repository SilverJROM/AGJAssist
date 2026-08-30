import path from "node:path";
import fs from "node:fs";
import { AppConfig } from "../config/config.js";
import { TmuxService } from "../tmux/tmux-service.js";
import { ProjectService } from "../services/project-service.js";
import { NoteService } from "../services/note-service.js";
import { AuthService } from "../auth/auth-service.js";
import { lokalaiLinkCodeStore } from "./lokalai-link-code-store.js";

const WEBSITES_ROOT = "/home/agjrom/websites";

interface UserState {
  cwd: string;
}

export class AssistantCore {
  private timeoutMinutes: number;
  private projectService: ProjectService | null = null;
  private noteService: NoteService | null = null;
  private authService: AuthService | null = null;
  private ownerUserId: number | null = null;

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

  /** Passthrough so the Telegram callback handler can resolve a web-login number-match. */
  resolveTgAuthChallenge(challengeId: string, selected: number): "verified" | "failed" | "expired" | "unknown" {
    if (!this.authService) return "unknown";
    return this.authService.resolveTgChallenge(challengeId, selected);
  }

  private getState(userId: number): UserState {
    if (!this.userState.has(userId)) {
      this.userState.set(userId, {
        cwd: WEBSITES_ROOT,
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
    if (!userId) return false;
    const ids = this.config.telegram.authorizedChatIds || [this.config.telegram.authorizedUserId];
    return ids.includes(userId);
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
          "/lokalai_link - generate a one-time code to link this Telegram account to lokalAI",
          "/app - open the web app",
          "/timeout [minutes] - show or set command timeout (default 60)",

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

      case "/lokalai_link": {
        if (!userId) return "Unable to determine your Telegram id.";
        // Re-check the permitted-target allowlist here too, rather than trusting
        // the caller's upstream isAuthorized() gate alone — this is the only
        // place that actually mints a code for a Telegram id.
        if (!this.isAuthorized(userId)) return "Unauthorized access.";
        const code = lokalaiLinkCodeStore.issue(userId);
        return `lokalAI link code: ${code}\nEnter this in lokalAI while signed in, within 5 minutes, to link this Telegram account.\nThis code is single-use.`;
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

    private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async handleText(input: string, userId?: number): Promise<string> {
    const trimmed = input.trim();
    const uid = userId || this.config.telegram.authorizedUserId;
    const state = this.getState(uid);

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
      state.cwd = newCwd;
      return `📂 ${newCwd}`;
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

    return "Unknown command. Use /help.";
  }

}
