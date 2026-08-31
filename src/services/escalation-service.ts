// Escalation delivery for agents: a single, clean path for an agent to reach
// JROM on Telegram for a TRUE BLOCKER or a FULL ESCALATION. Formats verdict-led
// (per the notification protocol) and de-dupes identical escalations inside a
// short window so a looping agent can't spam the wire.

export type EscalationType = "blocker" | "escalation";

export interface EscalationInput {
  type: EscalationType;
  from: string; // the agent / session raising it
  message: string; // what is wrong / the decision needed
  session?: string; // optional tmux target or run context
  action?: string; // what JROM specifically needs to do
}

export interface EscalationResult {
  sent: boolean;
  deduped?: boolean;
  reason?: string;
}

export class EscalationService {
  private readonly recent = new Map<string, number>();
  private readonly dedupeWindowMs: number;

  constructor(
    private readonly send: (text: string) => Promise<void>,
    private readonly now: () => number = () => Date.now(),
    dedupeWindowMs = 10 * 60 * 1000
  ) {
    this.dedupeWindowMs = dedupeWindowMs;
  }

  /** Verdict-led Telegram body: header verdict → detail → labelled context → action. */
  format(input: EscalationInput): string {
    const header = input.type === "blocker" ? "🛑 BLOCKED" : "🚨 ESCALATION";
    const lines: string[] = [`${header} — ${input.from}`.trim(), "", input.message.trim()];
    if (input.session) lines.push(`Session: ${input.session}`);
    lines.push("", `👉 ${input.action?.trim() || "Needs your call."}`);
    return lines.join("\n");
  }

  async escalate(input: EscalationInput): Promise<EscalationResult> {
    const key = `${input.type}|${input.from}|${input.message}`.slice(0, 500);
    const t = this.now();
    const last = this.recent.get(key);
    if (last !== undefined && t - last < this.dedupeWindowMs) {
      return { sent: false, deduped: true, reason: "duplicate within window" };
    }
    await this.send(this.format(input));
    this.recent.set(key, t);
    for (const [k, ts] of this.recent) {
      if (t - ts > this.dedupeWindowMs) this.recent.delete(k);
    }
    return { sent: true };
  }
}
