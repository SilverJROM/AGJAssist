import { DatabaseService } from "../db/database.js";

export interface TerminalGroup {
  id: string;
  name: string;
  sessions: string[];
}

export interface TerminalGroupsBlob {
  groups: TerminalGroup[];
  activeGroup: string;
}

const EMPTY_BLOB: TerminalGroupsBlob = { groups: [], activeGroup: "all" };
const MAX_GROUPS = 50;
const MAX_SESSIONS_PER_GROUP = 200;
const MAX_NAME_LEN = 80;
const MAX_ID_LEN = 80;
const MAX_SESSION_NAME_LEN = 128;

export function normalizeTerminalGroupsBlob(raw: unknown): TerminalGroupsBlob {
  if (!raw || typeof raw !== "object") return { ...EMPTY_BLOB, groups: [] };
  const input = raw as { groups?: unknown; activeGroup?: unknown };
  const groupsIn = Array.isArray(input.groups) ? input.groups : [];
  const groups: TerminalGroup[] = [];
  const seen = new Set<string>();
  for (const item of groupsIn.slice(0, MAX_GROUPS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; name?: unknown; sessions?: unknown };
    const id = String(row.id || "").trim().slice(0, MAX_ID_LEN);
    const name = String(row.name || "").trim().slice(0, MAX_NAME_LEN);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const sessions = Array.isArray(row.sessions)
      ? Array.from(
          new Set(
            row.sessions
              .map((s) => String(s).trim().slice(0, MAX_SESSION_NAME_LEN))
              .filter(Boolean)
          )
        ).slice(0, MAX_SESSIONS_PER_GROUP)
      : [];
    groups.push({ id, name, sessions });
  }
  const activeRaw = input.activeGroup == null ? "all" : String(input.activeGroup).trim();
  const activeGroup =
    !activeRaw || activeRaw === "all" || groups.some((g) => g.id === activeRaw) ? (activeRaw || "all") : "all";
  return { groups, activeGroup };
}

export class TerminalGroupsService {
  constructor(private readonly db: DatabaseService) {}

  get(userId: number): TerminalGroupsBlob {
    const row = this.db
      .prepare("SELECT data FROM terminal_groups WHERE user_id = ?")
      .get(userId) as { data: string } | undefined;
    if (!row?.data) return { groups: [], activeGroup: "all" };
    try {
      return normalizeTerminalGroupsBlob(JSON.parse(row.data));
    } catch {
      return { groups: [], activeGroup: "all" };
    }
  }

  put(userId: number, raw: unknown): TerminalGroupsBlob {
    const blob = normalizeTerminalGroupsBlob(raw);
    const data = JSON.stringify(blob);
    this.db
      .prepare(
        `INSERT INTO terminal_groups (user_id, data, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`
      )
      .run(userId, data);
    return blob;
  }
}
