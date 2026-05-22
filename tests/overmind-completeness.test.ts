import { describe, expect, it } from "vitest";
import {
  assessRegistrationCompleteness,
  EMPTY_TASKLIST_GRACE_MS,
  CompletenessInput
} from "../src/services/overmind-watcher.js";

const PAST_GRACE = EMPTY_TASKLIST_GRACE_MS + 1000;

function base(overrides: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    tasks: [{ state: "processing" }],
    childSessions: [],
    childRoles: [],
    childStatuses: [],
    runDir: "/tmp/run",
    runDirExists: true,
    ageMs: PAST_GRACE,
    currentTask: null,
    ...overrides
  };
}

describe("assessRegistrationCompleteness", () => {
  it("reports complete when all data is present", () => {
    const r = assessRegistrationCompleteness(base());
    expect(r.missing).toEqual([]);
    expect(r.requestLabel).toBeNull();
    expect(r.requestText).toBeNull();
    expect(r.needsBrain).toBe(false);
  });

  it("flags an empty tasklist past the grace window", () => {
    const r = assessRegistrationCompleteness(base({ tasks: [] }));
    expect(r.missing).toContain("tasklist");
    expect(r.requestText).toContain("tasklist");
    expect(r.requestLabel).toContain("tasklist");
  });

  it("does NOT nag about an empty tasklist within the grace window", () => {
    const r = assessRegistrationCompleteness(base({ tasks: [], ageMs: 1000 }));
    expect(r.missing).not.toContain("tasklist");
  });

  it("flags a missing run_dir on disk", () => {
    const r = assessRegistrationCompleteness(base({ runDirExists: false, runDir: "/tmp/gone" }));
    expect(r.missing).toContain("run_dir");
    expect(r.requestText).toContain("/tmp/gone");
  });

  it("flags a dead (closed) child session", () => {
    const r = assessRegistrationCompleteness(
      base({
        childSessions: ["c1"],
        childStatuses: [{ session: "c1", status: "closed" }]
      })
    );
    expect(r.missing).toContain("dead_child");
    expect(r.requestText).toContain("c1");
  });

  it("flags missing roles only when there are 2+ children", () => {
    const two = assessRegistrationCompleteness(
      base({
        childSessions: ["c1", "c2"],
        childRoles: [],
        childStatuses: [
          { session: "c1", status: "idle" },
          { session: "c2", status: "idle" }
        ]
      })
    );
    expect(two.missing).toContain("roles");

    const one = assessRegistrationCompleteness(
      base({ childSessions: ["c1"], childRoles: [], childStatuses: [{ session: "c1", status: "idle" }] })
    );
    expect(one.missing).not.toContain("roles");
  });

  it("does not flag roles when both children are labeled", () => {
    const r = assessRegistrationCompleteness(
      base({
        childSessions: ["c1", "c2"],
        childRoles: ["coder", "tester"],
        childStatuses: [
          { session: "c1", status: "idle" },
          { session: "c2", status: "idle" }
        ]
      })
    );
    expect(r.missing).not.toContain("roles");
  });

  it("produces a stable, order-independent signature for the same gap set", () => {
    const a = assessRegistrationCompleteness(base({ tasks: [], runDirExists: false }));
    const b = assessRegistrationCompleteness(base({ runDirExists: false, tasks: [] }));
    expect(a.signature).toBe(b.signature);
    // a different gap set must produce a different signature (re-arms the request)
    const c = assessRegistrationCompleteness(base({ tasks: [] }));
    expect(c.signature).not.toBe(a.signature);
  });

  it("routes a current_task that names a batch absent from the tasklist to the brain", () => {
    const r = assessRegistrationCompleteness(
      base({
        currentTask: "B3 raise cap",
        tasks: [
          { state: "done" } as { state: string },
          { state: "processing" } as { state: string }
        ]
      })
    );
    expect(r.needsBrain).toBe(true);
    expect(r.missing).toContain("task_mismatch");
  });

  it("does not flag a mismatch when a task matches the current_task token", () => {
    const r = assessRegistrationCompleteness(
      base({
        currentTask: "B3 raise cap",
        tasks: [{ id: "B3", label: "raise cap", state: "processing" } as unknown as { state: string }]
      })
    );
    expect(r.needsBrain).toBe(false);
  });
});
