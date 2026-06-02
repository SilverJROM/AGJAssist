import { describe, expect, it } from "vitest";
import {
  isGarbageTaskId,
  validateSubmittedTaskList
} from "../src/services/overmind/sanitize.js";

describe("overmind task submission validation", () => {
  it("accepts real task IDs with the three persisted task states", () => {
    const validation = validateSubmittedTaskList([
      { id: "B9b", label: "Submission integrity", state: "processing" },
      { id: "REQ-10", label: "Reject garbage", state: "pending" },
      { id: "A1", label: "x".repeat(120), state: "done" }
    ]);

    expect(validation.ok).toBe(true);
    expect(validation.invalid_tasks).toEqual([]);
    expect(validation.tasks.map((task) => task.id)).toEqual(["B9b", "REQ-10", "A1"]);
  });

  it("rejects row-N fallback IDs, trash labels, and invalid states", () => {
    expect(isGarbageTaskId("row-149")).toBe(true);
    expect(isGarbageTaskId("row-b")).toBe(false);

    const validation = validateSubmittedTaskList([
      { id: "row-149", label: "Parser fallback", state: "pending" },
      { id: "B2", label: "|---|---|---|", state: "pending" },
      { id: "B3", label: "Blocked row", state: "blocked" }
    ]);

    expect(validation.ok).toBe(false);
    expect(validation.invalid_tasks).toEqual([
      expect.objectContaining({ index: 0, field: "id", value: "row-149" }),
      expect.objectContaining({ index: 1, field: "label" }),
      expect.objectContaining({ index: 2, field: "state", value: "blocked" })
    ]);
  });

  it("rejects task labels longer than 120 characters", () => {
    const validation = validateSubmittedTaskList([
      { id: "B12", label: "x".repeat(121), state: "pending" }
    ]);

    expect(validation.ok).toBe(false);
    expect(validation.invalid_tasks).toEqual([
      expect.objectContaining({
        index: 0,
        field: "label",
        reason: "label must be 120 characters or fewer"
      })
    ]);
  });
});
