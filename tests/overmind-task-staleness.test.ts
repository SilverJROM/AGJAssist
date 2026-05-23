import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveTaskStateFromText, invokeJudgeWithFallback } from "../src/services/overmind-watcher.js";

const FIXTURES_DIR = path.resolve(fileURLToPath(import.meta.url), "../fixtures");
// node <script> — no spaces in paths so the cmd.split(/\s+/) in the helper works correctly.
const EMIT_JSON_CMD = `node ${path.join(FIXTURES_DIR, "emit-json.js")}`;
const EMIT_BAD_JSON_CMD = `node ${path.join(FIXTURES_DIR, "emit-bad-json.js")}`;

// Fixtures — a few simple task stubs.
const tasks = [
  { id: "B1" },
  { id: "B2" },
  { id: "B3" },
  { id: "A1" },
  { id: "B12" }
];

describe("deriveTaskStateFromText", () => {
  // ── Done patterns ───────────────────────────────────────────────────────────

  it('flags done when "<id> PASS" appears', () => {
    const result = deriveTaskStateFromText("B2 PASS", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "<id> done" appears (case-insensitive)', () => {
    const result = deriveTaskStateFromText("B2 done — moving on", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "<id> merged" appears', () => {
    const result = deriveTaskStateFromText("B3 merged into main", tasks);
    expect(result.get("B3")).toBe("done");
  });

  it('flags done when "<id> VERIFIED" appears (case-insensitive)', () => {
    const result = deriveTaskStateFromText("b1 verified by QA", tasks);
    expect(result.get("B1")).toBe("done");
  });

  it('flags done when "✓ <id>" appears', () => {
    const result = deriveTaskStateFromText("✓ B1", tasks);
    expect(result.get("B1")).toBe("done");
  });

  it('flags done when "✔ <id>" appears', () => {
    const result = deriveTaskStateFromText("✔ B2 some trailing text", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "[x] <id>" appears', () => {
    const result = deriveTaskStateFromText("[x] B1 the label here", tasks);
    expect(result.get("B1")).toBe("done");
  });

  it('flags done when "<id> ✓" appears', () => {
    const result = deriveTaskStateFromText("B3 ✓", tasks);
    expect(result.get("B3")).toBe("done");
  });

  it('flags done when "<id> done" (suffix form)', () => {
    const result = deriveTaskStateFromText("B2 done", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it('flags done when "<id> PASS" (suffix form, uppercase)', () => {
    const result = deriveTaskStateFromText("A1 PASS", tasks);
    expect(result.get("A1")).toBe("done");
  });

  // ── In-progress patterns ────────────────────────────────────────────────────

  it('flags in-progress when "<id> REVISE" appears', () => {
    const result = deriveTaskStateFromText("B3 REVISE — fix the tests", tasks);
    expect(result.get("B3")).toBe("in-progress");
  });

  it('flags in-progress when "<id> in-flight" appears', () => {
    const result = deriveTaskStateFromText("B2 in-flight", tasks);
    expect(result.get("B2")).toBe("in-progress");
  });

  it('flags in-progress when "<id> in progress" appears (space variant)', () => {
    const result = deriveTaskStateFromText("B1 in progress now", tasks);
    expect(result.get("B1")).toBe("in-progress");
  });

  it('flags in-progress when "<id> processing" appears', () => {
    const result = deriveTaskStateFromText("B1 processing", tasks);
    expect(result.get("B1")).toBe("in-progress");
  });

  it('flags in-progress when "<id> iter 2" appears', () => {
    const result = deriveTaskStateFromText("B2 iter 2", tasks);
    expect(result.get("B2")).toBe("in-progress");
  });

  it('flags in-progress when "<id> FAIL" appears (recovery still in-progress)', () => {
    const result = deriveTaskStateFromText("B3 FAIL retrying", tasks);
    expect(result.get("B3")).toBe("in-progress");
  });

  // ── No-match cases — unmentioned ids must NOT appear in result ──────────────

  it("does not include ids that have no mention in the text", () => {
    const result = deriveTaskStateFromText("B2 PASS", tasks);
    expect(result.has("B1")).toBe(false);
    expect(result.has("B3")).toBe(false);
    expect(result.has("A1")).toBe(false);
    expect(result.has("B12")).toBe(false);
  });

  it("returns an empty map for text with no task-id signals", () => {
    const result = deriveTaskStateFromText("all is quiet on the western front", tasks);
    expect(result.size).toBe(0);
  });

  // ── Word-boundary: B1 must NOT fire when B12 is mentioned ──────────────────

  it("does not false-positive B1 when only B12 appears (word boundary)", () => {
    const result = deriveTaskStateFromText("B12 PASS", tasks);
    // B12 matches but B1 must NOT.
    expect(result.get("B12")).toBe("done");
    expect(result.has("B1")).toBe(false);
  });

  it("does not false-positive B1 for text containing B12 in-progress", () => {
    const result = deriveTaskStateFromText("B12 in-flight", tasks);
    expect(result.get("B12")).toBe("in-progress");
    expect(result.has("B1")).toBe(false);
  });

  // ── Multiple ids in one text blob ───────────────────────────────────────────

  it("handles multiple task ids in one blob", () => {
    const text = [
      "B1 PASS",
      "B2 REVISE — retry the unit tests",
      "B3 merged into main"
    ].join("\n");
    const result = deriveTaskStateFromText(text, tasks);
    expect(result.get("B1")).toBe("done");
    expect(result.get("B2")).toBe("in-progress");
    expect(result.get("B3")).toBe("done");
  });

  // ── Case-insensitive ────────────────────────────────────────────────────────

  it("is case-insensitive for task id references", () => {
    const result = deriveTaskStateFromText("b2 pass", tasks);
    expect(result.get("B2")).toBe("done");
  });

  it("is case-insensitive for in-progress keywords", () => {
    const result = deriveTaskStateFromText("B1 In-Flight", tasks);
    expect(result.get("B1")).toBe("in-progress");
  });

  // ── Done takes priority ─────────────────────────────────────────────────────

  it("done pattern takes priority when done appears first on the line", () => {
    // Both patterns match different occurrences; done should win.
    const result = deriveTaskStateFromText("B1 PASS\nB1 REVISE", tasks);
    // done pattern matches the first line; result is done (first match wins in regex).
    expect(result.get("B1")).toBe("done");
  });

  // ── Empty task list ─────────────────────────────────────────────────────────

  it("handles an empty task list gracefully", () => {
    const result = deriveTaskStateFromText("B1 PASS B2 done", []);
    expect(result.size).toBe(0);
  });

  // ── Spacing variants for checkbox ───────────────────────────────────────────

  it('flags done for "[x]  B2" with extra space', () => {
    const result = deriveTaskStateFromText("[x]  B2 label", tasks);
    expect(result.get("B2")).toBe("done");
  });
});

// ─── invokeJudgeWithFallback ─────────────────────────────────────────────────
// Uses real fixture scripts so no spawn mocking is needed:
//   primary = "false"         → always exits non-zero (simulates spark unavailable)
//   fallback = EMIT_JSON_CMD  → emits valid JSON and exits 0
//   both-fail = "false"/"false"
describe("invokeJudgeWithFallback", () => {
  it("returns primary result when primary succeeds", async () => {
    const result = await invokeJudgeWithFallback("prompt", EMIT_JSON_CMD, "false", 10_000);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("primary");
    expect((result!.json as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it("falls back to fallback when primary fails (non-zero exit)", async () => {
    const result = await invokeJudgeWithFallback("prompt", "false", EMIT_JSON_CMD, 10_000);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("fallback");
    expect((result!.json as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it("returns null when both primary and fallback fail", async () => {
    const result = await invokeJudgeWithFallback("prompt", "false", "false", 10_000);
    expect(result).toBeNull();
  });

  it("falls back when primary emits invalid JSON", async () => {
    const result = await invokeJudgeWithFallback("prompt", EMIT_BAD_JSON_CMD, EMIT_JSON_CMD, 10_000);
    expect(result).not.toBeNull();
    expect(result!.model).toBe("fallback");
  });
});
