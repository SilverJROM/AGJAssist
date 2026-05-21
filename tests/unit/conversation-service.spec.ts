import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";
import { ConversationService } from "../../src/services/conversation-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-conversation.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("ConversationService", () => {
  let db: DatabaseService;
  let service: ConversationService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    db.ensureOwner(111);
    db.prepare("INSERT INTO projects (directory_name) VALUES ('testproj')").run();

    const audit = new AuditService(db);
    service = new ConversationService(db, audit);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("creates a conversation", () => {
    const conv = service.create("claude", 1, 1);
    expect(conv.agent_name).toBe("claude");
    expect(conv.project_id).toBe(1);
    expect(conv.messages).toEqual([]);
  });

  it("creates a conversation with initial message", () => {
    const conv = service.create("claude", 1, 1, "Hello agent");
    expect(conv.messages.length).toBe(1);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].content).toBe("Hello agent");
  });

  it("adds messages to conversation", () => {
    const conv = service.create("claude", 1);
    service.addMessage(conv.id, {
      role: "user",
      content: "What is the status?",
      timestamp: new Date().toISOString()
    });
    const updated = service.addMessage(conv.id, {
      role: "assistant",
      content: "All systems operational.",
      timestamp: new Date().toISOString()
    });

    expect(updated!.messages.length).toBe(2);
    expect(updated!.messages[0].role).toBe("user");
    expect(updated!.messages[1].role).toBe("assistant");
  });

  it("lists conversations with filters", () => {
    service.create("claude", 1, 1);
    service.create("codex", 1, 1);
    service.create("claude", 1);

    const all = service.list();
    expect(all.length).toBe(3);

    const claudeOnly = service.list({ agentName: "claude" });
    expect(claudeOnly.length).toBe(2);

    const projectOnly = service.list({ projectId: 1 });
    expect(projectOnly.length).toBe(2);
  });

  it("deletes a conversation", () => {
    const conv = service.create("claude", 1);
    expect(service.delete(conv.id)).toBe(true);
    expect(service.getById(conv.id)).toBeNull();
  });

  it("returns null for non-existent conversation", () => {
    expect(service.getById(999)).toBeNull();
    expect(service.addMessage(999, {
      role: "user",
      content: "test",
      timestamp: new Date().toISOString()
    })).toBeNull();
  });
});
