import { execFile } from "node:child_process";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { promisify } from "node:util";
import { SafetyService, SafetyCheckResult } from "../services/safety-service.js";

const execFileAsync = promisify(execFile);

export interface TmuxPane {
  target: string;
  session: string;
  window: string;
  pane: string;
  command: string;
  title: string;
}

export interface SendCommandResult {
  message: string;
  safetyCheck?: SafetyCheckResult;
  blocked: boolean;
}

export class TmuxService {
  private safetyService: SafetyService | null = null;

  setSafetyService(safety: SafetyService): void {
    this.safetyService = safety;
  }

  async listPanes(): Promise<TmuxPane[]> {
    try {
      const format = "#{session_name}|#{window_index}|#{pane_index}|#{pane_current_command}|#{pane_title}";
      const { stdout } = await execFileAsync("tmux", ["list-panes", "-a", "-F", format]);

      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [session, window, pane, command, title] = line.split("|");
          return {
            target: `${session}:${window}.${pane}`,
            session,
            window,
            pane,
            command,
            title
          };
        });
    } catch {
      return [];
    }
  }

  async listJobsSummary(): Promise<string> {
    const panes = await this.listPanes();
    if (!panes.length) {
      return "No tmux panes found.";
    }

    return panes
      .map((p) => `- ${p.target} | cmd=${p.command} | title=${p.title || "n/a"}`)
      .join("\n");
  }

  async peekPane(target: string, lines = 200): Promise<string> {
    this.ensureValidTarget(target);
    const safeLines = Math.max(20, Math.min(lines, 1000));
    const { stdout } = await execFileAsync("tmux", [
      "capture-pane",
      "-p",
      "-t",
      target,
      "-S",
      `-${safeLines}`
    ]);
    return stdout.trim() || "<empty pane output>";
  }

  async sessionExists(target: string): Promise<boolean> {
    this.ensureValidTarget(target);
    const sessionName = target.split(":")[0];
    try {
      await execFileAsync("tmux", ["has-session", "-t", sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  async sendCommand(
    target: string,
    command: string,
    pressEnter = true,
    skipSafetyCheck = false
  ): Promise<SendCommandResult> {
    this.ensureValidTarget(target);
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error("Command is required");
    }
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
      throw new Error("Command contains unsupported control characters");
    }

    // Safety check
    if (!skipSafetyCheck && this.safetyService) {
      const check = this.safetyService.checkCommand(trimmed);
      if (check.blocked) {
        return {
          message: `Command blocked by safety pattern: ${check.pattern?.pattern}`,
          safetyCheck: check,
          blocked: true
        };
      }
    }

    await execFileAsync("tmux", ["send-keys", "-l", "-t", target, "--", trimmed]);
    if (pressEnter) {
      await execFileAsync("tmux", ["send-keys", "-t", target, "C-m"]);
    }
    return {
      message: `Sent command to ${target}${pressEnter ? " and pressed Enter" : ""}: ${trimmed}`,
      blocked: false
    };
  }

  // Send text literally then verify submission, re-pressing Enter up to 3 times total if
  // the TUI treats a long paste as "Pasted Content" and does not auto-submit on the first
  // C-m. Returns true when submitted (composer no longer holds the text), false after 3
  // attempts (still stuck). Best-effort: never throws.
  async sendAndSubmit(target: string, text: string): Promise<boolean> {
    try {
      this.ensureValidTarget(target);
      const trimmed = text.trim();
      if (!trimmed) return false;

      // Initial send: literal text + first Enter (two separate execFile calls).
      await execFileAsync("tmux", ["send-keys", "-l", "-t", target, "--", trimmed]);
      await execFileAsync("tmux", ["send-keys", "-t", target, "C-m"]);

      // Distinctive chunk used to detect the message still sitting in the composer.
      const chunk = trimmed.replace(/\s+/g, "").slice(0, 40);

      const MAX_PRESSES = 3;
      let pressCount = 1;

      while (pressCount < MAX_PRESSES) {
        await setTimeoutPromise(500);
        const pane = await this.capturePane(target);
        if (this.isTextSubmitted(pane, chunk)) {
          return true;
        }
        // Still un-submitted — press Enter again.
        await execFileAsync("tmux", ["send-keys", "-t", target, "C-m"]);
        pressCount += 1;
      }

      // Final check after the last press.
      await setTimeoutPromise(500);
      const pane = await this.capturePane(target);
      return this.isTextSubmitted(pane, chunk);
    } catch {
      return false;
    }
  }

  // Returns true when the text is no longer sitting un-submitted in the composer.
  // Un-submitted heuristic: a line starting with ❯ or › still contains `chunk`,
  // OR the pane shows a paste indicator.
  private isTextSubmitted(pane: string, chunk: string): boolean {
    const pasteIndicator = /\[Pasted Content|tab to queue/i.test(pane);
    if (pasteIndicator) return false;
    const lines = pane.replace(/\r\n/g, "\n").split("\n");
    // Find the last composer line (starts with ❯ or ›).
    let composerLine: string | undefined;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^[❯›]/u.test(lines[i].trimStart())) {
        composerLine = lines[i];
        break;
      }
    }
    if (!composerLine) return true;
    const composerChunk = composerLine.replace(/\s+/g, "");
    return !composerChunk.includes(chunk);
  }

  async sendEnter(target: string): Promise<SendCommandResult> {
    this.ensureValidTarget(target);
    await execFileAsync("tmux", ["send-keys", "-t", target, "C-m"]);
    return {
      message: `Sent Enter to ${target}`,
      blocked: false
    };
  }

  async createSession(name: string, cwd?: string): Promise<string> {
    this.ensureValidSessionName(name);
    const args = ["new-session", "-d", "-s", name];
    if (cwd) {
      args.push("-c", cwd);
    }
    await execFileAsync("tmux", args);
    return `${name}:0.0`;
  }

  async createPane(sessionTarget: string, cwd?: string): Promise<string> {
    // sessionTarget can be "session:window" or "session:window.pane"
    const args = ["split-window", "-t", sessionTarget];
    if (cwd) {
      args.push("-c", cwd);
    }
    await execFileAsync("tmux", args);

    // Get the new pane target
    const panes = await this.listPanes();
    const sessionName = sessionTarget.split(":")[0];
    const sessionPanes = panes.filter((p) => p.session === sessionName);
    const last = sessionPanes[sessionPanes.length - 1];
    return last?.target || sessionTarget;
  }

  async terminateSession(sessionName: string): Promise<void> {
    this.ensureValidSessionName(sessionName);
    await execFileAsync("tmux", ["kill-session", "-t", sessionName]);
  }

  async terminatePane(target: string): Promise<void> {
    this.ensureValidTarget(target);
    await execFileAsync("tmux", ["kill-pane", "-t", target]);
  }

  async capturePane(target: string, lines = 200): Promise<string> {
    this.ensureValidTarget(target);
    const safeLines = Math.max(20, Math.min(lines, 5000));
    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-p",
        "-e",
        "-t",
        target,
        "-S",
        `-${safeLines}`
      ]);
      // Convert \n to \r\n for xterm.js
      return stdout.replace(/\n/g, "\r\n");
    } catch {
      return "";
    }
  }

  // Current working directory of a session's active pane. Used to resolve a coordinator's
  // relative run_dir (registered relative to ITS cwd, not ours). Returns null if unknown.
  async paneCurrentPath(session: string): Promise<string | null> {
    this.ensureValidTarget(session);
    try {
      const { stdout } = await execFileAsync("tmux", [
        "display-message",
        "-p",
        "-t",
        session,
        "#{pane_current_path}"
      ]);
      const dir = stdout.trim();
      return dir || null;
    } catch {
      return null;
    }
  }

  ensureValidTarget(target: string): void {
    const bareSession = /^[a-zA-Z0-9_.-]+$/.test(target);
    const paneTarget = /^[a-zA-Z0-9_.-]+:[0-9]+\.[0-9]+$/.test(target);
    if (!bareSession && !paneTarget) {
      throw new Error("Invalid tmux target. Use format session or session:window.pane");
    }
  }

  private ensureValidSessionName(name: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      throw new Error("Invalid session name. Use alphanumeric, underscore, dot, or dash only.");
    }
  }
}
