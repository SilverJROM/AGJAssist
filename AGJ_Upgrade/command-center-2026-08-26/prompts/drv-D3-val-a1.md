# [driver] D3 — THE COMMIT UNDER TEST IS `01b8e383443991161c20a65ba9026dcacf173372`

Analyse EXACTLY that commit: `git show 01b8e383443991161c20a65ba9026dcacf173372`, `git diff 01b8e383443991161c20a65ba9026dcacf173372^..01b8e383443991161c20a65ba9026dcacf173372`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=01b8e383443991161c20a65ba9026dcacf173372`.

## The change under test (produced by the driver, not reported by the implementer)
```
[D3] add ReplySummaryService with endpoint-attributed summary persistence


 src/services/reply-summary-service.ts    |  71 +++++++++++++
 tests/unit/reply-summary-service.spec.ts | 166 +++++++++++++++++++++++++++++++
 2 files changed, 237 insertions(+)
```
```diff
diff --git a/src/services/reply-summary-service.ts b/src/services/reply-summary-service.ts
new file mode 100644
index 0000000..33291f9
--- /dev/null
+++ b/src/services/reply-summary-service.ts
@@ -0,0 +1,71 @@
+import { DatabaseService } from "../db/database.js";
+import { SummaryEndpointService } from "./summary-endpoint-service.js";
+
+export interface SummarizeOptions {
+  endpointId?: number;
+}
+
+/**
+ * ReplySummaryService
+ * Captures a post-solicit pane reply, summarizes it via a selected
+ * OpenAI-compatible /v1/chat/completions endpoint, and persists an
+ * endpoint-attributed short summary. LLM failures degrade gracefully
+ * without undoing the solicit.
+ */
+export class ReplySummaryService {
+  constructor(
+    private readonly db: DatabaseService,
+    private readonly endpointService: SummaryEndpointService
+  ) {}
+
+  async summarize(agentName: string, replyText: string, options: SummarizeOptions = {}): Promise<string | null> {
+    if (!agentName || !replyText) return null;
+
+    const endpoint = options.endpointId
+      ? this.endpointService.getById(options.endpointId)
+      : this.endpointService.getDefault();
+
+    if (!endpoint) return null;
+
+    try {
+      const payload = {
+        model: endpoint.model,
+        messages: [
+          {
+            role: "system",
+            content:
+              "You are a summarizer for agent replies. Produce a short, endpoint-attributed summary of the agent's reply. Keep it concise and factual."
+          },
+          { role: "user", content: replyText }
+        ],
+        temperature: 0.2,
+        max_tokens: 256
+      };
+
+      const res = await fetch(`${endpoint.base_url.replace(/\/$/, "")}/v1/chat/completions`, {
+        method: "POST",
+        headers: { "Content-Type": "application/json" },
+        body: JSON.stringify(payload)
+      });
+
+      if (!res.ok) {
+        // Degrade gracefully on non-2xx
+        return null;
+      }
+
+      const data = (await res.json()) as any;
+      const summaryText = data?.choices?.[0]?.message?.content?.trim();
+      if (!summaryText) return null;
+
+      this.db.prepare(
+        `INSERT INTO agent_summaries (agent_name, endpoint_id, summary_text, provenance)
+         VALUES (?, ?, ?, ?)`
+      ).run(agentName, endpoint.id, summaryText, "system");
+
+      return summaryText;
+    } catch {
+      // LLM failure degrades without undoing solicit
+      return null;
+    }
+  }
+}
diff --git a/tests/unit/reply-summary-service.spec.ts b/tests/unit/reply-summary-service.spec.ts
new file mode 100644
index 0000000..5859e82
--- /dev/null
+++ b/tests/unit/reply-summary-service.spec.ts
@@ -0,0 +1,166 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
+import { DatabaseService } from "../../src/db/database.js";
+import { SummaryEndpointService } from "../../src/services/summary-endpoint-service.js";
+import { ReplySummaryService } from "../../src/services/reply-summary-service.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+
+const tempDirs: string[] = [];
+
+function tempDb(name: string): string {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-reply-summary-"));
+  tempDirs.push(dir);
+  return path.join(dir, name);
+}
+
+afterEach(() => {
+  for (const dir of tempDirs.splice(0)) {
+    fs.rmSync(dir, { recursive: true, force: true });
+  }
+});
+
+describe("ReplySummaryService D3", () => {
+  let db: DatabaseService;
+  let endpointService: SummaryEndpointService;
+  let service: ReplySummaryService;
+  let originalFetch: typeof global.fetch;
+
+  beforeEach(() => {
+    const dbPath = tempDb("reply-summary.sqlite");
+    db = new DatabaseService(dbPath);
+    endpointService = new SummaryEndpointService(db);
+    service = new ReplySummaryService(db, endpointService);
+    originalFetch = global.fetch;
+  });
+
+  afterEach(() => {
+    global.fetch = originalFetch;
+    db.close();
+  });
+
+  it("summarizes with default endpoint and persists endpoint-attributed summary", async () => {
+    const def = endpointService.getDefault();
+    expect(def).not.toBeNull();
+
+    const reply = "Agent replied with a detailed status update about tasks and blockers.";
+    const expectedSummary = "Fixed summary from mocked LLM for test input A";
+
+    // Mock fetch to return a literal summary, not derived from input
+    global.fetch = vi.fn().mockResolvedValue({
+      ok: true,
+      json: async () => ({
+        choices: [{ message: { content: expectedSummary } }]
+      })
+    });
+
+    const result = await service.summarize("agent-foo", reply);
+    expect(result).toBe(expectedSummary);
+
+    const rows = db.prepare(
+      `SELECT agent_name, endpoint_id, summary_text, provenance
+       FROM agent_summaries
+       WHERE agent_name = ?`
+    ).all("agent-foo") as any[];
+
+    expect(rows).toHaveLength(1);
+    expect(rows[0].agent_name).toBe("agent-foo");
+    expect(rows[0].endpoint_id).toBe(def!.id);
+    expect(rows[0].summary_text).toBe(expectedSummary);
+    expect(rows[0].provenance).toBe("system");
+  });
+
+  it("uses explicit endpoint id when provided", async () => {
+    const custom = endpointService.create({
+      name: "custom-ep",
+      base_url: "http://example.com/v1",
+      model: "test-model",
+      provenance: "user"
+    });
+
+    const reply = "Different reply text";
+    const expectedSummary = "Explicit endpoint summary literal";
+
+    global.fetch = vi.fn().mockImplementation((url: string) => {
+      expect(url).toBe("http://example.com/v1/v1/chat/completions");
+      return Promise.resolve({
+        ok: true,
+        json: async () => ({
+          choices: [{ message: { content: expectedSummary } }]
+        })
+      });
+    });
+
+    const result = await service.summarize("agent-bar", reply, { endpointId: custom.id });
+    expect(result).toBe(expectedSummary);
+
+    const row = db.prepare(
+      `SELECT * FROM agent_summaries WHERE agent_name = ? AND endpoint_id = ?`
+    ).get("agent-bar", custom.id) as any;
+
+    expect(row).toBeDefined();
+    expect(row.summary_text).toBe(expectedSummary);
+    expect(row.endpoint_id).toBe(custom.id);
+  });
+
+  it("degrades gracefully on LLM failure and does not persist", async () => {
+    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
+
+    const result = await service.summarize("agent-baz", "some reply");
+    expect(result).toBeNull();
+
+    const rows = db.prepare(
+      `SELECT * FROM agent_summaries WHERE agent_name = ?`
+    ).all("agent-baz") as any[];
+
+    expect(rows).toHaveLength(0);
+  });
+
+  it("degrades gracefully on non-2xx response and does not persist", async () => {
+    global.fetch = vi.fn().mockResolvedValue({
+      ok: false,
+      status: 500
+    });
+
+    const result = await service.summarize("agent-qux", "reply");
+    expect(result).toBeNull();
+
+    const rows = db.prepare(
+      `SELECT * FROM agent_summaries WHERE agent_name = ?`
+    ).all("agent-qux") as any[];
+
+    expect(rows).toHaveLength(0);
+  });
+
+  it("returns null when no endpoint is configured", async () => {
+    // Remove default by switching to a non-existent id and clear default flag
+    const def = endpointService.getDefault();
+    if (def) {
+      // Set default to a dummy that will be removed; we just test missing endpoint path
+      // Instead, create service with empty db? Easier: mock endpoint service to return null
+    }
+    // For this test, we simulate missing endpoint by using invalid id
+    global.fetch = vi.fn();
+
+    const result = await service.summarize("agent-noep", "reply", { endpointId: 99999 });
+    expect(result).toBeNull();
+  });
+
+  it("does not compute expected value from mechanism under test", async () => {
+    // Supply input the mechanism would NOT choose on its own
+    const reply = "The agent says the sky is green and the grass is blue.";
+    const literalExpected = "Literal test summary: agent reported inverted colors";
+
+    global.fetch = vi.fn().mockResolvedValue({
+      ok: true,
+      json: async () => ({
+        choices: [{ message: { content: literalExpected } }]
+      })
+    });
+
+    const result = await service.summarize("agent-test", reply);
+    // Assertion is against literal, not derived from reply
+    expect(result).toBe(literalExpected);
+    expect(result).not.toBe(reply);
+  });
+});
```

# tiller validator — standing contract
(This section is identical in every validator brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the VALIDATOR. **Write NO product code** (verifier != fixer). You judge, independently.

---

# THE SLICE — D3 (run command-center-2026-08-26)

## Scope (do ONLY this)
Services layer: `ReplySummaryService` captures the post-solicit pane reply, calls selected `/v1/chat/completions`, persists a short endpoint-attributed summary; LLM failure degrades without undoing the solicit.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **E1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **E3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice D3 -- npx vitest run tests/unit/reply-summary-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D3 attempt=1 role=validator
  marker=DRV-D3-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate D3 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator D3 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/D3-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
**One block per finding that is NOT A CLEAN PASS — including PARTIAL. If N things failed or partially failed, write N blocks** — numbered, in the order you would fix them. Do NOT collapse them to the most important one. Only a lens that passed CLEANLY gets no block:
```
FINDING 1 of <N>
WHAT FAILED: <the specific assertion/behaviour, and where>
THE FIX: <the concrete change that would make this pass>
WHY THE LAST ATTEMPT MISSED IT: <one line, optional>

FINDING 2 of <N>
WHAT FAILED: ...
THE FIX: ...
```
**A finding you leave out can cost a FULL ATTEMPT CYCLE to rediscover** — an implementer turn, a validator turn and the callback latency — to learn something already written on disk. A strong seat sometimes infers past the omission; do not rely on the next seat being that seat. The gate id below stays singular because it names ONE gate; your prescription must not.
**NAME A MECHANISM, NOT AN OUTCOME.** A call, a path, a specimen, a structure, a flag — not the property the change should have. *"Tests must fail when the clause is violated"* is an OUTCOME and is worth nothing to the next seat; *"the negative specimen's NAME must contradict its shape"* is a mechanism and closed the slice. That distinction is not stylistic: a slice spent FOUR attempts each inventing a different mechanism for one question — zero-arg call, bytecode scan, object() sentinel, MagicMock sentinel — while the fix sat unwritten, and closed on the first attempt that had it. **The next implementer sees this file VERBATIM and sees your callback line only as a summary; if the fix is not in the file, it does not reach them.**
`[VERDICT-V1] run=command-center-2026-08-26 batch=D3 attempt=1 marker=DRV-D3-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
