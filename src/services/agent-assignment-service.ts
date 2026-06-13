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
