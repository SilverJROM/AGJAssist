import { TmuxService } from "../tmux/tmux-service.js";

const DEFAULT_SESSION = "OVM";
const DEFAULT_REPO_DIR = "/home/agjrom/TGBOTS/AGJAssist";
const DEFAULT_PRIMER_PATH = "/home/agjrom/TGBOTS/AGJAssist/plan/overmind/OVM_OPERATOR_PRIMER.md";
const DEFAULT_SETTLE_MS = 4_000;

export interface OvmTmuxService {
  sessionExists(target: string): Promise<boolean>;
  createSession(name: string, cwd?: string): Promise<string>;
  terminateSession(sessionName: string): Promise<void>;
  sendCommand(target: string, command: string, pressEnter?: boolean, skipSafetyCheck?: boolean): Promise<unknown>;
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

export interface OvmSessionManager {
  status(): Promise<OvmSessionStatus>;
  open(): Promise<OvmOpenResult>;
  restart(): Promise<OvmOpenResult>;
  close(): Promise<OvmSessionStatus & { closed: boolean }>;
}

interface OvmSessionOptions {
  sessionName?: string;
  repoDir?: string;
  primerPath?: string;
  overmindToken: string;
  settleMs?: number;
}

export class OvmSessionService implements OvmSessionManager {
  private readonly sessionName: string;
  private readonly repoDir: string;
  private readonly primerPath: string;
  private readonly overmindToken: string;
  private readonly settleMs: number;
  private since: string | null = null;

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

    return {
      open: false,
      status: "closed",
      closed: true
    };
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
