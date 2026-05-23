import { describe, expect, it } from "vitest";
import {
  assessRegistrationCompleteness,
  EMPTY_TASKLIST_GRACE_MS,
  STALE_THRESHOLD_MS,
  CompletenessInput
} from "../src/services/overmind-watcher.js";

const PAST_GRACE = EMPTY_TASKLIST_GRACE_MS + 1000;

// A "now" reference used in stale tests — fixed so assertions are deterministic.
const NOW_MS = new Date("2026-05-23T12:00:00.000Z").getTime();
// run_started_at that is 4 hours before NOW_MS — well past the 3h STALE_THRESHOLD_MS.
const STARTED_4H_AGO = new Date(NOW_MS - 4 * 60 * 60 * 1000).toISOString();
// A recent task_log entry timestamp — 5 minutes before NOW_MS.
const TASK_LOG_5MIN_AGO = new Date(NOW_MS - 5 * 60 * 1000).toISOString();

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
    runStartedAt: null,
    taskLogLastAt: null,
    nowMs: NOW_MS,
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

  // --- roles_without_sessions ---

  it("flags roles_without_sessions when child_roles declared but no child_sessions", () => {
    const r = assessRegistrationCompleteness(
      base({ childRoles: ["coder", "tester"], childSessions: [] })
    );
    expect(r.missing).toContain("roles_without_sessions");
    expect(r.requestLabel).toContain("roster");
    expect(r.requestText).toContain("coder");
    expect(r.requestText).toContain("tester");
    expect(r.requestText).toContain("re-register");
  });

  it("does NOT flag roles_without_sessions when child_roles is empty", () => {
    const r = assessRegistrationCompleteness(
      base({ childRoles: [], childSessions: [] })
    );
    expect(r.missing).not.toContain("roles_without_sessions");
  });

  it("does NOT flag roles_without_sessions when both roles and sessions are present", () => {
    const r = assessRegistrationCompleteness(
      base({
        childRoles: ["coder"],
        childSessions: ["c1"],
        childStatuses: [{ session: "c1", status: "idle" }]
      })
    );
    expect(r.missing).not.toContain("roles_without_sessions");
  });

  // --- stale ---

  it("flags stale when run_started_at is >3h ago and task_log is empty and tasks are not all done", () => {
    const r = assessRegistrationCompleteness(
      base({
        runStartedAt: STARTED_4H_AGO,
        taskLogLastAt: null,
        tasks: [{ state: "processing" }]
      })
    );
    expect(r.missing).toContain("stale");
    expect(r.requestLabel).toContain("stale");
    expect(r.requestText).toContain("/api/overmind/tasks");
    expect(r.requestText).toContain("/api/overmind/complete");
  });

  it("does NOT flag stale when a recent task_log entry exists (within threshold)", () => {
    const r = assessRegistrationCompleteness(
      base({
        runStartedAt: STARTED_4H_AGO,
        taskLogLastAt: TASK_LOG_5MIN_AGO,
        tasks: [{ state: "processing" }]
      })
    );
    expect(r.missing).not.toContain("stale");
  });

  it("does NOT flag stale when all tasks are done (all-done branch handles it)", () => {
    const r = assessRegistrationCompleteness(
      base({
        runStartedAt: STARTED_4H_AGO,
        taskLogLastAt: null,
        tasks: [{ state: "done" }]
      })
    );
    expect(r.missing).not.toContain("stale");
  });

  it("does NOT flag stale when runStartedAt is null (no anchor to compute age)", () => {
    const r = assessRegistrationCompleteness(
      base({
        runStartedAt: null,
        taskLogLastAt: null,
        tasks: [{ state: "processing" }]
      })
    );
    expect(r.missing).not.toContain("stale");
  });

  it("uses the task_log entry (not run_started_at) as last-update when task_log is newer", () => {
    // task_log entry is recent — must NOT flag stale even if run_started_at is 4h ago
    const r = assessRegistrationCompleteness(
      base({
        runStartedAt: STARTED_4H_AGO,
        taskLogLastAt: TASK_LOG_5MIN_AGO,
        tasks: [{ state: "processing" }]
      })
    );
    expect(r.missing).not.toContain("stale");
  });

  // --- signature distinctness ---

  it("roles_without_sessions signature differs from roles signature", () => {
    const withRolesOnly = assessRegistrationCompleteness(
      base({ childRoles: ["coder"], childSessions: [] })
    );
    const withRolesMismatch = assessRegistrationCompleteness(
      base({
        childSessions: ["c1", "c2"],
        childRoles: [],
        childStatuses: [
          { session: "c1", status: "idle" },
          { session: "c2", status: "idle" }
        ]
      })
    );
    expect(withRolesOnly.signature).not.toBe(withRolesMismatch.signature);
    expect(withRolesOnly.missing).toContain("roles_without_sessions");
    expect(withRolesMismatch.missing).toContain("roles");
  });

  it("stale signature differs from other gap signatures", () => {
    const staleOnly = assessRegistrationCompleteness(
      base({
        runStartedAt: STARTED_4H_AGO,
        taskLogLastAt: null,
        tasks: [{ state: "processing" }]
      })
    );
    const tasklistOnly = assessRegistrationCompleteness(
      base({ tasks: [], runStartedAt: null })
    );
    const rolesWithoutSessions = assessRegistrationCompleteness(
      base({ childRoles: ["coder"], childSessions: [] })
    );
    expect(staleOnly.signature).not.toBe(tasklistOnly.signature);
    expect(staleOnly.signature).not.toBe(rolesWithoutSessions.signature);
    expect(staleOnly.missing).toContain("stale");
    expect(staleOnly.missing).not.toContain("tasklist");
    expect(staleOnly.missing).not.toContain("roles_without_sessions");
  });

  it("STALE_THRESHOLD_MS is exactly 3 hours in milliseconds", () => {
    expect(STALE_THRESHOLD_MS).toBe(3 * 60 * 60 * 1000);
  });
});
