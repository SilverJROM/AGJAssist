import { DatabaseService } from "../db/database.js";
import { TmuxService } from "../tmux/tmux-service.js";
import { AgentEventsService } from "./agent-events-service.js";
import { hasBusySignal } from "./pane-utils.js";

export type AgentWakeKind = "poke-pane" | "wake-coordinator";
export type AgentWakeOutcome =
  | "processing"
  | "fired"
  | "skipped-busy"
  | "skipped-target-missing"
  | "skipped-submit-failed"
  | "coordinator-signaled";

export interface AgentWakeRow {
  id: number;
  run_id: string;
  batch_id: string;
  target_session: string | null;
  kind: AgentWakeKind;
  due_at: string;
  fired_at: string | null;
  outcome: AgentWakeOutcome | null;
  body: Record<string, unknown>;
}

interface RawAgentWakeRow extends Omit<AgentWakeRow, "body" | "kind" | "outcome"> {
  kind: string;
  outcome: string | null;
  body: string;
}

export interface AgentWakeSchedulerOptions {
  now?: () => Date;
  maxPerTick?: number;
}

const DEFAULT_MAX_PER_TICK = 25;
const WAKE_NUDGE_PREFIX = "Scheduled wake is due";

export class AgentWakeScheduler {
  private readonly now: () => Date;
  private readonly maxPerTick: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly tmuxService: TmuxService,
    private readonly events: AgentEventsService,
    options: AgentWakeSchedulerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxPerTick = options.maxPerTick ?? DEFAULT_MAX_PER_TICK;
  }

  requestWake(
    run_id: string,
    batch_id: string,
    target_session: string | null,
    kind: AgentWakeKind,
    due_at: string
  ): AgentWakeRow {
    const result = this.db
      .prepare(
        `INSERT INTO agent_wake_schedule (
          run_id, batch_id, target_session, kind, due_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(run_id, batch_id, target_session, kind, due_at);

    return this.getWakeById(Number(result.lastInsertRowid));
  }

  async tick(): Promise<AgentWakeRow[]> {
    const claimed = this.claimDueWakes();
    for (const wake of claimed) {
      await this.processWake(wake);
    }
    return claimed.map((wake) => this.getWakeById(wake.id));
  }

  private claimDueWakes(): AgentWakeRow[] {
    const now = this.now().toISOString();
    return this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT * FROM agent_wake_schedule
           WHERE due_at <= ? AND fired_at IS NULL
           ORDER BY due_at ASC, id ASC
           LIMIT ?`
        )
        .all(now, this.maxPerTick) as RawAgentWakeRow[];
      const claimed: AgentWakeRow[] = [];
      const claim = this.db.prepare(
        `UPDATE agent_wake_schedule
         SET fired_at = ?, outcome = 'processing', body = ?
         WHERE id = ? AND fired_at IS NULL`
      );

      for (const row of rows) {
        const body = JSON.stringify({ claimed_at: now });
        const result = claim.run(now, body, row.id);
        if (result.changes === 1) {
          claimed.push(this.getWakeById(row.id));
        }
      }
      return claimed;
    });
  }

  private async processWake(wake: AgentWakeRow): Promise<void> {
    if (wake.kind === "wake-coordinator") {
      this.events.recordEvent({
        run_id: wake.run_id,
        role: "coordinator",
        batch_id: wake.batch_id,
        session: wake.target_session,
        type: "status",
        state: "WAKE",
        source: "post",
        correlation_id: `wake:${wake.id}`,
        body: {
          wake_id: wake.id,
          kind: wake.kind,
          due_at: wake.due_at
        }
      });
      this.updateOutcome(wake.id, "coordinator-signaled", {
        signaled_at: this.now().toISOString()
      });
      return;
    }

    await this.processPaneWake(wake);
  }

  private async processPaneWake(wake: AgentWakeRow): Promise<void> {
    const target = wake.target_session;
    if (!target || !(await this.tmuxService.sessionExists(target))) {
      this.updateOutcome(wake.id, "skipped-target-missing", {
        reason: "target session missing",
        target_session: target
      });
      return;
    }

    const pane = await this.tmuxService.capturePane(target, 200);
    if (hasBusySignal(pane)) {
      this.updateOutcome(wake.id, "skipped-busy", {
        reason: "target pane busy",
        target_session: target
      });
      return;
    }

    const sent = await this.tmuxService.sendAndSubmit(
      target,
      `${WAKE_NUDGE_PREFIX} for batch ${wake.batch_id}. Report STATUS or continue the current task.`
    );
    this.updateOutcome(wake.id, sent ? "fired" : "skipped-submit-failed", {
      target_session: target,
      sent
    });
  }

  private updateOutcome(
    id: number,
    outcome: Exclude<AgentWakeOutcome, "processing">,
    body: Record<string, unknown>
  ): void {
    this.db
      .prepare("UPDATE agent_wake_schedule SET outcome = ?, body = ? WHERE id = ?")
      .run(outcome, JSON.stringify(body), id);
  }

  private getWakeById(id: number): AgentWakeRow {
    const row = this.db
      .prepare("SELECT * FROM agent_wake_schedule WHERE id = ?")
      .get(id) as RawAgentWakeRow | undefined;
    if (!row) throw new Error(`agent_wake_schedule row ${id} not found`);
    return parseWakeRow(row);
  }
}

function parseWakeRow(row: RawAgentWakeRow): AgentWakeRow {
  return {
    ...row,
    kind: row.kind as AgentWakeKind,
    outcome: row.outcome as AgentWakeOutcome | null,
    body: parseBody(row.body)
  };
}

function parseBody(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
