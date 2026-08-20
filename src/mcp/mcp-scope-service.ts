import { DatabaseService } from "../db/database.js";
import { TerminalGroupsService } from "../services/terminal-groups-service.js";
import type { McpGrantRow, McpScopeType } from "./mcp-grant-service.js";
import { McpPoolService } from "./mcp-pool-service.js";

const SESSION_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export interface McpScopeGrant {
  scopeType: McpScopeType;
  scopeRef: string;
  grantedBy: number;
}

function validName(name: string): boolean {
  return SESSION_NAME_RE.test(name);
}

function asGrant(grant: McpGrantRow | McpScopeGrant): McpScopeGrant {
  return {
    scopeType: grant.scopeType,
    scopeRef: grant.scopeRef,
    grantedBy: grant.grantedBy
  };
}

export class McpScopeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly groups: TerminalGroupsService = new TerminalGroupsService(db),
    private readonly pool: McpPoolService = new McpPoolService(db)
  ) {}

  /**
   * Effective session names, fail-closed (corrupt/missing → empty).
   * - `sessions` (hand-picked list): S ∩ pool ∩ live ∩ validName — the pool is the cap.
   * - `group`: the group's live membership IS the owner-curated scope (decision D7),
   *   so it is NOT additionally gated by the pool: S ∩ live ∩ validName.
   */
  resolve(grant: McpGrantRow | McpScopeGrant, liveSessionNames: Iterable<string>): string[] {
    const g = asGrant(grant);
    const S = this.sessionSet(g);
    const T = new Set([...liveSessionNames].filter(validName));
    const P = g.scopeType === "sessions" ? new Set(this.pool.list()) : null;
    return [...S]
      .filter((name) => (P === null || P.has(name)) && T.has(name) && validName(name))
      .sort();
  }

  private sessionSet(grant: McpScopeGrant): Set<string> {
    if (grant.scopeType === "group") {
      const blob = this.groups.get(grant.grantedBy);
      const group = blob.groups.find((item) => item.id === grant.scopeRef);
      if (!group) return new Set();
      return new Set(group.sessions.filter(validName));
    }
    if (grant.scopeType !== "sessions") return new Set();
    try {
      const parsed = JSON.parse(grant.scopeRef) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((s) => String(s)).filter(validName));
    } catch {
      return new Set();
    }
  }
}
