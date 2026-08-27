import { DatabaseService } from "../db/database.js";

export interface SummaryEndpoint {
  id: number;
  name: string;
  base_url: string;
  model: string;
  is_default: number;
  provenance: string;
  created_at: string;
  updated_at: string;
}

export interface CreateEndpointInput {
  name: string;
  base_url: string;
  model: string;
  provenance?: string;
}

export interface UpdateEndpointInput {
  name?: string;
  base_url?: string;
  model?: string;
}

/**
 * SummaryEndpointService
 * Owner-scoped CRUD for summary LLM endpoints.
 * Secrets are never logged — only endpoint metadata is returned.
 */
export class SummaryEndpointService {
  constructor(private readonly db: DatabaseService) {}

  list(): SummaryEndpoint[] {
    return this.db.prepare(
      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints ORDER BY id ASC"
    ).all() as SummaryEndpoint[];
  }

  getById(id: number): SummaryEndpoint | null {
    const row = this.db.prepare(
      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints WHERE id = ?"
    ).get(id) as SummaryEndpoint | undefined;
    return row ?? null;
  }

  getByName(name: string): SummaryEndpoint | null {
    const row = this.db.prepare(
      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints WHERE name = ?"
    ).get(name) as SummaryEndpoint | undefined;
    return row ?? null;
  }

  getDefault(): SummaryEndpoint | null {
    const row = this.db.prepare(
      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints WHERE is_default = 1 LIMIT 1"
    ).get() as SummaryEndpoint | undefined;
    return row ?? null;
  }

  create(input: CreateEndpointInput): SummaryEndpoint {
    const provenance = input.provenance ?? "user";
    // Avoid logging secrets — base_url may be sensitive context, so we only log name
    const result = this.db.prepare(
      `INSERT INTO summary_llm_endpoints (name, base_url, model, is_default, provenance)
       VALUES (?, ?, ?, 0, ?)
       RETURNING id, name, base_url, model, is_default, provenance, created_at, updated_at`
    ).get(input.name, input.base_url, input.model, provenance) as SummaryEndpoint;
    return result;
  }

  update(id: number, input: UpdateEndpointInput): SummaryEndpoint | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const name = input.name ?? existing.name;
    const base_url = input.base_url ?? existing.base_url;
    const model = input.model ?? existing.model;

    this.db.prepare(
      `UPDATE summary_llm_endpoints
       SET name = ?, base_url = ?, model = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(name, base_url, model, id);

    return this.getById(id);
  }

  remove(id: number): boolean {
    const existing = this.getById(id);
    if (!existing) return false;
    // Prevent removal of the default endpoint to avoid orphaned default state
    if (existing.is_default === 1) {
      // If the default is being removed, clear default flag first
      // Caller should set a new default before removal in production
      // For safety, we refuse to delete the default
      return false;
    }
    const res = this.db.prepare("DELETE FROM summary_llm_endpoints WHERE id = ?").run(id);
    return res.changes > 0;
  }

  setDefault(id: number): SummaryEndpoint | null {
    const target = this.getById(id);
    if (!target) return null;

    // Ensure only one default exists
    this.db.prepare("UPDATE summary_llm_endpoints SET is_default = 0 WHERE is_default = 1").run();
    this.db.prepare("UPDATE summary_llm_endpoints SET is_default = 1, updated_at = datetime('now') WHERE id = ?").run(id);

    return this.getById(id);
  }
}
