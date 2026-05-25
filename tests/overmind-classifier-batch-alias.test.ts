import { describe, expect, it } from "vitest";
import { deriveTaskStateFromText } from "../src/services/overmind/classifier.js";

const task = (id: string) => ({ id });

describe("deriveTaskStateFromText — batch-N alias for B-prefix IDs", () => {
  it("matches 'batch-14 DONE' against task ID B14", () => {
    const result = deriveTaskStateFromText("[projcore callback] batch-14 DONE defe71d", [task("B14")]);
    expect(result.get("B14")).toBe("done");
  });

  it("matches 'Batch-17b — VERIFIED' against task ID B17b", () => {
    const result = deriveTaskStateFromText("### Batch-17b — VERIFIED (R13 closed)", [task("B17b")]);
    expect(result.get("B17b")).toBe("done");
  });

  it("matches 'batch-17a DONE' against task ID B17a", () => {
    const result = deriveTaskStateFromText("[projcore callback] batch-17a DONE b95afa5", [task("B17a")]);
    expect(result.get("B17a")).toBe("done");
  });

  it("matches 'batch-12 DONE eff8bce' against task ID B12", () => {
    const result = deriveTaskStateFromText("[projcore callback] batch-12 DONE eff8bce R5", [task("B12")]);
    expect(result.get("B12")).toBe("done");
  });

  it("matches 'batch-18 IN_PROGRESS' against task ID B18 as in-progress", () => {
    const result = deriveTaskStateFromText("[projcore callback] batch-18 IN_PROGRESS Resuming", [task("B18")]);
    expect(result.get("B18")).toBe("in-progress");
  });

  it("standalone 'progress' (projcore proposing phase) does NOT trigger in-progress", () => {
    const result = deriveTaskStateFromText("[projcore callback] batch-19a progress reading-files", [task("B19a")]);
    expect(result.get("B19a")).toBeUndefined();
  });

  it("matches 'batch-19a IN_PROGRESS' (underscore) against task ID B19a as in-progress", () => {
    const result = deriveTaskStateFromText("[projcore callback] batch-19a IN_PROGRESS running", [task("B19a")]);
    expect(result.get("B19a")).toBe("in-progress");
  });

  it("does not treat words ending in in_progress as an in-progress state", () => {
    const result = deriveTaskStateFromText("[projcore callback] batch-18 within_progress details", [task("B18")]);
    expect(result.get("B18")).toBeUndefined();
  });

  it("does not treat undone or redone as done states", () => {
    const result = deriveTaskStateFromText("batch-14 undone\nB15 redone", [task("B14"), task("B15")]);
    expect(result.get("B14")).toBeUndefined();
    expect(result.get("B15")).toBeUndefined();
  });

  it("direct B-prefix match still works: 'B14 done'", () => {
    const result = deriveTaskStateFromText("B14 done", [task("B14")]);
    expect(result.get("B14")).toBe("done");
  });

  it("non-B-prefix IDs do not generate false batch-N matches", () => {
    const result = deriveTaskStateFromText("batch-1 DONE batch-2 DONE", [task("TASK-1"), task("feature-x")]);
    expect(result.size).toBe(0);
  });

  it("B-prefix ID does not match a different batch-N number", () => {
    const result = deriveTaskStateFromText("batch-15 DONE", [task("B14")]);
    expect(result.get("B14")).toBeUndefined();
  });

  it("multiple tasks resolved in one pass", () => {
    const text = [
      "[projcore callback] batch-12 DONE eff8bce",
      "[projcore callback] batch-13 DONE 3a1d022",
      "[projcore callback] batch-18 IN_PROGRESS resuming",
    ].join("\n");
    const result = deriveTaskStateFromText(text, [task("B12"), task("B13"), task("B18"), task("B19a")]);
    expect(result.get("B12")).toBe("done");
    expect(result.get("B13")).toBe("done");
    expect(result.get("B18")).toBe("in-progress");
    expect(result.get("B19a")).toBeUndefined();
  });
});
