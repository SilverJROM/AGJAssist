import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DatabaseService } from "../db/database.js";
import { AuditService } from "../services/audit-service.js";
import { paneLooksBusy } from "../tmux/tmux-busy.js";
import { TMUX_NAMED_KEYS, TmuxService } from "../tmux/tmux-service.js";
import type { McpBearerContext } from "./mcp-bearer-service.js";
import { MCP_ERROR } from "./mcp-constants.js";

export interface McpToolServices {
  tmux: TmuxService;
  audit: AuditService;
  db: DatabaseService;
}

export type McpToolResult = CallToolResult;

const SESSION_BARE = /^[a-zA-Z0-9_.-]+$/;
const SESSION_PANE = /^[a-zA-Z0-9_.-]+:[0-9]+\.[0-9]+$/;

export function mcpSessionNotFound(): McpToolResult {
  return {
    content: [{ type: "text", text: MCP_ERROR.sessionNotFound.text }],
    isError: true,
    structuredContent: { code: MCP_ERROR.sessionNotFound.code }
  };
}

export function mcpToolOk(data: Record<string, unknown>): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data
  };
}

export function parseSessionArg(raw: unknown): { sessionName: string; target: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!SESSION_BARE.test(raw) && !SESSION_PANE.test(raw)) return null;
  const colon = raw.indexOf(":");
  return { sessionName: colon === -1 ? raw : raw.slice(0, colon), target: raw };
}

function auditScopeDenied(services: McpToolServices, context: McpBearerContext, tool: string): void {
  services.audit.log({
    userId: context.grant.grantedBy,
    agentName: context.binding.clientName,
    actionType: "mcp_tool_denied",
    resourceType: "mcp_grant",
    resourceId: String(context.grant.id),
    details: { grant_id: context.grant.id, tool, reason: "scope" },
    surface: "mcp"
  });
}

function requireInScope(
  services: McpToolServices,
  context: McpBearerContext,
  tool: string,
  session: unknown
): { sessionName: string; target: string } | null {
  const parsed = parseSessionArg(session);
  if (!parsed || !context.effectiveScope.includes(parsed.sessionName)) {
    auditScopeDenied(services, context, tool);
    return null;
  }
  return parsed;
}

export async function listSessions(
  context: McpBearerContext,
  services: McpToolServices
): Promise<McpToolResult> {
  const allowed = new Set(context.effectiveScope);
  const panes = await services.tmux.listPanes();
  const grouped = new Map<string, typeof panes>();
  for (const pane of panes) {
    if (!allowed.has(pane.session)) continue;
    const existing = grouped.get(pane.session) ?? [];
    existing.push(pane);
    grouped.set(pane.session, existing);
  }

  const sessions = [];
  for (const name of context.effectiveScope) {
    const sessionPanes = grouped.get(name);
    if (!sessionPanes || sessionPanes.length === 0) continue;
    let busy = false;
    for (const pane of sessionPanes) {
      try {
        if (paneLooksBusy(await services.tmux.peekPane(pane.target, 40))) busy = true;
      } catch {
        /* idle if peek fails — same as the web sessions route */
      }
    }
    const dbSession = services.db
      .prepare("SELECT project_id FROM tmux_sessions WHERE session_name = ? AND status = 'active'")
      .get(name) as { project_id: number | null } | undefined;
    const lastActivity = sessionPanes.reduce(
      (max, pane) => Math.max(max, pane.activity ?? 0),
      0
    );
    sessions.push({
      session: name,
      panes: sessionPanes.map((pane) => ({
        target: pane.target,
        title: pane.title,
        command: pane.command
      })),
      busy,
      project_id: dbSession?.project_id ?? null,
      last_activity: lastActivity
    });
  }

  services.audit.log({
    userId: context.grant.grantedBy,
    agentName: context.binding.clientName,
    actionType: "mcp_list_sessions",
    resourceType: "mcp_grant",
    resourceId: String(context.grant.id),
    details: { grant_id: context.grant.id, count: sessions.length },
    surface: "mcp"
  });
  return mcpToolOk({ sessions });
}

