# [driver] E2 — THE COMMIT UNDER TEST IS `30f149b78db4094320cf43c5b1677cb8d94f23db`

Analyse EXACTLY that commit: `git show 30f149b78db4094320cf43c5b1677cb8d94f23db`, `git diff 30f149b78db4094320cf43c5b1677cb8d94f23db^..30f149b78db4094320cf43c5b1677cb8d94f23db`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=30f149b78db4094320cf43c5b1677cb8d94f23db`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E2] AgentWakeupService create/cancel/fire with fire-once claim, safety, audit


 src/services/agent-wakeup-service.ts    | 146 ++++++++++++++++++++++++++++++++
 tests/unit/agent-wakeup-service.spec.ts | 117 +++++++++++++++++++++++++
 2 files changed, 263 insertions(+)
```
```diff
diff --git a/src/services/agent-wakeup-service.ts b/src/services/agent-wakeup-service.ts
new file mode 100644
index 0000000..06b0a5b
--- /dev/null
+++ b/src/services/agent-wakeup-service.ts
@@ -0,0 +1,146 @@
+import { DatabaseService } from "../db/database.js";
+import { SafetyService } from "./safety-service.js";
+import { TmuxService } from "../tmux/tmux-service.js";
+import { AuditService } from "./audit-service.js";
+
+export interface AgentWakeup {
+  id: number;
+  pane_target: string;
+  manual_fire_time: string;
+  action: string;
+  status: "pending" | "fired" | "cancelled";
+  created_at: string;
+  updated_at: string;
+}
+
+export interface CreateWakeupParams {
+  paneTarget: string;
+  manualFireTime: string;
+  action: string;
+}
+
+export class AgentWakeupService {
+  constructor(
+    private readonly db: DatabaseService,
+    private readonly safetyService?: SafetyService,
+    private readonly tmuxService?: TmuxService,
+    private readonly auditService?: AuditService
+  ) {}
+
+  create(params: CreateWakeupParams): AgentWakeup {
+    const result = this.db
+      .prepare(
+        `INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status)
+         VALUES (?, ?, ?, 'pending')
+         RETURNING *`
+      )
+      .get(params.paneTarget, params.manualFireTime, params.action) as AgentWakeup;
+    return result;
+  }
+
+  cancel(id: number): boolean {
+    const now = new Date().toISOString();
+    const stmt = this.db.prepare(
+      `UPDATE agent_one_time_wakeups
+       SET status = 'cancelled', updated_at = ?
+       WHERE id = ? AND status = 'pending'`
+    );
+    const res = stmt.run(now, id);
+    return res.changes > 0;
+  }
+
+  getById(id: number): AgentWakeup | null {
+    return this.db
+      .prepare("SELECT * FROM agent_one_time_wakeups WHERE id = ?")
+      .get(id) as AgentWakeup | null;
+  }
+
+  listPending(): AgentWakeup[] {
+    return this.db
+      .prepare("SELECT * FROM agent_one_time_wakeups WHERE status = 'pending' ORDER BY manual_fire_time ASC")
+      .all() as AgentWakeup[];
+  }
+
+  async fire(id: number): Promise<boolean> {
+    const nowIso = new Date().toISOString();
+
+    // Load pending and due row
+    const row = this.db
+      .prepare(
+        `SELECT * FROM agent_one_time_wakeups
+         WHERE id = ? AND status = 'pending' AND manual_fire_time <= ?`
+      )
+      .get(id, nowIso) as AgentWakeup | undefined;
+    if (!row) {
+      return false;
+    }
+
+    // Safety check
+    if (this.safetyService) {
+      const check = this.safetyService.checkCommand(row.action);
+      if (check.blocked) {
+        this.auditService?.log({
+          actionType: "agent_wakeup_blocked",
+          resourceType: "agent_one_time_wakeup",
+          resourceId: String(id),
+          details: { paneTarget: row.pane_target, action: row.action, reason: "safety_blocked" },
+          tmuxTarget: row.pane_target,
+        });
+        this.db.prepare("UPDATE agent_one_time_wakeups SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso, id);
+        return false;
+      }
+    }
+
+    // Send via tmux
+    if (this.tmuxService) {
+      try {
+        await this.tmuxService.sendCommand(row.pane_target, row.action, true, false);
+      } catch (err) {
+        this.auditService?.log({
+          actionType: "agent_wakeup_send_failed",
+          resourceType: "agent_one_time_wakeup",
+          resourceId: String(id),
+          details: { paneTarget: row.pane_target, action: row.action, error: String(err) },
+          tmuxTarget: row.pane_target,
+        });
+        this.db.prepare("UPDATE agent_one_time_wakeups SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso, id);
+        return false;
+      }
+    }
+
+    // Audit success
+    this.auditService?.log({
+      actionType: "agent_wakeup_fired",
+      resourceType: "agent_one_time_wakeup",
+      resourceId: String(id),
+      details: { paneTarget: row.pane_target, action: row.action, firedAt: nowIso },
+      tmuxTarget: row.pane_target,
+    });
+
+    // Atomically mark fired only if still pending
+    const update = this.db.prepare(
+      `UPDATE agent_one_time_wakeups
+       SET status = 'fired', updated_at = ?
+       WHERE id = ? AND status = 'pending'`
+    );
+    const res = update.run(nowIso, id);
+    return res.changes > 0;
+  }
+
+  async fireDue(): Promise<number> {
+    const nowIso = new Date().toISOString();
+    const dueRows = this.db
+      .prepare(
+        `SELECT id FROM agent_one_time_wakeups
+         WHERE status = 'pending' AND manual_fire_time <= ?`
+      )
+      .all(nowIso) as { id: number }[];
+
+    let firedCount = 0;
+    for (const { id } of dueRows) {
+      const ok = await this.fire(id);
+      if (ok) firedCount++;
+    }
+    return firedCount;
+  }
+}
diff --git a/tests/unit/agent-wakeup-service.spec.ts b/tests/unit/agent-wakeup-service.spec.ts
new file mode 100644
index 0000000..728af15
--- /dev/null
+++ b/tests/unit/agent-wakeup-service.spec.ts
@@ -0,0 +1,117 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+import { DatabaseService } from "../../src/db/database.js";
+import { AgentWakeupService } from "../../src/services/agent-wakeup-service.js";
+import { SafetyService } from "../../src/services/safety-service.js";
+import { AuditService } from "../../src/services/audit-service.js";
+import { TmuxService } from "../../src/tmux/tmux-service.js";
+
+let tmpDir: string;
+let db: DatabaseService;
+let safety: SafetyService;
+let audit: AuditService;
+let tmux: TmuxService;
+let service: AgentWakeupService;
+
+const past = new Date(Date.now() - 60_000).toISOString();
+const future = new Date(Date.now() + 60_000).toISOString();
+
+describe("AgentWakeupService", () => {
+  beforeEach(() => {
+    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agj-wakeup-"));
+    db = new DatabaseService(path.join(tmpDir, "wakeup.sqlite"));
+    safety = new SafetyService(db);
+    audit = new AuditService(db);
+    tmux = new TmuxService();
+    // Spy on tmux sendCommand to avoid real tmux
+    vi.spyOn(tmux, "sendCommand").mockResolvedValue({ message: "sent", blocked: false });
+    service = new AgentWakeupService(db, safety, tmux, audit);
+  });
+
+  afterEach(() => {
+    db.close();
+    fs.rmSync(tmpDir, { recursive: true, force: true });
+    vi.restoreAllMocks();
+  });
+
+  it("create inserts a pending wakeup", () => {
+    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo hello" });
+    expect(w.pane_target).toBe("sess:0.0");
+    expect(w.action).toBe("echo hello");
+    expect(w.status).toBe("pending");
+    const fetched = service.getById(w.id);
+    expect(fetched).not.toBeNull();
+    expect(fetched!.status).toBe("pending");
+  });
+
+  it("cancel marks pending wakeup as cancelled", () => {
+    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo hi" });
+    const ok = service.cancel(w.id);
+    expect(ok).toBe(true);
+    const fetched = service.getById(w.id);
+    expect(fetched!.status).toBe("cancelled");
+  });
+
+  it("cancel does nothing if already fired", async () => {
+    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo hi" });
+    await service.fire(w.id);
+    const ok = service.cancel(w.id);
+    expect(ok).toBe(false);
+  });
+
+  it("fire processes due wakeup, sends via tmux, audits, and marks fired", async () => {
+    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo due" });
+    const sentSpy = vi.spyOn(tmux, "sendCommand");
+    const ok = await service.fire(w.id);
+    expect(ok).toBe(true);
+    expect(sentSpy).toHaveBeenCalledWith("sess:0.0", "echo due", true, false);
+    const fetched = service.getById(w.id);
+    expect(fetched!.status).toBe("fired");
+    const logs = audit.query({ actionType: "agent_wakeup_fired" });
+    expect(logs.length).toBeGreaterThan(0);
+    expect(logs[0].resource_id).toBe(String(w.id));
+  });
+
+  it("fire does not process future wakeup", async () => {
+    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: future, action: "echo future" });
+    const ok = await service.fire(w.id);
+    expect(ok).toBe(false);
+    const fetched = service.getById(w.id);
+    expect(fetched!.status).toBe("pending");
+  });
+
+  it("fire is fire-once", async () => {
+    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo once" });
+    const first = await service.fire(w.id);
+    const second = await service.fire(w.id);
+    expect(first).toBe(true);
+    expect(second).toBe(false);
+    const fetched = service.getById(w.id);
+    expect(fetched!.status).toBe("fired");
+  });
+
+  it("fire respects safety block", async () => {
+    // Add a safety pattern that blocks rm -rf
+    safety.addPattern("rm -rf", "test", false);
+    const w = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "rm -rf /" });
+    const ok = await service.fire(w.id);
+    expect(ok).toBe(false);
+    const fetched = service.getById(w.id);
+    expect(fetched!.status).toBe("cancelled");
+    const logs = audit.query({ actionType: "agent_wakeup_blocked" });
+    expect(logs.length).toBeGreaterThan(0);
+  });
+
+  it("fireDue processes all due pending wakeups", async () => {
+    const w1 = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo 1" });
+    const w2 = service.create({ paneTarget: "sess:0.0", manualFireTime: past, action: "echo 2" });
+    const w3 = service.create({ paneTarget: "sess:0.0", manualFireTime: future, action: "echo future" });
+    const count = await service.fireDue();
+    expect(count).toBe(2);
+    expect(service.getById(w1.id)!.status).toBe("fired");
+    expect(service.getById(w2.id)!.status).toBe("fired");
+    expect(service.getById(w3.id)!.status).toBe("pending");
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

# THE SLICE — E2 (run command-center-2026-08-26)

## Scope (do ONLY this)
Services layer, ONE claim=fire-once: `AgentWakeupService` create/cancel/fire; due fires pass the action through existing `SafetyService`+`TmuxService`, write `AuditService`, atomically clear pending.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **D1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice E2 -- npx vitest run tests/unit/agent-wakeup-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=E2 attempt=1 role=validator
  marker=DRV-E2-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate E2 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator E2 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E2-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E2 attempt=1 marker=DRV-E2-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
