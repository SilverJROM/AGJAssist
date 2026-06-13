import { DatabaseService } from "../db/database.js";

export type AgentEventType = "message" | "status" | "tool" | "gate";
export type AgentEventSource = "callback" | "git" | "pane" | "post";

export interface AgentEventInput {
  run_id: string;
  role: string;
  batch_id: string;
  session?: string | null;
  type: AgentEventType;
  state?: string | null;
  source: AgentEventSource;
  correlation_id: string;
  body?: Record<string, unknown>;
  ts?: string;
}

export interface AgentEventRow {
  id: number;
  run_id: string;
  role: string;
  batch_id: string;
  session: string | null;
  type: AgentEventType;
  state: string | null;
  source: AgentEventSource;
  correlation_id: string;
  body: Record<string, unknown>;
  ts: string;
}

interface RawAgentEventRow extends Omit<AgentEventRow, "body"> {
  body: string;
}

export class AgentEventsService {
  constructor(private readonly db: DatabaseService) {}

  recordEvent(input: AgentEventInput): AgentEventRow {
    if (input.type === "status" && (input.state === "DONE" || input.state === "BLOCKED")) {
      return this.recordTerminalStatus(input);
    }

    const body = normalizeBody(input.body, input.source);
    const result = this.db
      .prepare(
        `INSERT INTO agent_events (
          run_id, role, batch_id, session, type, state, source, correlation_id, body, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.run_id,
        input.role,
        input.batch_id,
        input.session ?? null,
        input.type,
        input.state ?? null,
        input.source,
        input.correlation_id,
        JSON.stringify(body),
        input.ts ?? new Date().toISOString()
      );

    return this.getEventById(Number(result.lastInsertRowid));
  }

  listEvents(runId: string): AgentEventRow[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY id ASC")
      .all(runId) as RawAgentEventRow[];
    return rows.map(parseRow);
  }

  findTerminal(runId: string, batchId: string, state: string, correlationId: string): AgentEventRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM agent_events
         WHERE run_id = ? AND batch_id = ? AND state = ? AND correlation_id = ?
           AND type = 'status'
         LIMIT 1`
      )
      .get(runId, batchId, state, correlationId) as RawAgentEventRow | undefined;
    return row ? parseRow(row) : null;
  }

  private recordTerminalStatus(input: AgentEventInput): AgentEventRow {
    const existing = this.findTerminal(
      input.run_id,
      input.batch_id,
      input.state ?? "",
      input.correlation_id
    );
    if (!existing) {
      const body = normalizeBody(input.body, input.source);
      const result = this.db
        .prepare(
          `INSERT INTO agent_events (
            run_id, role, batch_id, session, type, state, source, correlation_id, body, ts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.run_id,
          input.role,
          input.batch_id,
          input.session ?? null,
          input.type,
          input.state ?? null,
          input.source,
          input.correlation_id,
          JSON.stringify(body),
          input.ts ?? new Date().toISOString()
        );
      return this.getEventById(Number(result.lastInsertRowid));
    }

    const mergedBody = mergeProvenance(existing.body, input.body, input.source);
    const mergedSession = existing.session ?? input.session ?? null;
    this.db
      .prepare("UPDATE agent_events SET body = ?, session = ? WHERE id = ?")
      .run(JSON.stringify(mergedBody), mergedSession, existing.id);
    return this.getEventById(existing.id);
  }

  private getEventById(id: number): AgentEventRow {
    const row = this.db
      .prepare("SELECT * FROM agent_events WHERE id = ?")
      .get(id) as RawAgentEventRow | undefined;
    if (!row) throw new Error(`agent_events row ${id} not found after insert`);
    return parseRow(row);
  }
}

function normalizeBody(body: Record<string, unknown> | undefined, source: AgentEventSource): Record<string, unknown> {
  return mergeProvenance({}, body, source);
}

function mergeProvenance(
  base: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
  source: AgentEventSource
): Record<string, unknown> {
  const next = { ...base, ...(incoming ?? {}) };
  const sources = new Set<AgentEventSource>();
  for (const value of Array.isArray(base.sources) ? base.sources : []) {
    if (isAgentEventSource(value)) sources.add(value);
  }
  for (const value of Array.isArray(incoming?.sources) ? incoming.sources : []) {
    if (isAgentEventSource(value)) sources.add(value);
  }
  sources.add(source);
  next.sources = Array.from(sources).sort();
  return next;
}

function isAgentEventSource(value: unknown): value is AgentEventSource {
  return value === "callback" || value === "git" || value === "pane" || value === "post";
}

function parseRow(row: RawAgentEventRow): AgentEventRow {
  return {
    ...row,
    body: parseBody(row.body)
  };
}

function parseBody(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