export async function readSession(
  context: McpBearerContext,
  services: McpToolServices,
  args: { session?: unknown; lines?: unknown; raw?: unknown }
): Promise<McpToolResult> {
  const scoped = requireInScope(services, context, "read_session", args.session);
  if (!scoped) return mcpSessionNotFound();

  const linesRaw = args.lines;
  const lines =
    typeof linesRaw === "number" && Number.isInteger(linesRaw)
      ? Math.max(20, Math.min(linesRaw, 2000))
      : 200;
  const raw = args.raw === true;
  const output = raw
    ? await services.tmux.capturePane(scoped.target, lines)
    : await services.tmux.peekPane(scoped.target, lines);

  services.audit.log({
    userId: context.grant.grantedBy,
    agentName: context.binding.clientName,
    actionType: "mcp_read_session",
    resourceType: "mcp_grant",
    resourceId: String(context.grant.id),
    details: { grant_id: context.grant.id, lines, raw },
    tmuxTarget: scoped.target,
    surface: "mcp"
  });
  return mcpToolOk({
    session: scoped.sessionName,
    target: scoped.target,
    output,
    lines
  });
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export async function sendMessage(
  context: McpBearerContext,
  services: McpToolServices,
  args: { session?: unknown; text?: unknown; press_enter?: unknown }
): Promise<McpToolResult> {
  const scoped = requireInScope(services, context, "send_message", args.session);
  if (!scoped) return mcpSessionNotFound();

  const text = typeof args.text === "string" ? args.text.trim() : "";
  if (!text || text.length > 8000 || CONTROL_CHARS.test(text)) {
    return {
      content: [{ type: "text", text: MCP_ERROR.toolDenied.text }],
      isError: true,
      structuredContent: { code: MCP_ERROR.toolDenied.code }
    };
  }
  const pressEnter = args.press_enter !== false;

  const auditId = services.audit.log({
    userId: context.grant.grantedBy,
    agentName: context.binding.clientName,
    actionType: "mcp_send_message",
    resourceType: "mcp_grant",
    resourceId: String(context.grant.id),
    details: { grant_id: context.grant.id, text_length: text.length },
    tmuxTarget: scoped.target,
    surface: "mcp"
  });

  const result = await services.tmux.sendCommand(scoped.target, text, pressEnter, false);
  services.audit.completeAudit(auditId, {
    blocked: result.blocked === true,
    pattern: result.safetyCheck?.pattern?.pattern ?? null,
    submitted: result.blocked !== true
  });

  if (result.blocked) {
    const pattern = result.safetyCheck?.pattern?.pattern ?? "blocked";
    return {
      content: [{ type: "text", text: `Command blocked by safety pattern: ${pattern}` }],
      isError: true,
      structuredContent: { blocked: true, pattern }
    };
  }
  return mcpToolOk({ submitted: true, message: result.message });
}

export async function sendKeys(
  context: McpBearerContext,
  services: McpToolServices,
  args: { session?: unknown; keys?: unknown }
): Promise<McpToolResult> {
  const scoped = requireInScope(services, context, "send_keys", args.session);
  if (!scoped) return mcpSessionNotFound();

  const keys = Array.isArray(args.keys) ? args.keys.map(String) : [];
  if (keys.length === 0 || keys.length > 64 || keys.some((key) => !TMUX_NAMED_KEYS.has(key))) {
    return {
      content: [{ type: "text", text: MCP_ERROR.toolDenied.text }],
      isError: true,
      structuredContent: { code: MCP_ERROR.toolDenied.code }
    };
  }

  const auditId = services.audit.log({
    userId: context.grant.grantedBy,
    agentName: context.binding.clientName,
    actionType: "mcp_send_keys",
    resourceType: "mcp_grant",
    resourceId: String(context.grant.id),
    details: { grant_id: context.grant.id, keys },
    tmuxTarget: scoped.target,
    surface: "mcp"
  });

  const result = await services.tmux.sendNamedKeys(scoped.target, keys);
  services.audit.completeAudit(auditId, { submitted: true, blocked: false });
  return mcpToolOk({ message: result.message });
}
