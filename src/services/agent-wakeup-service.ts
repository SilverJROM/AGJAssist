import { DatabaseService } from "../db/database.js";
import { SafetyService } from "./safety-service.js";
import { TmuxService } from "../tmux/tmux-service.js";
import { AuditService } from "./audit-service.js";

export interface AgentWakeup {
  id: number;
  pane_target: string;
  manual_fire_time: string;
  action: string;
  status: "pending" | "fired" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface CreateWakeupParams {
  paneTarget: string;
  manualFireTime: string;
  action: string;
}

export class AgentWakeupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly safetyService?: SafetyService,
    private readonly tmuxService?: TmuxService,
    private readonly auditService?: AuditService
  ) {}

  create(params: CreateWakeupParams): AgentWakeup {
    const result = this.db
      .prepare(
        `INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status)
         VALUES (?, ?, ?, 'pending')
         RETURNING *`
      )
      .get(params.paneTarget, params.manualFireTime, params.action) as AgentWakeup;
    return result;
  }

  cancel(id: number): boolean {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `UPDATE agent_one_time_wakeups
       SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND status = 'pending'`
    );
    const res = stmt.run(now, id);
    return res.changes > 0;
  }

  getById(id: number): AgentWakeup | null {
    return this.db
      .prepare("SELECT * FROM agent_one_time_wakeups WHERE id = ?")
      .get(id) as AgentWakeup | null;
  }

  listPending(): AgentWakeup[] {
    return this.db
      .prepare("SELECT * FROM agent_one_time_wakeups WHERE status = 'pending' ORDER BY manual_fire_time ASC")
      .all() as AgentWakeup[];
  }

  async fire(id: number): Promise<boolean> {
    const nowIso = new Date().toISOString();

    // Load pending and due row
    const row = this.db
      .prepare(
        `SELECT * FROM agent_one_time_wakeups
         WHERE id = ? AND status = 'pending' AND manual_fire_time <= ?`
      )
      .get(id, nowIso) as AgentWakeup | undefined;
    if (!row) {
      return false;
    }

    // Safety check
    if (this.safetyService) {
      const check = this.safetyService.checkCommand(row.action);
      if (check.blocked) {
        this.auditService?.log({
          actionType: "agent_wakeup_blocked",
          resourceType: "agent_one_time_wakeup",
          resourceId: String(id),
          details: { paneTarget: row.pane_target, action: row.action, reason: "safety_blocked" },
          tmuxTarget: row.pane_target,
        });
        this.db.prepare("UPDATE agent_one_time_wakeups SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso, id);
        return false;
      }
    }

    // Send via tmux
    if (this.tmuxService) {
      try {
        await this.tmuxService.sendCommand(row.pane_target, row.action, true, false);
      } catch (err) {
        this.auditService?.log({
          actionType: "agent_wakeup_send_failed",
          resourceType: "agent_one_time_wakeup",
          resourceId: String(id),
          details: { paneTarget: row.pane_target, action: row.action, error: String(err) },
          tmuxTarget: row.pane_target,
        });
        this.db.prepare("UPDATE agent_one_time_wakeups SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso, id);
        return false;
      }
    }

    // Audit success
    this.auditService?.log({
      actionType: "agent_wakeup_fired",
      resourceType: "agent_one_time_wakeup",
      resourceId: String(id),
      details: { paneTarget: row.pane_target, action: row.action, firedAt: nowIso },
      tmuxTarget: row.pane_target,
    });

    // Atomically mark fired only if still pending
    const update = this.db.prepare(
      `UPDATE agent_one_time_wakeups
       SET status = 'fired', updated_at = ?
       WHERE id = ? AND status = 'pending'`
    );
    const res = update.run(nowIso, id);
    return res.changes > 0;
  }

  async fireDue(): Promise<number> {
    const nowIso = new Date().toISOString();
    const dueRows = this.db
      .prepare(
        `SELECT id FROM agent_one_time_wakeups
         WHERE status = 'pending' AND manual_fire_time <= ?`
      )
      .all(nowIso) as { id: number }[];

    let firedCount = 0;
    for (const { id } of dueRows) {
      const ok = await this.fire(id);
      if (ok) firedCount++;
    }
    return firedCount;
  }
}
