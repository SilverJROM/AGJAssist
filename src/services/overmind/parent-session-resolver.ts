import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TmuxSessionInfo {
  name: string;
  group: string;
  attached: boolean;
  activity: number;
}

export interface ParentResolution {
  session: string | null;
  base: string;
  candidates: string[];
  method: "exact" | "group" | "prefix" | "none";
  ambiguous: boolean;
}

// Single documented regex per spec:
// A session name is a child-role name when it equals <base> + one of the listed
// roles, optionally followed by more `-token`s.
const CHILD_ROLE_RE =
  /^[^-]+-(grok|sonnet|opus|haiku|spark|codex|codex55|composer|planner|validator|implementer|coder|tester|panel)(?:-|$)/;

function isChildRoleNamed(name: string): boolean {
  return CHILD_ROLE_RE.test(name);
}

export function deriveBaseName(stored: string): string {
  if (!stored || typeof stored !== "string") return "";
  // Peel child-role suffix first (e.g. "lkvc-grok", "helm-codex55-planner")
  const childMatch = stored.match(
    /^(.+?)-(grok|sonnet|opus|haiku|spark|codex|codex55|composer|planner|validator|implementer|coder|tester|panel)(?:-|$)/
  );
  if (childMatch) {
    return childMatch[1];
  }
  // Strip trailing -digits for full parent names (e.g. "agj-4")
  return stored.replace(/-\d+$/, "");
}

function rankSessions(sessions: TmuxSessionInfo[]): TmuxSessionInfo[] {
  return [...sessions].sort((a, b) => {
    const aAtt = a.attached ? 1 : 0;
    const bAtt = b.attached ? 1 : 0;
    if (bAtt !== aAtt) return bAtt - aAtt; // attached desc
    return (b.activity || 0) - (a.activity || 0); // activity desc
  });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function selectParentCandidate(
  stored: string,
  sessions: TmuxSessionInfo[]
): ParentResolution {
  const base = deriveBaseName(stored);

  // EXACT fast path: stored name alive and not a child-role name
  const exact = sessions.find((s) => s.name === stored && !isChildRoleNamed(s.name));
  if (exact) {
    return {
      session: stored,
      base,
      candidates: [stored],
      method: "exact",
      ambiguous: false,
    };
  }

  // GROUP match (parents have group === base)
  let candidates = sessions.filter((s) => s.group === base && !isChildRoleNamed(s.name));
  if (candidates.length > 0) {
    const ranked = rankSessions(candidates);
    const session = ranked[0].name;
    const attachedCount = candidates.filter((c) => c.attached).length;
    const ambiguous = attachedCount >= 2;
    return {
      session,
      base,
      candidates: ranked.map((c) => c.name),
      method: "group",
      ambiguous,
    };
  }

  // PREFIX match (only when no group match): base or base-N (digit suffix only)
  const prefixRe = new RegExp(`^${escapeRegex(base)}-\\d+$`);
  candidates = sessions.filter(
    (s) => !isChildRoleNamed(s.name) && (s.name === base || prefixRe.test(s.name))
  );
  if (candidates.length > 0) {
    const ranked = rankSessions(candidates);
    const session = ranked[0].name;
    const attachedCount = candidates.filter((c) => c.attached).length;
    const ambiguous = attachedCount >= 2;
    return {
      session,
      base,
      candidates: ranked.map((c) => c.name),
      method: "prefix",
      ambiguous,
    };
  }

  return { session: null, base, candidates: [], method: "none", ambiguous: false };
}

export async function listTmuxSessions(): Promise<TmuxSessionInfo[]> {
  try {
    const { stdout } = await execFileAsync("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}|#{session_group}|#{session_attached}|#{session_activity}",
    ]);
    const out = stdout?.trim();
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [name = "", group = "", attachedStr = "0", activityStr = "0"] = line.split("|");
      return {
        name,
        group: group || "",
        attached: attachedStr === "1" || attachedStr.toLowerCase() === "true",
        activity: parseInt(activityStr, 10) || 0,
      };
    });
  } catch {
    return [];
  }
}

export async function resolveParentSession(stored: string): Promise<ParentResolution> {
  return selectParentCandidate(stored, await listTmuxSessions());
}
