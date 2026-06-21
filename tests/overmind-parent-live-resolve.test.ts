import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseService } from "../src/db/database.js";
import { OvermindService } from "../src/services/overmind-service.js";
import { sendGuardedParentNudge, resetAllConsecutiveDeadCounts } from "../src/services/overmind/parent-nudge-guard.js";
import { registerAttachedWorkflowFixture } from "./overmind-fixtures.js";

const isAgentPaneMock = vi.hoisted(() => vi.fn());

vi.mock("../src/services/overmind/agent-pane.js", () => ({
  isAgentPane: isAgentPaneMock
}));

let tmpDir: string;
let db: DatabaseService;
let service: OvermindService;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-parent-live-"));
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

describe("liveResolver in sendGuardedParentNudge (B3)", () => {
  it("invokes liveResolver with stored and uses its return as send target (R1/R3)", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "live-resolve-test",
      coordinator_session: "agj",
      run_dir: path.join(tmpDir, "run")
    });
    // stored in DB would be base like "agj"
    const send = vi.fn(async () => true);
    const liveResolver = vi.fn(async (stored: string) => (stored === "agj" ? "agj-4" : stored));

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: test resolve",
      { overmindService: service, liveResolver },
      send
    );

    expect(liveResolver).toHaveBeenCalledWith("agj");
    expect(send).toHaveBeenCalledWith("agj-4", "overmind: test resolve");
    expect(result.parentSession).toBe("agj-4");
    // isAgentPane saw the resolved name (via the mock)
    expect(isAgentPaneMock).toHaveBeenCalledWith("agj-4");
  });

  it("with NO liveResolver, uses raw stored value (backward-compat)", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "no-live-resolver-bc",
      coordinator_session: "agj",
      run_dir: path.join(tmpDir, "run2")
    });
    const send = vi.fn(async () => true);

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: bc check",
      { overmindService: service },
      send
    );

    expect(send).toHaveBeenCalledWith("agj", "overmind: bc check");
    expect(result.parentSession).toBe("agj");
  });

  it("liveResolver error falls back to stored (safety)", async () => {
    const workflow = registerAttachedWorkflowFixture(service, {
      label: "resolver-throws",
      coordinator_session: "agj",
      run_dir: path.join(tmpDir, "run3")
    });
    const send = vi.fn(async () => true);
    const liveResolver = vi.fn(async () => { throw new Error("boom"); });

    const result = await sendGuardedParentNudge(
      workflow,
      "overmind: error fallback",
      { overmindService: service, liveResolver },
      send
    );

    // fell back to raw stored
    expect(send).toHaveBeenCalledWith("agj", "overmind: error fallback");
    expect(result.parentSession).toBe("agj");
  });
});
