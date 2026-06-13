import { DatabaseService } from "../db/database.js";

export const AGENT_PROVIDERS = ["claude", "codex", "grok"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_ROLES = [
  "projcore",
  "coord",
  "implementer",
  "validator",
  "deliberation_1",
  "deliberation_2",
  "deliberation_3",
  "redteam_1",
  "redteam_2",
  "redteam_3"
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export interface AgentDefinition {
  id: number;
  name: string;
  provider: AgentProvider;
  model: string;
  default_effort: string;
  created_at: string;
  updated_at: string;
}

export interface RoleBinding {
  id: number;
  project_id: number;
  role: AgentRole;
  agent_id: number;
  created_at: string;
  updated_at: string;
}

export interface RoleDefault {
  role: AgentRole;
  agent_id: number;
  updated_at: string;
}

export interface RoleBindingWithAgent extends RoleBinding {
  agent: AgentDefinition;
}

export interface RoleDefaultWithAgent extends RoleDefault {
  agent: AgentDefinition;
}

export interface ResolvedRoleAgent {
  source: "binding" | "default";
  agent: AgentDefinition;
}

export interface AgentSetupImportResult {
  agents: number;
  role_defaults: number;
  role_bindings: number;
}

export class AgentAssignmentService {
  constructor(private readonly db: DatabaseService) {}

  listAgents(): AgentDefinition[] {
    return this.db.prepare("SELECT * FROM agents ORDER BY name").all() as AgentDefinition[];
  }

  getAgent(id: number): AgentDefinition | null {
    return (
      (this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentDefinition | undefined) ??
      null
    );
  }

  createAgent(input: {
    name: string;
    provider: string;
    model: string;
    default_effort?: string;
  }): AgentDefinition {
    const name = requireText(input.name, "name");
    const provider = requireProvider(input.provider);
    const model = requireText(input.model, "model");
    const defaultEffort = normalizeEffort(input.default_effort);

    return this.db
      .prepare(
        `INSERT INTO agents (name, provider, model, default_effort)
         VALUES (?, ?, ?, ?)
         RETURNING *`
      )
      .get(name, provider, model, defaultEffort) as AgentDefinition;
  }

  updateAgent(
    id: number,
    updates: { name?: string; provider?: string; model?: string; default_effort?: string }
  ): AgentDefinition | null {
    const existing = this.getAgent(id);
    if (!existing) return null;

    const name = updates.name !== undefined ? requireText(updates.name, "name") : existing.name;
    const provider =
      updates.provider !== undefined ? requireProvider(updates.provider) : existing.provider;
    const model = updates.model !== undefined ? requireText(updates.model, "model") : existing.model;
    const defaultEffort =
      updates.default_effort !== undefined
        ? normalizeEffort(updates.default_effort)
        : existing.default_effort;

    this.db
      .prepare(
        `UPDATE agents
         SET name = ?, provider = ?, model = ?, default_effort = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(name, provider, model, defaultEffort, id);

    return this.getAgent(id);
  }

  deleteAgent(id: number): boolean {
    const result = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    return result.changes > 0;
  }

  listProjectBindings(projectId: number): RoleBindingWithAgent[] {
    return this.db
      .prepare(
        `SELECT rb.*, a.id AS agent_id_join, a.name, a.provider, a.model, a.default_effort,
                a.created_at AS agent_created_at, a.updated_at AS agent_updated_at
         FROM role_bindings rb
         JOIN agents a ON a.id = rb.agent_id
         WHERE rb.project_id = ?
         ORDER BY rb.role`
      )
      .all(projectId)
      .map(rowToBindingWithAgent);
  }

  getProjectBinding(projectId: number, roleInput: string): RoleBindingWithAgent | null {
    const role = requireRole(roleInput);
    const row = this.db
      .prepare(
        `SELECT rb.*, a.id AS agent_id_join, a.name, a.provider, a.model, a.default_effort,
                a.created_at AS agent_created_at, a.updated_at AS agent_updated_at
         FROM role_bindings rb
         JOIN agents a ON a.id = rb.agent_id
         WHERE rb.project_id = ? AND rb.role = ?`
      )
      .get(projectId, role);
    return row ? rowToBindingWithAgent(row) : null;
  }

  setProjectBinding(projectId: number, roleInput: string, agentId: number): RoleBindingWithAgent {
    const role = requireRole(roleInput);
    this.db
      .prepare(
        `INSERT INTO role_bindings (project_id, role, agent_id)
         VALUES (?, ?, ?)
         ON CONFLICT(project_id, role) DO UPDATE SET
           agent_id = excluded.agent_id,
           updated_at = datetime('now')`
      )
      .run(projectId, role, agentId);

    const binding = this.getProjectBinding(projectId, role);
    if (!binding) {
      throw new Error("role binding was not persisted");
    }
    return binding;
  }

  clearProjectBinding(projectId: number, roleInput: string): boolean {
    const role = requireRole(roleInput);
    const result = this.db
      .prepare("DELETE FROM role_bindings WHERE project_id = ? AND role = ?")
      .run(projectId, role);
    return result.changes > 0;
  }

  listRoleDefaults(): RoleDefaultWithAgent[] {
    return this.db
      .prepare(
        `SELECT rd.*, a.id AS agent_id_join, a.name, a.provider, a.model, a.default_effort,
                a.created_at AS agent_created_at, a.updated_at AS agent_updated_at
         FROM role_defaults rd
         JOIN agents a ON a.id = rd.agent_id
         ORDER BY rd.role`
      )
      .all()
      .map(rowToDefaultWithAgent);
  }

  getRoleDefault(roleInput: string): RoleDefaultWithAgent | null {
    const role = requireRole(roleInput);
    const row = this.db
      .prepare(
        `SELECT rd.*, a.id AS agent_id_join, a.name, a.provider, a.model, a.default_effort,
                a.created_at AS agent_created_at, a.updated_at AS agent_updated_at
         FROM role_defaults rd
         JOIN agents a ON a.id = rd.agent_id
         WHERE rd.role = ?`
      )
      .get(role);
    return row ? rowToDefaultWithAgent(row) : null;
  }

  setRoleDefault(roleInput: string, agentId: number): RoleDefaultWithAgent {
    const role = requireRole(roleInput);
    this.db
      .prepare(
        `INSERT INTO role_defaults (role, agent_id)
         VALUES (?, ?)
         ON CONFLICT(role) DO UPDATE SET
           agent_id = excluded.agent_id,
           updated_at = datetime('now')`
      )
      .run(role, agentId);

    const roleDefault = this.getRoleDefault(role);
    if (!roleDefault) {
      throw new Error("role default was not persisted");
    }
    return roleDefault;
  }

  resolveProjectRole(projectId: number, roleInput: string): ResolvedRoleAgent | null {
    const role = requireRole(roleInput);
    const binding = this.getProjectBinding(projectId, role);
    if (binding) {
      return { source: "binding", agent: binding.agent };
    }

    const roleDefault = this.getRoleDefault(role);
    if (roleDefault) {
      return { source: "default", agent: roleDefault.agent };
    }

    return null;
  }

  exportMarkdown(): string {
    const agents = this.listAgents();
    const defaults = this.listRoleDefaults();
    const bindings = this.db
      .prepare(
        `SELECT rb.project_id, rb.role, a.name AS agent_name
         FROM role_bindings rb
         JOIN agents a ON a.id = rb.agent_id
         ORDER BY rb.project_id, rb.role`
      )
      .all() as { project_id: number; role: AgentRole; agent_name: string }[];

    const lines = [
      "# Agent Setup Export",
      "",
      "version: 1",
      "",
      "## Agents",
      "| name | provider | model | default_effort |",
      "| --- | --- | --- | --- |",
      ...agents.map((agent) =>
        tableRow([agent.name, agent.provider, agent.model, agent.default_effort])
      ),
      "",
      "## Role Defaults",
      "| role | agent |",
      "| --- | --- |",
      ...defaults.map((roleDefault) => tableRow([roleDefault.role, roleDefault.agent.name])),
      "",
      "## Project Role Bindings",
      "| project_id | role | agent |",
      "| --- | --- | --- |",
      ...bindings.map((binding) =>
        tableRow([String(binding.project_id), binding.role, binding.agent_name])
      ),
      ""
    ];

    return lines.join("\n");
  }

  importMarkdown(markdown: string): AgentSetupImportResult {
    const setup = parseAgentSetupMarkdown(markdown);

    return this.db.transaction(() => {
      const agentIds = new Map<string, number>();

      for (const agent of setup.agents) {
        const persisted = this.db
          .prepare(
            `INSERT INTO agents (name, provider, model, default_effort)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
               provider = excluded.provider,
               model = excluded.model,
               default_effort = excluded.default_effort,
               updated_at = datetime('now')
             RETURNING id`
          )
          .get(agent.name, agent.provider, agent.model, agent.default_effort) as { id: number };
        agentIds.set(agent.name, persisted.id);
      }

      for (const roleDefault of setup.roleDefaults) {
        const agentId = agentIds.get(roleDefault.agent);
        if (!agentId) {
          throw new Error(`unknown agent '${roleDefault.agent}' in role default ${roleDefault.role}`);
        }
        this.setRoleDefault(roleDefault.role, agentId);
      }

      for (const binding of setup.roleBindings) {
        const agentId = agentIds.get(binding.agent);
        if (!agentId) {
          throw new Error(
            `unknown agent '${binding.agent}' in project ${binding.project_id} role ${binding.role}`
          );
        }
        this.setProjectBinding(binding.project_id, binding.role, agentId);
      }

      return {
        agents: setup.agents.length,
        role_defaults: setup.roleDefaults.length,
        role_bindings: setup.roleBindings.length
      };
    });
  }
}

interface ParsedAgentSetup {
  agents: Array<{
    name: string;
    provider: AgentProvider;
    model: string;
    default_effort: string;
  }>;
  roleDefaults: Array<{
    role: AgentRole;
    agent: string;
  }>;
  roleBindings: Array<{
    project_id: number;
    role: AgentRole;
    agent: string;
  }>;
}

function requireText(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function normalizeEffort(value: string | undefined): string {
  return requireText(value || "medium", "default_effort");
}

function requireProvider(value: string): AgentProvider {
  if ((AGENT_PROVIDERS as readonly string[]).includes(value)) {
    return value as AgentProvider;
  }
  throw new Error("provider must be claude, codex, or grok");
}

function requireRole(value: string): AgentRole {
  if ((AGENT_ROLES as readonly string[]).includes(value)) {
    return value as AgentRole;
  }
  throw new Error("role is invalid");
}

function parseAgentSetupMarkdown(markdown: string): ParsedAgentSetup {
  const sections = splitSections(markdown);
  const agentRows = parseTable(sections.get("Agents") ?? "", [
    "name",
    "provider",
    "model",
    "default_effort"
  ]);
  const defaultRows = parseTable(sections.get("Role Defaults") ?? "", ["role", "agent"]);
  const bindingRows = parseTable(sections.get("Project Role Bindings") ?? "", [
    "project_id",
    "role",
    "agent"
  ]);

  return {
    agents: agentRows.map((row) => ({
      name: requireText(row.name, "agent name"),
      provider: requireProvider(requireText(row.provider, "provider")),
      model: requireText(row.model, "model"),
      default_effort: normalizeEffort(row.default_effort)
    })),
    roleDefaults: defaultRows.map((row) => ({
      role: requireRole(requireText(row.role, "role")),
      agent: requireText(row.agent, "agent")
    })),
    roleBindings: bindingRows.map((row) => ({
      project_id: parseProjectId(row.project_id),
      role: requireRole(requireText(row.role, "role")),
      agent: requireText(row.agent, "agent")
    }))
  };
}

function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) {
        sections.set(current, buffer.join("\n"));
      }
      current = match[1];
      buffer = [];
      continue;
    }

    if (current) {
      buffer.push(line);
    }
  }

  if (current) {
    sections.set(current, buffer.join("\n"));
  }

  return sections;
}

function parseTable(section: string, expectedHeaders: string[]): Array<Record<string, string>> {
  const rows = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (rows.length === 0) {
    return [];
  }
  if (rows.length === 1) {
    throw new Error(`markdown table '${expectedHeaders.join(", ")}' is missing a separator row`);
  }

  const headers = splitTableRow(rows[0]);
  if (headers.join("\0") !== expectedHeaders.join("\0")) {
    throw new Error(`markdown table headers must be: ${expectedHeaders.join(", ")}`);
  }

  if (!isSeparatorRow(splitTableRow(rows[1]))) {
    throw new Error(`markdown table '${expectedHeaders.join(", ")}' has an invalid separator row`);
  }

  return rows.slice(2).map((row) => {
    const cells = splitTableRow(row);
    if (cells.length !== expectedHeaders.length) {
      throw new Error(`markdown table row must have ${expectedHeaders.length} cells`);
    }

    return Object.fromEntries(expectedHeaders.map((header, index) => [header, cells[index]]));
  });
}

function splitTableRow(row: string): string[] {
  const trimmed = row.trim();
  const content = trimmed.slice(1, -1);
  const cells: string[] = [];
  let cell = "";
  let escaped = false;

  for (const char of content) {
    if (escaped) {
      cell += char === "n" ? "\n" : char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }

  if (escaped) {
    cell += "\\";
  }

  cells.push(cell.trim());
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseProjectId(value: string | undefined): number {
  const text = requireText(value, "project_id");
  if (!/^\d+$/.test(text)) {
    throw new Error("project_id must be a positive integer");
  }
  const projectId = Number(text);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("project_id must be a positive integer");
  }
  return projectId;
}

function tableRow(cells: string[]): string {
  return `| ${cells.map(escapeTableCell).join(" | ")} |`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "\\n");
}

function rowToAgent(row: Record<string, unknown>): AgentDefinition {
  return {
    id: Number(row.agent_id_join),
    name: String(row.name),
    provider: row.provider as AgentProvider,
    model: String(row.model),
    default_effort: String(row.default_effort),
    created_at: String(row.agent_created_at),
    updated_at: String(row.agent_updated_at)
  };
}

function rowToBindingWithAgent(row: unknown): RoleBindingWithAgent {
  const r = row as Record<string, unknown>;
  return {
    id: Number(r.id),
    project_id: Number(r.project_id),
    role: r.role as AgentRole,
    agent_id: Number(r.agent_id),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    agent: rowToAgent(r)
  };
}

function rowToDefaultWithAgent(row: unknown): RoleDefaultWithAgent {
  const r = row as Record<string, unknown>;
  return {
    role: r.role as AgentRole,
    agent_id: Number(r.agent_id),
    updated_at: String(r.updated_at),
    agent: rowToAgent(r)
  };
}
