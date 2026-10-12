import { execFile } from "node:child_process";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import { promisify } from "node:util";
import { SafetyService, SafetyCheckResult } from "../services/safety-service.js";

const execFileAsync = promisify(execFile);

// Remote tmux hosts (ssh aliases, e.g. "140") whose sessions the app also shows.
// A remote pane's target is "<host>~<session>:<window>.<pane>"; every tmux call
// for it runs over one multiplexed ssh connection to that host.
const REMOTE_SEP = "~";
const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=4",
  "-o", "ControlMaster=auto",
  "-o", "ControlPath=/tmp/agj-tmux-ssh-%r@%h:%p",
  "-o", "ControlPersist=10m"
];
const REMOTE_TIMEOUT_MS = 15000;
// After an unreachable host fails a listing, skip it this long so the session
// list (polled every few seconds) doesn't stall on the ssh connect timeout.
const REMOTE_DOWN_BACKOFF_MS = 30000;

function parseRemoteHosts(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => /^[a-zA-Z0-9_.-]+$/.test(h));
}

function shQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// Coordinator-message submit tuning. A modern TUI composer (Claude Code / codex)
// ingests a bracketed paste ASYNCHRONOUSLY: the text is not in the composer the
// instant `send-keys -l` returns. So we must (1) wait for the paste to actually
// render before pressing Enter — an Enter into a still-empty composer is swallowed
// and the text then drops in un-submitted — and (2) never conclude "submitted" off
// an empty composer we never saw hold the text (that false-positive is what made
// nudges pile up un-sent). See sendAndSubmit.
const COMPOSER_POLL_MS = 120;
const COMPOSER_RENDER_MAX_POLLS = 16; // ~2s ceiling waiting for the paste to land
const SUBMIT_VERIFY_DELAY_MS = 400;
const SUBMIT_MAX_PRESSES = 4;

export interface TmuxPane {
  target: string;
  session: string;
  window: string;
  pane: string;
  command: string;
  title: string;
  activity?: number;
  // True when the pane is on the alternate screen — i.e. a full-screen TUI
  // (grok, some codex TUIs). The friendly chat parser can't handle those, so
  // the UI renders them raw instead.
  alternate_on: boolean;
}

export interface SendCommandResult {
  message: string;
  safetyCheck?: SafetyCheckResult;
  blocked: boolean;
}

export const TMUX_NAMED_KEYS = new Set([
  "Up",
  "Down",
  "Left",
  "Right",
  "Enter",
  "Escape",
  "Space",
  "Tab",
  "BTab",
  "C-c",
  "C-u",
  "BSpace",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "y",
  "n"
]);

export class TmuxService {
  private safetyService: SafetyService | null = null;
  readonly remoteHosts: string[];
  private remoteDownUntil = new Map<string, number>();

  constructor(remoteHosts: string[] = parseRemoteHosts(process.env.TMUX_REMOTE_HOSTS)) {
    this.remoteHosts = remoteHosts;
  }

  // Split "<host>~<rest>" into its remote host and local tmux target. A target
  // without a known host prefix is local.
  splitHost(target: string): { host: string | null; local: string } {
    const i = target.indexOf(REMOTE_SEP);
    if (i > 0 && this.remoteHosts.includes(target.slice(0, i))) {
      return { host: target.slice(0, i), local: target.slice(i + 1) };
    }
    return { host: null, local: target };
  }

  isRemote(target: string): boolean {
    return this.splitHost(target).host !== null;
  }

