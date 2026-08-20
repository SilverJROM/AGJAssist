import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";

let dir = "";

function makeService(): { db: DatabaseService; audit: AuditService } {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-audit-"));
  const db = new DatabaseService(path.join(dir, "test.sqlite"));
  return { db, audit: new AuditService(db) };
}

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("AuditService mcp surface", () => {
  it("inserts surface=mcp, returns the row id, filters by surface, and completeAudit merges details", () => {
    const { db, audit } = makeService();
    const id = audit.log({
      actionType: "mcp_list_sessions",
      agentName: "grok",
      surface: "mcp",
      details: { started: true }
    });
    expect(id).toBeGreaterThan(0);

    const webId = audit.log({
      actionType: "tmux_keys_send",
      surface: "web",
      details: { keys: ["Enter"] }
    });
    expect(webId).not.toBe(id);

    const mcpRows = audit.query({ surface: "mcp" });
    expect(mcpRows).toHaveLength(1);
    expect(mcpRows[0].id).toBe(id);
    expect(mcpRows[0].surface).toBe("mcp");
    expect(mcpRows[0].action_type).toBe("mcp_list_sessions");

    expect(audit.completeAudit(id, { ok: true, sessions: 2 })).toBe(true);
    const completed = audit.query({ surface: "mcp" })[0];
    const details = JSON.parse(completed.details || "{}") as Record<string, unknown>;
    expect(details).toEqual({ started: true, ok: true, sessions: 2 });

    expect(audit.completeAudit(999999, { nope: true })).toBe(false);
    expect(audit.query({ surface: "web" })).toHaveLength(1);
    db.close();
  });
});
