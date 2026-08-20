import { DatabaseService } from "../db/database.js";
import { AuditService } from "../services/audit-service.js";

const SESSION_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export class McpPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpPoolError";
  }
}

export class McpPoolService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService = new AuditService(db)
  ) {}

  list(): string[] {
    return (
      this.db.prepare("SELECT session_name FROM mcp_grantable_pool ORDER BY session_name").all() as {
        session_name: string;
      }[]
    ).map((r) => r.session_name);
  }

  /** Replace-set. Prunes removed names from active `sessions` grants in the same tx. Group grants untouched. */
  replaceSet(ownerId: number, sessions: string[]): string[] {
    const next = Array.from(
      new Set(sessions.map((s) => String(s).trim()).filter(Boolean))
    ).sort();
    for (const name of next) {
      if (!SESSION_NAME_RE.test(name)) {
        throw new McpPoolError(`invalid session name: ${name}`);
      }
    }
    const nextSet = new Set(next);

    return this.db.transaction(() => {
      const prev = this.list();
      const removed = prev.filter((name) => !nextSet.has(name));

      this.db.prepare("DELETE FROM mcp_grantable_pool").run();
      const insert = this.db.prepare(
        "INSERT INTO mcp_grantable_pool (session_name, added_by) VALUES (?, ?)"
      );
      for (const name of next) insert.run(name, ownerId);

      if (removed.length > 0) {
        const grants = this.db
          .prepare("SELECT id, scope_ref, granted_by FROM mcp_grants WHERE status = 'active' AND scope_type = 'sessions'")
          .all() as { id: number; scope_ref: string; granted_by: number }[];
        const update = this.db.prepare("UPDATE mcp_grants SET scope_ref = ? WHERE id = ?");
        for (const grant of grants) {
          let names: string[] = [];
          try {
            const parsed = JSON.parse(grant.scope_ref) as unknown;
            names = Array.isArray(parsed) ? parsed.map(String) : [];
          } catch {
            names = [];
          }
          const pruned = names.filter((n) => nextSet.has(n));
          if (pruned.length === names.length && pruned.every((n, i) => n === names[i])) continue;
          update.run(JSON.stringify(pruned), grant.id);
          this.audit.log({
            userId: grant.granted_by,
            actionType: "mcp_grant_scope_updated",
            resourceType: "mcp_grant",
            resourceId: String(grant.id),
            details: { grant_id: grant.id, pruned: names.filter((n) => !nextSet.has(n)) },
            surface: "mcp"
          });
        }
      }

      this.audit.log({
        userId: ownerId,
        actionType: "mcp_pool_updated",
        resourceType: "mcp_pool",
        details: { sessions: next, removed },
        surface: "mcp"
      });
      return next;
    });
  }
}
