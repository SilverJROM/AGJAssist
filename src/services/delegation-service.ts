import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface Delegation {
  id: number;
  agent_name: string;
  tmux_session_id: number;
  pane_target: string | null;
  authority: "observe" | "suggest" | "execute";
  granted_by: number;
  active: number;
  created_at: string;
  revoked_at: string | null;
}

export type AuthorityLevel = "observe" | "suggest" | "execute" | null;

export class DelegationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  grant(
    agentName: string,
    tmuxSessionId: number,
    paneTarget: string | null,
    authority: "observe" | "suggest" | "execute",
    grantedBy: number
  ): Delegation {
    // Revoke any existing active delegation for same agent+session+pane
    this.db
      .prepare(
        `UPDATE agent_delegations
         SET active = 0, revoked_at = datetime('now')
         WHERE agent_name = ? AND tmux_session_id = ? AND (pane_target = ? OR (pane_target IS NULL AND ? IS NULL)) AND active = 1`
      )
      .run(agentName, tmuxSessionId, paneTarget, paneTarget);

    const result = this.db
      .prepare(
        `INSERT INTO agent_delegations (agent_name, tmux_session_id, pane_target, authority, granted_by)
         VALUES (?, ?, ?, ?, ?) RETURNING *`
      )
      .get(agentName, tmuxSessionId, paneTarget, authority, grantedBy) as Delegation;

    this.auditService.log({
      userId: grantedBy,
      agentName,
      actionType: "delegation_grant",
      resourceType: "delegation",
      resourceId: String(result.id),
      details: { tmux_session_id: tmuxSessionId, pane_target: paneTarget, authority }
    });

    return result;
  }

  revoke(delegationId: number, revokedBy?: number): boolean {
    const existing = this.db
      .prepare("SELECT * FROM agent_delegations WHERE id = ? AND active = 1")
      .get(delegationId) as Delegation | undefined;

    if (!existing) return false;

    this.db
      .prepare(
        "UPDATE agent_delegations SET active = 0, revoked_at = datetime('now') WHERE id = ?"
      )
      .run(delegationId);

    this.auditService.log({
      userId: revokedBy,
      agentName: existing.agent_name,
      actionType: "delegation_revoke",
      resourceType: "delegation",
      resourceId: String(delegationId),
      details: { tmux_session_id: existing.tmux_session_id, authority: existing.authority }
    });

    return true;
  }

  changeAuthority(
    delegationId: number,
    newAuthority: "observe" | "suggest" | "execute",
    changedBy?: number
  ): Delegation | null {
    const existing = this.db
      .prepare("SELECT * FROM agent_delegations WHERE id = ? AND active = 1")
      .get(delegationId) as Delegation | undefined;

    if (!existing) return null;

    this.db
      .prepare("UPDATE agent_delegations SET authority = ? WHERE id = ?")
      .run(newAuthority, delegationId);

    this.auditService.log({
      userId: changedBy,
      agentName: existing.agent_name,
      actionType: "delegation_change",
      resourceType: "delegation",
      resourceId: String(delegationId),
      details: { from: existing.authority, to: newAuthority }
    });

    return this.db
      .prepare("SELECT * FROM agent_delegations WHERE id = ?")
      .get(delegationId) as Delegation;
  }

  checkAuthority(agentName: string, paneTarget: string): AuthorityLevel {
    // Check for specific pane delegation first
    const specific = this.db
      .prepare(
        `SELECT authority FROM agent_delegations
         WHERE agent_name = ? AND pane_target = ? AND active = 1
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(agentName, paneTarget) as { authority: string } | undefined;

    if (specific) return specific.authority as AuthorityLevel;

    // Check for session-wide delegation (pane_target IS NULL)
    const sessionName = paneTarget.split(":")[0];
    const sessionWide = this.db
      .prepare(
        `SELECT ad.authority FROM agent_delegations ad
         JOIN tmux_sessions ts ON ad.tmux_session_id = ts.id
         WHERE ad.agent_name = ? AND ts.session_name = ? AND ad.pane_target IS NULL AND ad.active = 1
         ORDER BY ad.created_at DESC LIMIT 1`
      )
      .get(agentName, sessionName) as { authority: string } | undefined;

    if (sessionWide) return sessionWide.authority as AuthorityLevel;

    return null;
  }

  listActive(filters?: { agentName?: string; tmuxSessionId?: number }): Delegation[] {
    let sql = "SELECT * FROM agent_delegations WHERE active = 1";
    const params: unknown[] = [];

    if (filters?.agentName) {
      sql += " AND agent_name = ?";
      params.push(filters.agentName);
    }
    if (filters?.tmuxSessionId) {
      sql += " AND tmux_session_id = ?";
      params.push(filters.tmuxSessionId);
    }

    sql += " ORDER BY created_at DESC";
    return this.db.prepare(sql).all(...params) as Delegation[];
  }

  revokeAllForSession(tmuxSessionId: number): number {
    const result = this.db
      .prepare(
        "UPDATE agent_delegations SET active = 0, revoked_at = datetime('now') WHERE tmux_session_id = ? AND active = 1"
      )
      .run(tmuxSessionId);

    return result.changes;
  }
}
