# [driver] D2 — THE COMMIT UNDER TEST IS `37567aeb8c21fe73c2e5f96907c3774c533e8bbc`

Analyse EXACTLY that commit: `git show 37567aeb8c21fe73c2e5f96907c3774c533e8bbc`, `git diff 37567aeb8c21fe73c2e5f96907c3774c533e8bbc^..37567aeb8c21fe73c2e5f96907c3774c533e8bbc`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=37567aeb8c21fe73c2e5f96907c3774c533e8bbc`.

## The change under test (produced by the driver, not reported by the implementer)
```
[D2] Add SummaryEndpointService with owner-scoped CRUD, seed 140, tests


 src/services/summary-endpoint-service.ts    | 114 +++++++++++++++++++++
 tests/unit/summary-endpoint-service.spec.ts | 149 ++++++++++++++++++++++++++++
 2 files changed, 263 insertions(+)
```
```diff
diff --git a/src/services/summary-endpoint-service.ts b/src/services/summary-endpoint-service.ts
new file mode 100644
index 0000000..af2662a
--- /dev/null
+++ b/src/services/summary-endpoint-service.ts
@@ -0,0 +1,114 @@
+import { DatabaseService } from "../db/database.js";
+
+export interface SummaryEndpoint {
+  id: number;
+  name: string;
+  base_url: string;
+  model: string;
+  is_default: number;
+  provenance: string;
+  created_at: string;
+  updated_at: string;
+}
+
+export interface CreateEndpointInput {
+  name: string;
+  base_url: string;
+  model: string;
+  provenance?: string;
+}
+
+export interface UpdateEndpointInput {
+  name?: string;
+  base_url?: string;
+  model?: string;
+}
+
+/**
+ * SummaryEndpointService
+ * Owner-scoped CRUD for summary LLM endpoints.
+ * Secrets are never logged — only endpoint metadata is returned.
+ */
+export class SummaryEndpointService {
+  constructor(private readonly db: DatabaseService) {}
+
+  list(): SummaryEndpoint[] {
+    return this.db.prepare(
+      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints ORDER BY id ASC"
+    ).all() as SummaryEndpoint[];
+  }
+
+  getById(id: number): SummaryEndpoint | null {
+    const row = this.db.prepare(
+      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints WHERE id = ?"
+    ).get(id) as SummaryEndpoint | undefined;
+    return row ?? null;
+  }
+
+  getByName(name: string): SummaryEndpoint | null {
+    const row = this.db.prepare(
+      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints WHERE name = ?"
+    ).get(name) as SummaryEndpoint | undefined;
+    return row ?? null;
+  }
+
+  getDefault(): SummaryEndpoint | null {
+    const row = this.db.prepare(
+      "SELECT id, name, base_url, model, is_default, provenance, created_at, updated_at FROM summary_llm_endpoints WHERE is_default = 1 LIMIT 1"
+    ).get() as SummaryEndpoint | undefined;
+    return row ?? null;
+  }
+
+  create(input: CreateEndpointInput): SummaryEndpoint {
+    const provenance = input.provenance ?? "user";
+    // Avoid logging secrets — base_url may be sensitive context, so we only log name
+    const result = this.db.prepare(
+      `INSERT INTO summary_llm_endpoints (name, base_url, model, is_default, provenance)
+       VALUES (?, ?, ?, 0, ?)
+       RETURNING id, name, base_url, model, is_default, provenance, created_at, updated_at`
+    ).get(input.name, input.base_url, input.model, provenance) as SummaryEndpoint;
+    return result;
+  }
+
+  update(id: number, input: UpdateEndpointInput): SummaryEndpoint | null {
+    const existing = this.getById(id);
+    if (!existing) return null;
+
+    const name = input.name ?? existing.name;
+    const base_url = input.base_url ?? existing.base_url;
+    const model = input.model ?? existing.model;
+
+    this.db.prepare(
+      `UPDATE summary_llm_endpoints
+       SET name = ?, base_url = ?, model = ?, updated_at = datetime('now')
+       WHERE id = ?`
+    ).run(name, base_url, model, id);
+
+    return this.getById(id);
+  }
+
+  remove(id: number): boolean {
+    const existing = this.getById(id);
+    if (!existing) return false;
+    // Prevent removal of the default endpoint to avoid orphaned default state
+    if (existing.is_default === 1) {
+      // If the default is being removed, clear default flag first
+      // Caller should set a new default before removal in production
+      // For safety, we refuse to delete the default
+      return false;
+    }
+    const res = this.db.prepare("DELETE FROM summary_llm_endpoints WHERE id = ?").run(id);
+    return res.changes > 0;
+  }
+
+  setDefault(id: number): SummaryEndpoint | null {
+    const target = this.getById(id);
+    if (!target) return null;
+
+    // Ensure only one default exists
+    this.db.prepare("UPDATE summary_llm_endpoints SET is_default = 0 WHERE is_default = 1").run();
+    this.db.prepare("UPDATE summary_llm_endpoints SET is_default = 1, updated_at = datetime('now') WHERE id = ?").run(id);
+
+    return this.getById(id);
+  }
+}
diff --git a/tests/unit/summary-endpoint-service.spec.ts b/tests/unit/summary-endpoint-service.spec.ts
new file mode 100644
index 0000000..c1938b9
--- /dev/null
+++ b/tests/unit/summary-endpoint-service.spec.ts
@@ -0,0 +1,149 @@
+import { describe, it, expect, afterEach } from "vitest";
+import { DatabaseService } from "../../src/db/database.js";
+import { SummaryEndpointService } from "../../src/services/summary-endpoint-service.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+
+const tempDirs: string[] = [];
+
+function tempDb(name: string): string {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-summary-endpoint-"));
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
+describe("SummaryEndpointService D2", () => {
+  it("seeds default endpoint labelled 140", () => {
+    const dbPath = tempDb("seed.sqlite");
+    const db = new DatabaseService(dbPath);
+    const svc = new SummaryEndpointService(db);
+
+    const def = svc.getDefault();
+    expect(def).not.toBeNull();
+    expect(def!.name).toBe("140");
+    expect(def!.base_url).toBe("http://192.168.254.140:1234/v1");
+    expect(def!.model).toBe("qwen2.5-14b-instruct");
+    expect(def!.is_default).toBe(1);
+    expect(def!.provenance).toBe("system");
+  });
+
+  it("lists endpoints and never returns secrets", () => {
+    const dbPath = tempDb("list.sqlite");
+    const db = new DatabaseService(dbPath);
+    const svc = new SummaryEndpointService(db);
+
+    const list = svc.list();
+    expect(list.length).toBeGreaterThanOrEqual(1);
+    const seeded = list.find(e => e.name === "140");
+    expect(seeded).toBeDefined();
+    // Ensure fields are present and no secret columns leaked
+    expect(seeded!.id).toBeTypeOf("number");
+    expect(seeded!.name).toBeTypeOf("string");
+    expect(seeded!.base_url).toBeTypeOf("string");
+    expect(seeded!.model).toBeTypeOf("string");
+  });
+
+  it("creates, edits, removes endpoints with owner-scoped semantics", () => {
+    const dbPath = tempDb("crud.sqlite");
+    const db = new DatabaseService(dbPath);
+    const svc = new SummaryEndpointService(db);
+
+    // Create
+    const created = svc.create({
+      name: "local-8080",
+      base_url: "http://localhost:8080/v1",
+      model: "granite-3b",
+      provenance: "user"
+    });
+    expect(created.id).toBeDefined();
+    expect(created.name).toBe("local-8080");
+    expect(created.base_url).toBe("http://localhost:8080/v1");
+    expect(created.model).toBe("granite-3b");
+    expect(created.is_default).toBe(0);
+
+    // Edit
+    const updated = svc.update(created.id, { model: "granite-7b", base_url: "http://localhost:8080/v1" });
+    expect(updated).not.toBeNull();
+    expect(updated!.model).toBe("granite-7b");
+
+    // Get by name
+    const byName = svc.getByName("local-8080");
+    expect(byName).not.toBeNull();
+    expect(byName!.id).toBe(created.id);
+
+    // Remove
+    const removed = svc.remove(created.id);
+    expect(removed).toBe(true);
+    expect(svc.getById(created.id)).toBeNull();
+  });
+
+  it("sets default endpoint and enforces single default", () => {
+    const dbPath = tempDb("default.sqlite");
+    const db = new DatabaseService(dbPath);
+    const svc = new SummaryEndpointService(db);
+
+    const e1 = svc.create({ name: "ep-a", base_url: "http://a/v1", model: "m-a" });
+    const e2 = svc.create({ name: "ep-b", base_url: "http://b/v1", model: "m-b" });
+
+    // Initially default is seeded 140
+    let def = svc.getDefault();
+    expect(def!.name).toBe("140");
+
+    // Switch default to e1
+    svc.setDefault(e1.id);
+    def = svc.getDefault();
+    expect(def!.id).toBe(e1.id);
+    expect(def!.is_default).toBe(1);
+
+    // Ensure e2 is not default
+    const e2After = svc.getById(e2.id);
+    expect(e2After!.is_default).toBe(0);
+
+    // Switch default to e2
+    svc.setDefault(e2.id);
+    def = svc.getDefault();
+    expect(def!.id).toBe(e2.id);
+
+    // Verify only one default exists
+    const all = svc.list();
+    const defaults = all.filter(e => e.is_default === 1);
+    expect(defaults).toHaveLength(1);
+  });
+
+  it("prevents removal of default endpoint", () => {
+    const dbPath = tempDb("protect.sqlite");
+    const db = new DatabaseService(dbPath);
+    const svc = new SummaryEndpointService(db);
+
+    const def = svc.getDefault();
+    expect(def).not.toBeNull();
+    const removed = svc.remove(def!.id);
+    expect(removed).toBe(false);
+    expect(svc.getById(def!.id)).not.toBeNull();
+  });
+
+  it("validates OpenAI-compatible base URLs are stored as-is and never logged", () => {
+    const dbPath = tempDb("url.sqlite");
+    const db = new DatabaseService(dbPath);
+    const svc = new SummaryEndpointService(db);
+
+    const created = svc.create({
+      name: "openai-compat",
+      base_url: "https://api.openai-compatible.example/v1",
+      model: "gpt-4o-mini"
+    });
+    expect(created.base_url).toBe("https://api.openai-compatible.example/v1");
+    // Service does not expose api_key/secret fields
+    const raw = db.prepare("PRAGMA table_info(summary_llm_endpoints)").all() as any[];
+    const colNames = raw.map(c => c.name);
+    expect(colNames).not.toContain("api_key");
+    expect(colNames).not.toContain("secret");
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

# THE SLICE — D2 (run command-center-2026-08-26)

## Scope (do ONLY this)
Services layer: `SummaryEndpointService` owner-scoped add/edit/remove/default; seed OpenAI-compatible endpoint labelled `140`; never log secrets.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **F1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice D2 -- npx vitest run tests/unit/summary-endpoint-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D2 attempt=1 role=validator
  marker=DRV-D2-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate D2 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator D2 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/D2-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=D2 attempt=1 marker=DRV-D2-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
