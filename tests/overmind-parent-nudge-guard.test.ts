import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { NudgeStateService } from "../src/services/nudge-state-service.js";
import { OvermindService } from "../src/services/overmind-service.js";
import {
  sendGuardedParentNudge,
  resetAllConsecutiveDeadCounts
} from "../src/services/overmind/parent-nudge-guard.js";
import { registerAttachedWorkflowFixture } from "./overmind-fixtures.js";

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
  resetAllConsecutiveDeadCounts();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAllConsecutiveDeadCounts();
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

  it("falls back to coordinator_session when project parent resolution returns none", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "project-backed",
      coordinator_session: "legacy-parent",
      run_dir: path.join(tmpDir, "legacy-run")
    });
    vi.spyOn(service, "getParentSessionForWorkflow").mockReturnValue(null);
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

  it("H7: bare-bash reads below threshold → unknown + send; 3rd consecutive bare-bash → orphaned, no send, TG once", async () => {
    const workflow = createAttachedWorkflow("bare-parent");
    const nudgeState = new NudgeStateService();
    const notify = vi.fn(async () => {});
    const send = vi.fn(async () => true);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    isAgentPaneMock.mockResolvedValue("bare-bash");

    // Calls 1 & 2: count < 3 → downgraded to "unknown", send IS attempted.
    const first = await sendGuardedParentNudge(
      workflow,
      "overmind: first",
      { overmindService: service, nudgeState, notify },
      send
    );
    expect(first.sent).toBe(true);
    expect(first.paneKind).toBe("unknown");
    expect(info.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('count=1/3')
    )).toBe(true);

    const second = await sendGuardedParentNudge(
      workflow,
      "overmind: second",
      { overmindService: service, nudgeState, notify },
      send
    );
    expect(second.sent).toBe(true);
    expect(second.paneKind).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
    expect(info.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('count=2/3')
    )).toBe(true);

    // Third call: count=3 = threshold → orphaned, no send, TG notify fires.
    const third = await sendGuardedParentNudge(
      workflow,
      "overmind: third",
      { overmindService: service, nudgeState, notify },
      send
    );
    expect(third.sent).toBe(false);
    expect(third.paneKind).toBe("bare-bash");
    expect(send).toHaveBeenCalledTimes(2); // no additional send on orphan
    expect(service.get(workflow.id)?.parent_status).toBe("bare-bash");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("🚨 URGENT");
    expect(warn.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('[overmind] parent session "bare-parent" is bare-bash — suppressing nudge for run')
    )).toBe(true);
  });

  it("H7: single no-session read → treated as unknown, send attempted; after threshold → orphaned", async () => {
    const workflow = createAttachedWorkflow("missing-parent");
    const send = vi.fn(async () => true);
    isAgentPaneMock.mockResolvedValue("no-session");

    // Calls 1 & 2: count < 3 → downgraded to "unknown", send attempted.
    const first = await sendGuardedParentNudge(
      workflow,
      "overmind: missing first",
      { overmindService: service, nudgeState: new NudgeStateService(), notify: vi.fn(async () => {}) },
      send
    );
    expect(first.sent).toBe(true);
    expect(first.paneKind).toBe("unknown");

    const second = await sendGuardedParentNudge(
      workflow,
      "overmind: missing second",
      { overmindService: service, nudgeState: new NudgeStateService(), notify: vi.fn(async () => {}) },
      send
    );
    expect(second.sent).toBe(true);
    expect(second.paneKind).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(2);

    // Third call: count=3 = threshold → orphaned.
    const third = await sendGuardedParentNudge(
      workflow,
      "overmind: missing third",
      { overmindService: service, nudgeState: new NudgeStateService(), notify: vi.fn(async () => {}) },
      send
    );
    expect(third.sent).toBe(false);
    expect(third.paneKind).toBe("no-session");
    expect(service.get(workflow.id)?.parent_status).toBe("no-session");
    expect(send).toHaveBeenCalledTimes(2); // calls 1 & 2 sent, 3rd orphaned
  });

  it("sends to the coordinator when parent resolution fails instead of throwing", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
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

  it("NEW-1: alive parent (claude) where send returns false → sent:false, paneKind preserved, not orphaned", async () => {
    // sendAndSubmit returns false on send-failure — the guard must propagate
    // this boolean, not hardcode sent:true.
    const workflow = createAttachedWorkflow("claude-parent");
    isAgentPaneMock.mockResolvedValue("claude");
    // send returns false (tmux send failed / unconfirmed submit)
    const send = vi.fn(async () => false);

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: completion prompt",
      { overmindService: service },
      send
    );

    // Must reflect the real send outcome, not a hardcoded true.
    expect(result.sent).toBe(false);
    expect(result.parentSession).toBe("claude-parent");
    // Live pane kind must be preserved (not orphaned kinds bare-bash/no-session).
    expect(result.paneKind).toBe("claude");
    // parent_status not set (not orphaned).
    expect(result.parent_status).toBeUndefined();
    // send was actually called (alive path still attempts the send).
    expect(send).toHaveBeenCalledWith("claude-parent", "overmind: completion prompt");
  });
});
