import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { SafetyService } from "../../src/services/safety-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-safety.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("SafetyService", () => {
  let db: DatabaseService;
  let safety: SafetyService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    safety = new SafetyService(db);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("blocks commands matching default patterns", () => {
    expect(safety.checkCommand("rm -rf /").blocked).toBe(true);
    expect(safety.checkCommand("sudo kill -9 1234").blocked).toBe(true);
    expect(safety.checkCommand("chmod 777 /etc/passwd").blocked).toBe(true);
  });

  it("allows safe commands", () => {
    expect(safety.checkCommand("ls -la").blocked).toBe(false);
    expect(safety.checkCommand("npm run test").blocked).toBe(false);
    expect(safety.checkCommand("git status").blocked).toBe(false);
  });

  it("respects pattern toggle", () => {
    const patterns = safety.listPatterns();
    // Disable both rm patterns to test toggle
    const rmRfPattern = patterns.find((p) => p.pattern === "rm -rf")!;
    const rmRPattern = patterns.find((p) => p.pattern === "rm -r")!;

    safety.updatePattern(rmRfPattern.id, { active: false });
    safety.updatePattern(rmRPattern.id, { active: false });
    expect(safety.checkCommand("rm -rf /tmp").blocked).toBe(false);

    safety.updatePattern(rmRfPattern.id, { active: true });
    expect(safety.checkCommand("rm -rf /tmp").blocked).toBe(true);
  });

  it("supports regex patterns", () => {
    safety.addPattern("^sudo\\s", "Sudo commands", true);
    expect(safety.checkCommand("sudo apt update").blocked).toBe(true);
    expect(safety.checkCommand("using sudo in a sentence").blocked).toBe(false);
  });

  it("CRUD operations work", () => {
    const p = safety.addPattern("test-pattern", "Test", false);
    expect(p.pattern).toBe("test-pattern");

    const updated = safety.updatePattern(p.id, { description: "Updated" });
    expect(updated?.description).toBe("Updated");

    const deleted = safety.deletePattern(p.id);
    expect(deleted).toBe(true);

    const deletedAgain = safety.deletePattern(p.id);
    expect(deletedAgain).toBe(false);
  });
});
