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

  /** Effective session names: S ∩ P ∩ T ∩ validName. Corrupt/missing → empty (fail-closed). */
  resolve(grant: McpGrantRow | McpScopeGrant, liveSessionNames: Iterable<string>): string[] {
    const g = asGrant(grant);
    const S = this.sessionSet(g);
    const P = new Set(this.pool.list());
    const T = new Set([...liveSessionNames].filter(validName));
    return [...S].filter((name) => P.has(name) && T.has(name) && validName(name)).sort();
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
