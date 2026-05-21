import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: number;
  project_id: number | null;
  agent_name: string;
  user_id: number;
  messages: string; // JSON string in DB
  created_at: string;
  updated_at: string;
}

export interface ConversationWithMessages extends Omit<Conversation, "messages"> {
  messages: Message[];
}

export class ConversationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  list(filters?: { projectId?: number; agentName?: string; userId?: number }): Conversation[] {
    let sql = "SELECT * FROM conversations WHERE 1=1";
    const params: unknown[] = [];

    if (filters?.projectId !== undefined) {
      sql += " AND project_id = ?";
      params.push(filters.projectId);
    }
    if (filters?.agentName) {
      sql += " AND agent_name = ?";
      params.push(filters.agentName);
    }
    if (filters?.userId) {
      sql += " AND user_id = ?";
      params.push(filters.userId);
    }

    sql += " ORDER BY updated_at DESC";
    return this.db.prepare(sql).all(...params) as Conversation[];
  }

  getById(id: number): ConversationWithMessages | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | null;
    if (!row) return null;
    return { ...row, messages: JSON.parse(row.messages) as Message[] };
  }

  create(
    agentName: string,
    userId: number,
    projectId?: number,
    initialMessage?: string
  ): ConversationWithMessages {
    const messages: Message[] = [];
    if (initialMessage) {
      messages.push({
        role: "user",
        content: initialMessage,
        timestamp: new Date().toISOString()
      });
    }

    const row = this.db
      .prepare(
        "INSERT INTO conversations (project_id, agent_name, user_id, messages) VALUES (?, ?, ?, ?) RETURNING *"
      )
      .get(
        projectId ?? null,
        agentName,
        userId,
        JSON.stringify(messages)
      ) as Conversation;

    this.auditService.log({
      userId,
      actionType: "conversation_create",
      resourceType: "conversation",
      resourceId: String(row.id),
      details: { agent_name: agentName, project_id: projectId }
    });

    return { ...row, messages };
  }

  addMessage(id: number, message: Message, userId?: number): ConversationWithMessages | null {
    const conv = this.getById(id);
    if (!conv) return null;

    conv.messages.push(message);

    this.db
      .prepare(
        "UPDATE conversations SET messages = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(JSON.stringify(conv.messages), id);

    this.auditService.log({
      userId,
      actionType: "conversation_message",
      resourceType: "conversation",
      resourceId: String(id),
      details: { role: message.role, agent_name: conv.agent_name }
    });

    return this.getById(id);
  }

  getCliSessionId(id: number): string | null {
    const row = this.db.prepare("SELECT cli_session_id FROM conversations WHERE id = ?").get(id) as { cli_session_id: string | null } | undefined;
    return row?.cli_session_id ?? null;
  }

  setCliSessionId(id: number, sessionId: string): void {
    this.db.prepare("UPDATE conversations SET cli_session_id = ? WHERE id = ?").run(sessionId, id);
  }

  getCwd(id: number): string | null {
    const row = this.db.prepare("SELECT cwd FROM conversations WHERE id = ?").get(id) as { cwd: string | null } | undefined;
    return row?.cwd ?? null;
  }

  setCwd(id: number, cwd: string): void {
    this.db.prepare("UPDATE conversations SET cwd = ? WHERE id = ?").run(cwd, id);
  }

  delete(id: number, userId?: number): boolean {
    const result = this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.auditService.log({
        userId,
        actionType: "conversation_delete",
        resourceType: "conversation",
        resourceId: String(id)
      });
    }
    return result.changes > 0;
  }
}
