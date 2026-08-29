import type { TmuxService } from "../tmux/tmux-service.js";
import type { TelegramAssistant } from "../bot/telegram-bot.js";
import { detectPaneSelection, isAwaitingSelection } from "../tmux/selection-detect.js";

interface AwaitInfo {
  since: number;
  notified: boolean;
  session: string;
  question: string;
}

/**
 * Scans tmux panes on an interval for agents blocked on an interactive options
 * selection. If one sits unanswered past the threshold (default 15m), it DMs the
 * owner on Telegram once — so a stuck agent the user never saw doesn't stall
 * forever. Runs independently of any connected web client.
 */
export class SelectionWatchService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly awaiting = new Map<string, AwaitInfo>();
  private readonly scanIntervalMs: number;
  private readonly notifyAfterMs: number;
  private readonly peekLines: number;

  constructor(
    private readonly tmux: TmuxService,
    private readonly telegram: TelegramAssistant | null,
    private readonly ownerChatId: number,
    opts: { scanIntervalMs?: number; notifyAfterMs?: number; peekLines?: number } = {}
  ) {
    this.scanIntervalMs = opts.scanIntervalMs ?? 30_000;
    this.notifyAfterMs = opts.notifyAfterMs ?? 15 * 60_000;
    this.peekLines = opts.peekLines ?? 60;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.scanIntervalMs);
    // Don't keep the process alive just for this watcher.
    if (typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Targets currently blocked on a selection (exposed for tests / diagnostics). */
  awaitingTargets(): string[] {
    return [...this.awaiting.keys()];
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      let panes: Array<{ target: string; session: string }>;
      try {
        panes = (await this.tmux.listPanes()) as Array<{ target: string; session: string }>;
      } catch {
        return;
      }

      const seen = new Set<string>();
      for (const pane of panes) {
        seen.add(pane.target);
        let snapshot = "";
        try {
          snapshot = await this.tmux.peekPane(pane.target, this.peekLines);
        } catch {
          continue;
        }
        const sel = await detectPaneSelection(snapshot);
        if (isAwaitingSelection(sel)) {
          if (!this.awaiting.has(pane.target)) {
            this.awaiting.set(pane.target, {
              since: Date.now(),
              notified: false,
              session: pane.session,
              question: (sel?.question || sel?.title || "").slice(0, 140)
            });
          }
        } else {
          this.awaiting.delete(pane.target);
        }
      }
      // Drop panes that no longer exist.
      for (const target of [...this.awaiting.keys()]) {
        if (!seen.has(target)) this.awaiting.delete(target);
      }

      // Fire a one-shot DM once a selection has sat unanswered past the threshold.
      const now = Date.now();
      for (const info of this.awaiting.values()) {
        if (!info.notified && now - info.since >= this.notifyAfterMs) {
          info.notified = true;
          if (this.telegram) {
            const mins = Math.round((now - info.since) / 60_000);
            const question = info.question ? `\n"${info.question}"` : "";
            const text =
              `⏳ Pending options selection\n` +
              `Agent: ${info.session}\n` +
              `Unanswered: ${mins}m${question}\n` +
              `Open the agent window to pick an option.`;
            void this.telegram.sendMessage(this.ownerChatId, text).catch(() => {});
          }
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
