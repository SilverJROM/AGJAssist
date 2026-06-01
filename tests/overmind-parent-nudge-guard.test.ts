import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { NudgeStateService } from "../src/services/nudge-state-service.js";
import { OvermindService } from "../src/services/overmind-service.js";
import { sendGuardedParentNudge } from "../src/services/overmind/parent-nudge-guard.js";

const isAgentPaneMock = vi.hoisted(() => vi.fn());

vi.mock("../src/services/overmind/agent-pane.js", () => ({
  isAgentPane: isAgentPaneMock
}));

let tmpDir: string;
let db: DatabaseService;
let service: OvermindService;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-parent-guard-"));
  db = new DatabaseService(path.join(tmpDir, "overmind.sqlite"));
  service = new OvermindService(db);
  isAgentPaneMock.mockReset();
  isAgentPaneMock.mockResolvedValue("codex");
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createAttachedWorkflow(parentSession: string) {
  const project = service.createProject({
    slug: `project-${parentSession}`,
    app_path: tmpDir,
    parent_session: parentSession
  });
  return service.registerAttached({
    project_id: project.id,
    label: "projcore B12i",
    run_dir: path.join(tmpDir, "run")
  });
}

describe("sendGuardedParentNudge", () => {
  it("sends project-linked workflow nudges to overmind_projects.parent_session", async () => {
    const workflow = createAttachedWorkflow("project-parent");
    const send = vi.fn(async () => true);

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: check status",
      { overmindService: service },
      send
    );

    expect(result.sent).toBe(true);
    expect(isAgentPaneMock).toHaveBeenCalledWith("project-parent");
    expect(send).toHaveBeenCalledWith("project-parent", "overmind: check status");
  });

  it("falls back to legacy coordinator_session when workflow has no project_id", async () => {
    const workflow = service.register({
      label: "legacy",
      coordinator_session: "legacy-parent",
      run_dir: path.join(tmpDir, "legacy-run")
    });
    const send = vi.fn(async () => true);

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: legacy check",
      { overmindService: service },
      send
    );

    expect(result.sent).toBe(true);
    expect(isAgentPaneMock).toHaveBeenCalledWith("legacy-parent");
    expect(send).toHaveBeenCalledWith("legacy-parent", "overmind: legacy check");
  });

  it("suppresses bare-bash parent nudges, marks parent_status, logs, and sends TG once", async () => {
    const workflow = createAttachedWorkflow("bare-parent");
    const nudgeState = new NudgeStateService();
    const notify = vi.fn(async () => {});
    const send = vi.fn(async () => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    isAgentPaneMock.mockResolvedValue("bare-bash");

    const first = await sendGuardedParentNudge(
      workflow,
      "overmind: first",
      { overmindService: service, nudgeState, notify },
      send
    );
    const second = await sendGuardedParentNudge(
      workflow,
      "overmind: second",
      { overmindService: service, nudgeState, notify },
      send
    );

    expect(first.sent).toBe(false);
    expect(second.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(service.get(workflow.id)?.parent_status).toBe("bare-bash");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("🚨 URGENT");
    expect(warn.mock.calls[0][0]).toContain('[overmind] parent session "bare-parent" is bare-bash — suppressing nudge for run');
  });

  it("suppresses missing parent sessions and marks parent_status no-session", async () => {
    const workflow = createAttachedWorkflow("missing-parent");
    const send = vi.fn(async () => true);
    isAgentPaneMock.mockResolvedValue("no-session");

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: missing",
      { overmindService: service, nudgeState: new NudgeStateService(), notify: vi.fn(async () => {}) },
      send
    );

    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(service.get(workflow.id)?.parent_status).toBe("no-session");
  });

  it("sends to the coordinator when parent resolution fails instead of throwing", async () => {
    const workflow = service.register({
      label: "resolver-fail",
      coordinator_session: "legacy-parent",
      run_dir: path.join(tmpDir, "resolver-fail-run")
    });
    const send = vi.fn(async () => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(service, "getParentSessionForWorkflow").mockImplementation(() => {
      throw new Error("resolver unavailable");
    });

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: resolver fallback",
      { overmindService: service },
      send
    );

    expect(result).toMatchObject({
      sent: true,
      parentSession: "legacy-parent",
      paneKind: "unknown"
    });
    expect(isAgentPaneMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("legacy-parent", "overmind: resolver fallback");
    expect(warn.mock.calls[0][0]).toContain("parent session resolution failed");
  });
});
