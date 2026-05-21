import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AssistantCore } from "../src/bot/assistant-core.js";
import { AppConfig } from "../src/config/config.js";
import { DatabaseService } from "../src/db/database.js";
import { OvermindService } from "../src/services/overmind-service.js";

const TEST_DB = path.join("data", "test-overmind-commands.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function testConfig(): AppConfig {
  return {
    telegram: {
      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      authorizedUserId: 111222,
      testMode: true
    },
    llm: {
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "test",
      ollamaTimeoutMs: 1000,
      openrouterApiKey: "test",
      openrouterBaseUrl: "https://openrouter.ai/api/v1",
      openrouterModel: "test",
      openrouterTimeoutMs: 1000
    },
    runtime: {
      workspaceRoot: "/tmp",
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1
    },
    api: {
      port: 0,
      host: "127.0.0.1",
      jwtSecret: "test-secret",
      sessionExpiryHours: 24
    },
    db: {
      path: TEST_DB
    },
    projects: {
      root: "/tmp"
    },
    tmux: {
      historyRetentionDays: 7,
      outputBufferLines: 5000,
      streamIntervalMs: 100
    },
    overmind: {
      token: "ovm-test-token"
    }
  };
}

function createCore(overmindService: OvermindService): AssistantCore {
  const ollamaProvider = {
    getModel: () => "qwek32k:latest",
    setModel: () => {}
  };
  const core = new AssistantCore(
    testConfig(),
    {} as any,
    {} as any,
    ollamaProvider as any,
    {} as any,
    {} as any
  );
  core.setOvermindService(overmindService);
  return core;
}

let db: DatabaseService;
let service: OvermindService;
let core: AssistantCore;

beforeEach(() => {
  cleanup();
  db = new DatabaseService(TEST_DB);
  service = new OvermindService(db);
  core = createCore(service);
});

afterEach(() => {
  db.close();
  cleanup();
});

describe("Overmind Telegram commands", () => {
  it("formats active workflow status rows with icons, current task, and task counts", async () => {
    const first = service.register({
      label: "Build QA",
      coordinator_session: "build-qa:0.0",
      child_sessions: ["build-worker:0.0"],
      run_dir: "/tmp/build-qa",
      current_task: "A4 commands",
      tasks: [
        { id: "A1", label: "Schema", state: "done" },
        { id: "A4", label: "Commands", state: "processing" },
        { id: "A5", label: "Nudge", state: "pending" }
      ]
    });
    service.setStatus(first.id, "working");

    const second = service.register({
      label: "Blocked run",
      coordinator_session: "blocked-run:0.0",
      run_dir: "/tmp/blocked-run",
      tasks: [{ id: "B1", label: "Clarify", state: "pending" }]
    });
    service.setStatus(second.id, "waiting_human");

    const completed = service.register({
      label: "Old run",
      coordinator_session: "old-run:0.0",
      run_dir: "/tmp/old-run"
    });
    service.setStatus(completed.id, "completed");

    const result = await core.handleCommand("/overmind");

    expect(result).toContain('Build QA ▶ working · "A4 commands" · 1/3');
    expect(result).toContain('Blocked run ⏸ waiting_human · "—" · 0/1');
    expect(result).not.toContain("Old run");
  });

  it("renders a full tasklist and validates unknown or missing ids", async () => {
    const workflow = service.register({
      label: "Task run",
      coordinator_session: "task-run:0.0",
      run_dir: "/tmp/task-run",
      current_task: "Implement",
      tasks: [
        { id: "A1", label: "Done task", state: "done" },
        { id: "A2", label: "Processing task", state: "processing" },
        { id: "A3", label: "Pending task", state: "pending" }
      ]
    });

    await expect(core.handleCommand("/om_tasks")).resolves.toBe("Usage: /om_tasks <id>");
    await expect(core.handleCommand("/om_tasks nope")).resolves.toBe("Usage: /om_tasks <id>");
    await expect(core.handleCommand("/om_tasks 9999")).resolves.toBe("Workflow not found: 9999");

    const result = await core.handleCommand(`/om_tasks ${workflow.id}`);
    expect(result).toBe(
      [
        "Task run • active",
        "[x] Done task",
        "[~] Processing task",
        "[ ] Pending task"
      ].join("\n")
    );
  });

  it("pauses, resumes, drops workflows, and reports empty status", async () => {
    const workflow = service.register({
      label: "Mutable run",
      coordinator_session: "mutable-run:0.0",
      run_dir: "/tmp/mutable-run"
    });

    await expect(core.handleCommand(`/om_pause ${workflow.id}`)).resolves.toBe(
      `Paused workflow ${workflow.id}: Mutable run`
    );
    expect(service.get(workflow.id)?.status).toBe("paused");

    await expect(core.handleCommand(`/om_resume ${workflow.id}`)).resolves.toBe(
      `Resumed workflow ${workflow.id}: Mutable run`
    );
    expect(service.get(workflow.id)?.status).toBe("active");

    await expect(core.handleCommand(`/om_drop ${workflow.id}`)).resolves.toBe(
      `Dropped workflow ${workflow.id}: Mutable run`
    );
    expect(service.get(workflow.id)).toBeNull();
    await expect(core.handleCommand("/overmind")).resolves.toBe("No active workflows.");
  });
});
