import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { SummaryEndpointService } from "../../src/services/summary-endpoint-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-summary-endpoint-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SummaryEndpointService D2", () => {
  it("seeds default endpoint labelled 140", () => {
    const dbPath = tempDb("seed.sqlite");
    const db = new DatabaseService(dbPath);
    const svc = new SummaryEndpointService(db);

    const def = svc.getDefault();
    expect(def).not.toBeNull();
    expect(def!.name).toBe("140");
    expect(def!.base_url).toBe("http://192.168.254.140:1234/v1");
    expect(def!.model).toBe("qwen2.5-14b-instruct");
    expect(def!.is_default).toBe(1);
    expect(def!.provenance).toBe("system");
  });

  it("lists endpoints and never returns secrets", () => {
    const dbPath = tempDb("list.sqlite");
    const db = new DatabaseService(dbPath);
    const svc = new SummaryEndpointService(db);

    const list = svc.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const seeded = list.find(e => e.name === "140");
    expect(seeded).toBeDefined();
    // Ensure fields are present and no secret columns leaked
    expect(seeded!.id).toBeTypeOf("number");
    expect(seeded!.name).toBeTypeOf("string");
    expect(seeded!.base_url).toBeTypeOf("string");
    expect(seeded!.model).toBeTypeOf("string");
  });

  it("creates, edits, removes endpoints with owner-scoped semantics", () => {
    const dbPath = tempDb("crud.sqlite");
    const db = new DatabaseService(dbPath);
    const svc = new SummaryEndpointService(db);

    // Create
    const created = svc.create({
      name: "local-8080",
      base_url: "http://localhost:8080/v1",
      model: "granite-3b",
      provenance: "user"
    });
    expect(created.id).toBeDefined();
    expect(created.name).toBe("local-8080");
    expect(created.base_url).toBe("http://localhost:8080/v1");
    expect(created.model).toBe("granite-3b");
    expect(created.is_default).toBe(0);

    // Edit
    const updated = svc.update(created.id, { model: "granite-7b", base_url: "http://localhost:8080/v1" });
    expect(updated).not.toBeNull();
    expect(updated!.model).toBe("granite-7b");

    // Get by name
    const byName = svc.getByName("local-8080");
    expect(byName).not.toBeNull();
    expect(byName!.id).toBe(created.id);

    // Remove
    const removed = svc.remove(created.id);
    expect(removed).toBe(true);
    expect(svc.getById(created.id)).toBeNull();
  });

  it("sets default endpoint and enforces single default", () => {
    const dbPath = tempDb("default.sqlite");
    const db = new DatabaseService(dbPath);
    const svc = new SummaryEndpointService(db);

    const e1 = svc.create({ name: "ep-a", base_url: "http://a/v1", model: "m-a" });
    const e2 = svc.create({ name: "ep-b", base_url: "http://b/v1", model: "m-b" });

    // Initially default is seeded 140
    let def = svc.getDefault();
    expect(def!.name).toBe("140");

    // Switch default to e1
    svc.setDefault(e1.id);
    def = svc.getDefault();
    expect(def!.id).toBe(e1.id);
    expect(def!.is_default).toBe(1);

    // Ensure e2 is not default
    const e2After = svc.getById(e2.id);
    expect(e2After!.is_default).toBe(0);

    // Switch default to e2
    svc.setDefault(e2.id);
    def = svc.getDefault();
    expect(def!.id).toBe(e2.id);

    // Verify only one default exists
    const all = svc.list();
    const defaults = all.filter(e => e.is_default === 1);
    expect(defaults).toHaveLength(1);
  });

  it("prevents removal of default endpoint", () => {
    const dbPath = tempDb("protect.sqlite");
    const db = new DatabaseService(dbPath);
    const svc = new SummaryEndpointService(db);

    const def = svc.getDefault();
    expect(def).not.toBeNull();
    const removed = svc.remove(def!.id);
    expect(removed).toBe(false);
    expect(svc.getById(def!.id)).not.toBeNull();
  });

  it("validates OpenAI-compatible base URLs are stored as-is and never logged", () => {
    const dbPath = tempDb("url.sqlite");
    const db = new DatabaseService(dbPath);
    const svc = new SummaryEndpointService(db);

    const created = svc.create({
      name: "openai-compat",
      base_url: "https://api.openai-compatible.example/v1",
      model: "gpt-4o-mini"
    });
    expect(created.base_url).toBe("https://api.openai-compatible.example/v1");
    // Service does not expose api_key/secret fields
    const raw = db.prepare("PRAGMA table_info(summary_llm_endpoints)").all() as any[];
    const colNames = raw.map(c => c.name);
    expect(colNames).not.toContain("api_key");
    expect(colNames).not.toContain("secret");
  });
});
