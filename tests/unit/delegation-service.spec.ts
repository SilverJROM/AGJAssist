import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";
import { DelegationService } from "../../src/services/delegation-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-delegation.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("DelegationService", () => {
  let db: DatabaseService;
  let delegation: DelegationService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    db.ensureOwner(111);

    // Create a project and tmux session for testing
    db.prepare("INSERT INTO projects (directory_name) VALUES ('testproj')").run();
    db.prepare(
      "INSERT INTO tmux_sessions (project_id, session_name, created_by) VALUES (1, 'test-session', 1)"
    ).run();

    const audit = new AuditService(db);
    delegation = new DelegationService(db, audit);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("grants and checks authority", () => {
    const d = delegation.grant("claude", 1, "test-session:0.0", "execute", 1);
    expect(d.authority).toBe("execute");
    expect(d.active).toBe(1);

    const level = delegation.checkAuthority("claude", "test-session:0.0");
    expect(level).toBe("execute");
  });

  it("returns null for ungranted agent", () => {
    const level = delegation.checkAuthority("unknown-agent", "test-session:0.0");
    expect(level).toBeNull();
  });

  it("revokes delegation", () => {
    const d = delegation.grant("claude", 1, null, "observe", 1);
    delegation.revoke(d.id, 1);

    const level = delegation.checkAuthority("claude", "test-session:0.0");
    expect(level).toBeNull();
  });

  it("changes authority level", () => {
    const d = delegation.grant("claude", 1, "test-session:0.0", "observe", 1);
    delegation.changeAuthority(d.id, "execute", 1);

    const level = delegation.checkAuthority("claude", "test-session:0.0");
    expect(level).toBe("execute");
  });

  it("revokes all for session", () => {
    delegation.grant("claude", 1, null, "execute", 1);
    delegation.grant("codex", 1, null, "observe", 1);

    const count = delegation.revokeAllForSession(1);
    expect(count).toBe(2);

    expect(delegation.listActive().length).toBe(0);
  });
});
