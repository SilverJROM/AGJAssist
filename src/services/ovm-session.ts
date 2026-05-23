import { hasActiveTurn } from "./overmind-watcher.js";
import { TmuxService } from "../tmux/tmux-service.js";

const DEFAULT_SESSION = "OVM";
const DEFAULT_REPO_DIR = "/home/agjrom/TGBOTS/AGJAssist";
const DEFAULT_PRIMER_PATH = "/home/agjrom/TGBOTS/AGJAssist/plan/overmind/OVM_OPERATOR_PRIMER.md";
const DEFAULT_SETTLE_MS = 4_000;

// How long to block in sendAndAwaitReply before returning { pending: true }
export const OVM_SEND_SYNC_TIMEOUT_MS = 28_000;
// Poll interval while waiting for OVM turn to finish
export const OVM_SEND_POLL_MS = 700;
// Number of stable reads before declaring turn done
export const OVM_SEND_STABLE_READS = 2;
// Fallback text when no reply is extracted within the sync window
export const OVM_SEND_FALLBACK = "OVM is taking a while / still working.";

export interface OvmTmuxService {
  sessionExists(target: string): Promise<boolean>;
  createSession(name: string, cwd?: string): Promise<string>;
  terminateSession(sessionName: string): Promise<void>;
  sendCommand(target: string, command: string, pressEnter?: boolean, skipSafetyCheck?: boolean): Promise<unknown>;
  capturePane(target: string, lines?: number): Promise<string>;
}

export interface OvmSessionStatus {
  open: boolean;
  status: "open" | "closed";
  since?: string;
}

export interface OvmOpenResult extends OvmSessionStatus {
  opened?: boolean;
  reused?: boolean;
  restarted?: boolean;
}

/** Result of sendAndAwaitReply when OVM finishes within the sync window */
export interface OvmReplyDone {
  pending: false;
  reply: string;
}

/** Result of sendAndAwaitReply when OVM is still working past the sync window */
export interface OvmReplyPending {
  pending: true;
}

export type OvmSendResult = OvmReplyDone | OvmReplyPending;

export interface OvmSessionManager {
  status(): Promise<OvmSessionStatus>;
  open(): Promise<OvmOpenResult>;
  restart(): Promise<OvmOpenResult>;
  close(): Promise<OvmSessionStatus & { closed: boolean }>;
  /**
   * Send a message to the OVM tmux session and wait for the reply.
   * Blocks up to OVM_SEND_SYNC_TIMEOUT_MS. Returns { pending: true } if OVM
   * is still working past the timeout; the caller can then poll getReply().
   */
  sendAndAwaitReply(message: string): Promise<OvmSendResult>;
  /**
   * Poll for the in-flight reply started by sendAndAwaitReply.
   * Returns { pending: true } while OVM is still mid-turn, or { pending: false, reply } when done.
   * Returns null when there is no in-flight send.
   */
  getReply(): Promise<OvmSendResult | null>;
}

interface OvmSessionOptions {
  sessionName?: string;
  repoDir?: string;
  primerPath?: string;
  overmindToken: string;
  settleMs?: number;
}

interface InFlightRelay {
  before: string;
  message: string;
  promise: Promise<string>;
}

export class OvmSessionService implements OvmSessionManager {
  private readonly sessionName: string;
  private readonly repoDir: string;
  private readonly primerPath: string;
  private readonly overmindToken: string;
  private readonly settleMs: number;
  private since: string | null = null;
  private inFlight: InFlightRelay | null = null;

  constructor(
    private readonly tmuxService: OvmTmuxService | TmuxService,
    options: OvmSessionOptions
  ) {
    this.sessionName = options.sessionName ?? DEFAULT_SESSION;
    this.repoDir = options.repoDir ?? DEFAULT_REPO_DIR;
    this.primerPath = options.primerPath ?? DEFAULT_PRIMER_PATH;
    this.overmindToken = options.overmindToken;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  }

  async status(): Promise<OvmSessionStatus> {
    const open = await this.exists();
    if (!open) {
      this.since = null;
      return { open: false, status: "closed" };
    }

    return {
      open: true,
      status: "open",
      ...(this.since ? { since: this.since } : {})
    };
  }

