import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../../src/db/database.js";
import { AgentEventIngest, GitHeadSnapshot } from "../../src/services/agent-event-ingest.js";
import { AgentEventsService } from "../../src/services/agent-events-service.js";
import { TmuxService } from "../../src/tmux/tmux-service.js";

let tmpDir: string;
let db: DatabaseService;
let gitHead: GitHeadSnapshot | null;

function runConfig() {
  return {
    runId: "run-a3",
    runDir: tmpDir,
    role: "implementer",
    batchId: "A3a",
    session: "a3a-session:0.0",
    expectedBranch: "feat/agj-upgrade-A3a-agent-events"
  };
}

function makeIngest(): { ingest: AgentEventIngest; events: AgentEventsService; tmux: TmuxService } {
  const events = new AgentEventsService(db);
  const tmux = new TmuxService();
  const ingest = new AgentEventIngest(events, tmux, {
    idleAfterActivityMs: 1000,
    gitHeadReader: async () => gitHead
  });
  return { ingest, events, tmux };
}

describe("AgentEventIngest", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-agent-events-"));
    db = new DatabaseService(path.join(tmpDir, "events.sqlite"));
    gitHead = {
      branch: "feat/agj-upgrade-A3a-agent-events",
      head: "1111111111111111111111111111111111111111"
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("normalizes a callback DONE into one status event", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "callbacks.md"),
      "[projcore callback] implementer A3a STATUS: DONE - build green\n"
    );
    const { ingest, events } = makeIngest();

    await ingest.tick(runConfig());
    await ingest.tick(runConfig());

    const rows = events.listEvents("run-a3");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: "implementer",
      batch_id: "A3a",
      type: "status",
      state: "DONE",
      source: "callback",
      correlation_id: "terminal:run-a3:A3a:DONE"
    });
    expect(rows[0].body.sources).toEqual(["callback"]);
  });

  it("derives DONE from a git HEAD advance with no callback", async () => {
    const { ingest, events } = makeIngest();

    await ingest.tick(runConfig());
    gitHead = {
      branch: "feat/agj-upgrade-A3a-agent-events",
      head: "2222222222222222222222222222222222222222"
    };
    await ingest.tick(runConfig());

    const rows = events.listEvents("run-a3");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "status",
      state: "DONE",
      source: "git",
      correlation_id: "terminal:run-a3:A3a:DONE"
    });
    expect(rows[0].body).toMatchObject({
      sources: ["git"],
      previous_head: "1111111111111111111111111111111111111111",
      head: "2222222222222222222222222222222222222222"
    });
  });

  it("dedupes callback and git for the same terminal transition and records merged provenance", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "callbacks.md"),
      "[projcore callback] implementer A3a STATUS: DONE - callback landed\n"
    );
    const { ingest, events } = makeIngest();

    await ingest.tick(runConfig());
    gitHead = {
      branch: "feat/agj-upgrade-A3a-agent-events",
      head: "3333333333333333333333333333333333333333"
    };
    await ingest.tick(runConfig());

    const rows = events.listEvents("run-a3");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "status",
      state: "DONE",
      correlation_id: "terminal:run-a3:A3a:DONE"
    });
    expect(rows[0].source).toBe("callback");
    expect(rows[0].body.sources).toEqual(["callback", "git"]);
    expect(rows[0].body).toMatchObject({
      note: "callback landed",
      head: "3333333333333333333333333333333333333333"
    });
  });

  it("normalizes a grok status file into a callback-sourced status event", async () => {
    const statusFilePath = path.join(tmpDir, "grok-status.json");
    fs.writeFileSync(
      statusFilePath,
      JSON.stringify({
        status: "done",
        commit: "4444444444444444444444444444444444444444",
        dev_url: "http://localhost:3101",
        notes: "grok finished"
      })
    );
    const { ingest, events } = makeIngest();

    await ingest.tick({
      ...runConfig(),
      statusFilePath
    });

    const rows = events.listEvents("run-a3");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: "implementer",
      batch_id: "A3a",
      type: "status",
      state: "DONE",
      source: "callback",
      correlation_id: "terminal:run-a3:A3a:DONE"
    });
    expect(rows[0].body).toMatchObject({
      sources: ["callback"],
      file: statusFilePath,
      commit: "4444444444444444444444444444444444444444",
      dev_url: "http://localhost:3101",
      notes: "grok finished"
    });
  });

  it("reconciles grok status-file DONE and git DONE by terminal correlation id", async () => {
    const statusFilePath = path.join(tmpDir, "grok-status.json");
    fs.writeFileSync(
      statusFilePath,
      JSON.stringify({
        status: "DONE",
        commit: "5555555555555555555555555555555555555555",
        dev_url: null,
        notes: "status-file landed"
      })
    );
    const { ingest, events } = makeIngest();

    await ingest.tick({
      ...runConfig(),
      statusFilePath
    });
    gitHead = {
      branch: "feat/agj-upgrade-A3a-agent-events",
      head: "5555555555555555555555555555555555555555"
    };
    await ingest.tick({
      ...runConfig(),
      statusFilePath
    });

    const rows = events.listEvents("run-a3");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "status",
      state: "DONE",
      correlation_id: "terminal:run-a3:A3a:DONE"
    });
    expect(rows[0].body.sources).toEqual(["callback", "git"]);
    expect(rows[0].body).toMatchObject({
      commit: "5555555555555555555555555555555555555555",
      head: "5555555555555555555555555555555555555555",
      notes: "status-file landed"
    });
  });

  it("round-trips a structured chat message event", () => {
    const { ingest, events } = makeIngest();

    const row = ingest.recordMessage(runConfig(), {
      role: "assistant",
      content: "Build passed.",
      status: "complete",
      ts: "2026-06-13T12:00:00.000Z"
    });

    expect(row).toMatchObject({
      run_id: "run-a3",
      role: "assistant",
      batch_id: "A3a",
      type: "message",
      state: null,
      source: "post"
    });
    const rows = events.listEvents("run-a3");
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toMatchObject({
      content: "Build passed.",
      status: "complete",
      sources: ["post"]
    });
  });

  it("requires pane activity before deriving DONE from pane idle", async () => {
    let now = 1000;
    const events = new AgentEventsService(db);
    const tmux = new TmuxService();
    vi.spyOn(tmux, "capturePane")
      .mockResolvedValueOnce("initial pane")
      .mockResolvedValueOnce("initial pane")
      .mockResolvedValueOnce("agent wrote final answer")
      .mockResolvedValueOnce("agent wrote final answer");
    const ingest = new AgentEventIngest(events, tmux, {
      idleAfterActivityMs: 1000,
      gitHeadReader: async () => null,
      now: () => now
    });

    await ingest.tick(runConfig());
    now = 5000;
    await ingest.tick(runConfig());
    expect(events.listEvents("run-a3")).toHaveLength(0);

    now = 6000;
    await ingest.tick(runConfig());
    now = 8001;
    await ingest.tick(runConfig());

    const rows = events.listEvents("run-a3");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "status",
      state: "DONE",
      source: "pane"
    });
    expect(rows[0].body.sources).toEqual(["pane"]);
  });
});