  // Run a tmux command locally, or over ssh when its -t/-s target carries a
  // remote host prefix (the prefix is stripped before tmux sees it).
  private exec(args: string[], host: string | null = null): Promise<{ stdout: string; stderr: string }> {
    const out = [...args];
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === "--") break;
      if (out[i] === "-t" || out[i] === "-s") {
        const split = this.splitHost(out[i + 1]);
        if (split.host) {
          host = split.host;
          out[i + 1] = split.local;
        }
      }
    }
    if (!host) return execFileAsync("tmux", out);
    const remoteCmd = ["tmux", ...out].map(shQuote).join(" ");
    return execFileAsync("ssh", [...SSH_OPTS, host, remoteCmd], { timeout: REMOTE_TIMEOUT_MS });
  }

  // Raw keystrokes from the terminal WebSocket (may include newlines).
  async sendRawInput(target: string, input: string): Promise<void> {
    this.ensureValidTarget(target);
    await this.exec(["send-keys", "-t", target, "--", input]);
  }

  private async listPanesOn(host: string | null): Promise<TmuxPane[]> {
    const prefix = host ? `${host}${REMOTE_SEP}` : "";
    if (host && (this.remoteDownUntil.get(host) ?? 0) > Date.now()) return [];
    try {
      const format = "#{session_name}|#{window_index}|#{pane_index}|#{pane_current_command}|#{pane_title}|#{window_activity}|#{session_activity}|#{alternate_on}";
      const { stdout } = await this.exec(["list-panes", "-a", "-F", format], host);

      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [bareSession, window, pane, command, title, windowActivity, sessionActivity, alternateOn] = line.split("|");
          const session = prefix + bareSession;
          const activity = Number(windowActivity || sessionActivity || 0);
          return {
            target: `${session}:${window}.${pane}`,
            session,
            window,
            pane,
            command,
            title,
            activity: Number.isFinite(activity) ? activity : 0,
            alternate_on: alternateOn === "1"
          };
        });
    } catch (error) {
      // ssh exits 255 when it can't reach the host; tmux's own "no server
      // running" exits 1 and just means there are no sessions there.
      if (host && (error as { code?: number }).code === 255) {
        this.remoteDownUntil.set(host, Date.now() + REMOTE_DOWN_BACKOFF_MS);
      }
      return [];
    }
  }

  setSafetyService(safety: SafetyService): void {
    this.safetyService = safety;
  }

  async listPanes(): Promise<TmuxPane[]> {
    const lists = await Promise.all([null, ...this.remoteHosts].map((h) => this.listPanesOn(h)));
    return lists.flat();
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
    // Friendly /output path: allow a 2000-row window so the ❯ user run stays
    // in-frame. Do not raise this to capturePane's 5000-row scrollback cap.
    const safeLines = Math.max(20, Math.min(lines, 2000));
    const { stdout } = await this.exec([
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
      await this.exec(["has-session", "-t", sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  // If the pane is in tmux copy-mode (the user scrolled up to read), a plain
  // send-keys is interpreted as COPY-MODE COMMANDS (e.g. 'f' → "jump to forward")
  // instead of typed into Claude's composer, so the message silently never sends
  // (JROM). Exit copy-mode first so input lands in the live prompt.
  private async exitCopyMode(target: string): Promise<void> {
    try {
      const { stdout } = await this.exec([
        "display-message", "-p", "-t", target, "#{pane_in_mode}"
      ]);
      if (stdout.trim() === "1") {
        await this.exec(["send-keys", "-X", "-t", target, "cancel"]);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    } catch {
      /* non-fatal: if we can't check, proceed with the send */
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

    await this.exitCopyMode(target);
    await this.exec(["send-keys", "-l", "-t", target, "--", trimmed]);
    if (pressEnter) {
      // Let Claude's Ink composer fully ingest the typed text BEFORE Enter, or the
      // Enter races ahead and the message sits pending/unsubmitted (JROM). A short
      // settle (~0.35s, a touch longer for very long messages) submits reliably.
      const settleMs = Math.min(600, 350 + Math.floor(trimmed.length / 200) * 100);
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      await this.exec(["send-keys", "-t", target, "C-m"]);
    }
    return {
      message: `Sent command to ${target}${pressEnter ? " and pressed Enter" : ""}: ${trimmed}`,
      blocked: false
    };
  }

  // Reliably paste a message into a coordinator/agent TUI composer and submit it.
  //
  // The bug this fixes: the previous version sent the literal text and an Enter
  // back-to-back. But a TUI ingests a bracketed paste asynchronously, so that first
  // Enter routinely fired into a still-empty composer and was swallowed; the text
  // then landed un-submitted. Worse, a verify that ran in that window saw an empty
  // composer and FALSELY reported "submitted", so the retry loop gave up and the
  // message just piled up in the parent's command line, never sent.
  //
  // The fix is two-phase:
  //   1. Paste the literal text, then POLL until it has actually rendered in the
  //      composer (or shows a "[Pasted Content]" blob) before touching Enter.
  //   2. Only then press Enter, verifying the composer cleared after each press and
  //      re-pressing up to SUBMIT_MAX_PRESSES (a long paste can collapse into a blob
  //      that needs an extra Enter to expand+submit).
  // Returns true once the composer no longer holds the text. Best-effort: never throws.
  async sendAndSubmit(target: string, text: string): Promise<boolean> {
    try {
      this.ensureValidTarget(target);
      const trimmed = text.trim();
      if (!trimmed) return false;

      // Distinctive chunk used to detect the message in / gone from the composer.
      const chunk = trimmed.replace(/\s+/g, "").slice(0, 40);

      // Phase 1: paste the literal text, then wait for it to actually render.
      await this.exec(["send-keys", "-l", "-t", target, "--", trimmed]);
      for (let poll = 0; poll < COMPOSER_RENDER_MAX_POLLS; poll++) {
        await setTimeoutPromise(COMPOSER_POLL_MS);
        const pane = await this.capturePane(target);
        // Composer is "holding" our text when it is NOT in a submitted/empty state.
        if (!this.isTextSubmitted(pane, chunk)) break;
        // Else the paste hasn't landed yet (or capture noise) — keep polling. Do NOT
        // press Enter into an empty composer.
      }

      // Phase 2: submit, then verify the composer cleared; re-press if it didn't.
      for (let press = 0; press < SUBMIT_MAX_PRESSES; press++) {
        await this.exec(["send-keys", "-t", target, "C-m"]);
        await setTimeoutPromise(SUBMIT_VERIFY_DELAY_MS);
        const pane = await this.capturePane(target);
        if (this.isTextSubmitted(pane, chunk)) return true;
      }

      return this.isTextSubmitted(await this.capturePane(target), chunk);
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
    await this.exitCopyMode(target);
    await this.exec(["send-keys", "-t", target, "C-m"]);
    return {
      message: `Sent Enter to ${target}`,
      blocked: false
    };
  }

  // Send named control keys (arrows, Enter, Escape, etc.) to a pane so the chat
  // UI can drive interactive selections without the raw-terminal WebSocket. Only
  // an allowlisted set is accepted — these are tmux key NAMES (not raw bytes), so
  // there is no shell/command injection surface and no control-char problem.
  async sendNamedKeys(target: string, keys: string[]): Promise<SendCommandResult> {
    this.ensureValidTarget(target);
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error("keys is required");
    }
    if (keys.length > 64) {
      throw new Error("too many keys");
    }
    for (const k of keys) {
      if (!TMUX_NAMED_KEYS.has(k)) {
        throw new Error(`unsupported key: ${String(k).slice(0, 16)}`);
      }
    }
    // Drive the live prompt, not tmux copy-mode: if the pane is scrolled into
    // copy-mode the nav keys would move the copy cursor instead of the agent's
    // selection, so drop back to the live prompt first.
    await this.exitCopyMode(target);
    // Send one key at a time with a small gap. Sending them in a single call
    // lets a trailing Enter race ahead of the navigation keys in Claude's Ink
    // TUI (e.g. "Down Down Enter" would select option 1 instead of 3); a gap
    // guarantees each key is processed and re-rendered before the next.
    for (let i = 0; i < keys.length; i++) {
      await this.exec(["send-keys", "-t", target, keys[i]]);
      if (i < keys.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    return { message: `Sent ${keys.length} key(s) to ${target}`, blocked: false };
  }

  async createSession(name: string, cwd?: string): Promise<string> {
    this.ensureValidSessionName(name);
    const args = ["new-session", "-d", "-s", name];
    if (cwd) {
      args.push("-c", cwd);
    }
    await this.exec(args);
    return `${name}:0.0`;
  }

  async createPane(sessionTarget: string, cwd?: string): Promise<string> {
    // sessionTarget can be "session:window" or "session:window.pane"
    const args = ["split-window", "-t", sessionTarget];
    if (cwd) {
      args.push("-c", cwd);
    }
    await this.exec(args);

    // Get the new pane target
    const panes = await this.listPanes();
    const sessionName = sessionTarget.split(":")[0];
    const sessionPanes = panes.filter((p) => p.session === sessionName);
    const last = sessionPanes[sessionPanes.length - 1];
    return last?.target || sessionTarget;
  }

  async terminateSession(sessionName: string): Promise<void> {
    this.ensureValidSessionName(sessionName);
    await this.exec(["kill-session", "-t", sessionName]);
  }

  async terminatePane(target: string): Promise<void> {
    this.ensureValidTarget(target);
    await this.exec(["kill-pane", "-t", target]);
  }

  async capturePane(target: string, lines = 200): Promise<string> {
    this.ensureValidTarget(target);
    const safeLines = Math.max(20, Math.min(lines, 5000));
    try {
      const { stdout } = await this.exec([
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
      const { stdout } = await this.exec([
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

  ensureValidTarget(rawTarget: string): void {
    const target = this.splitHost(rawTarget).local;
    const bareSession = /^[a-zA-Z0-9_.-]+$/.test(target);
    const paneTarget = /^[a-zA-Z0-9_.-]+:[0-9]+\.[0-9]+$/.test(target);
    if (!bareSession && !paneTarget) {
      throw new Error("Invalid tmux target. Use format session or session:window.pane");
    }
  }

  private ensureValidSessionName(name: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(this.splitHost(name).local)) {
      throw new Error("Invalid session name. Use alphanumeric, underscore, dot, or dash only.");
    }
  }
}