  async open(): Promise<OvmOpenResult> {
    if (await this.exists()) {
      return {
        ...(await this.status()),
        reused: true
      };
    }

    await this.tmuxService.createSession(this.sessionName, this.repoDir);
    this.since = new Date().toISOString();

    await this.tmuxService.sendCommand(
      this.sessionName,
      "claude --dangerously-skip-permissions --model sonnet",
      true,
      true
    );
    await this.sleep(this.settleMs);
    await this.tmuxService.sendCommand(this.sessionName, this.kickoffMessage(), true, true);

    return {
      open: true,
      status: "open",
      opened: true,
      since: this.since
    };
  }

  async restart(): Promise<OvmOpenResult> {
    if (await this.exists()) {
      await this.tmuxService.terminateSession(this.sessionName);
    }

    const opened = await this.open();
    return {
      ...opened,
      restarted: true
    };
  }

  async close(): Promise<OvmSessionStatus & { closed: boolean }> {
    if (await this.exists()) {
      await this.tmuxService.terminateSession(this.sessionName);
    }
    this.since = null;
    this.inFlight = null;

    return {
      open: false,
      status: "closed",
      closed: true
    };
  }

  async sendAndAwaitReply(message: string): Promise<OvmSendResult> {
    await this.open();

    const before = await this.tmuxService.capturePane(this.sessionName, 500);
    await this.tmuxService.sendCommand(this.sessionName, message, true, true);

    // Start the background poll that runs until OVM is done (no cap — keep going)
    const fullPromise = this.pollUntilDone(before, message);
    this.inFlight = { before, message, promise: fullPromise };

    // Race the background poll against the sync timeout
    const result = await Promise.race([
      fullPromise.then((reply): OvmSendResult => ({ pending: false, reply })),
      this.sleep(OVM_SEND_SYNC_TIMEOUT_MS).then((): OvmSendResult => ({ pending: true }))
    ]);

    if (!result.pending) {
      // Resolved within the sync window — clear in-flight
      this.inFlight = null;
    }
    // If still pending, inFlight stays set so getReply() can pick it up

    return result;
  }

  async getReply(): Promise<OvmSendResult | null> {
    if (!this.inFlight) return null;

    const { before, message } = this.inFlight;
    const pane = await this.tmuxService.capturePane(this.sessionName, 500);

    if (hasActiveTurn(pane)) {
      return { pending: true };
    }

    // Turn finished — extract reply from latest pane vs the pre-send snapshot
    const reply = this.extractOvmReply(this.diffTerminalOutput(before, pane), message);
    this.inFlight = null;
    return { pending: false, reply: reply || OVM_SEND_FALLBACK };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async pollUntilDone(before: string, message: string): Promise<string> {
    let latest = before;
    let changed = false;
    let stableReads = 0;
    let bestReply = "";

    // Poll indefinitely until stable — the caller races against a timeout
    for (;;) {
      await this.sleep(OVM_SEND_POLL_MS);
      const current = await this.tmuxService.capturePane(this.sessionName, 500);

      if (current !== latest) {
        latest = current;
        changed = true;
        stableReads = 0;
        bestReply = this.extractOvmReply(this.diffTerminalOutput(before, latest), message) || bestReply;
        continue;
      }

      if (changed && !hasActiveTurn(latest)) {
        stableReads += 1;
        bestReply = this.extractOvmReply(this.diffTerminalOutput(before, latest), message) || bestReply;
        if (stableReads >= OVM_SEND_STABLE_READS) break;
      }
    }

    return bestReply || OVM_SEND_FALLBACK;
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
    const before = this.normalizeText(this.stripAnsi(beforeText));
    const after = this.normalizeText(this.stripAnsi(afterText));
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

  private normalizeText(text: string): string {
    return (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  private stripAnsi(text: string): string {
    return (text || "")
      .replace(/\][^]*(?:|\\)/g, "")
      .replace(/\[[0-?]*[ -/]*[@-~]/g, "");
  }

  private async exists(): Promise<boolean> {
    return this.tmuxService.sessionExists(this.sessionName);
  }

  private kickoffMessage(): string {
    return `Read ${this.primerPath} and operate as the Overmind operator per it. OVERMIND_TOKEN=${this.overmindToken}. Reply 'ready' when you've read it.`;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
