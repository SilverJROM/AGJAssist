import { DatabaseService } from "../db/database.js";

export interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: number | null;
  agent_name: string | null;
  action_type: string;
  resource_type: string | null;
  resource_id: string | null;
  details: string | null;
  tmux_target: string | null;
  surface: string | null;
}

export type AuditSurface = "bot" | "miniapp" | "web" | "agent" | "mcp";

export interface AuditLogParams {
  userId?: number | null;
  agentName?: string | null;
  actionType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  tmuxTarget?: string | null;
  surface?: AuditSurface | null;
}

export interface AuditQueryFilters {
  actionType?: string;
  resourceType?: string;
  agentName?: string;
  userId?: number;
  surface?: AuditSurface;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  log(params: AuditLogParams): number {
    const result = this.db
      .prepare(
        `INSERT INTO audit_log (user_id, agent_name, action_type, resource_type, resource_id, details, tmux_target, surface)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.userId ?? null,
        params.agentName ?? null,
        params.actionType,
        params.resourceType ?? null,
        params.resourceId ?? null,
        params.details ? JSON.stringify(params.details) : null,
        params.tmuxTarget ?? null,
        params.surface ?? null
      );
    return Number(result.lastInsertRowid);
  }

  completeAudit(id: number, details: Record<string, unknown>): boolean {
    const row = this.db
      .prepare("SELECT details FROM audit_log WHERE id = ?")
      .get(id) as { details: string | null } | undefined;
    if (!row) return false;
    let merged: Record<string, unknown> = { ...details };
    if (row.details) {
      try {
        const prev = JSON.parse(row.details) as unknown;
        if (prev && typeof prev === "object" && !Array.isArray(prev)) {
          merged = { ...(prev as Record<string, unknown>), ...details };
        }
      } catch {
        /* keep the new details only */
      }
    }
    this.db
      .prepare("UPDATE audit_log SET details = ? WHERE id = ?")
      .run(JSON.stringify(merged), id);
    return true;
  }

  query(filters: AuditQueryFilters): AuditEntry[] {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.actionType) {
      conditions.push("action_type = ?");
      values.push(filters.actionType);
    }
    if (filters.resourceType) {
      conditions.push("resource_type = ?");
      values.push(filters.resourceType);
    }
    if (filters.agentName) {
      conditions.push("agent_name = ?");
      values.push(filters.agentName);
    }
    if (filters.userId) {
      conditions.push("user_id = ?");
      values.push(filters.userId);
    }
    if (filters.surface) {
      conditions.push("surface = ?");
      values.push(filters.surface);
    }
    if (filters.since) {
      conditions.push("timestamp >= ?");
      values.push(filters.since);
    }
    if (filters.until) {
      conditions.push("timestamp <= ?");
      values.push(filters.until);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    return this.db
      .prepare(
        `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as AuditEntry[];
  }
}
