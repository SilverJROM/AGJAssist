# [driver] H8 — THE COMMIT UNDER TEST IS `78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b`

Analyse EXACTLY that commit: `git show 78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b`, `git diff 78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b^..78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b`.

## The change under test (produced by the driver, not reported by the implementer)
```
[H8] Fix harness correctness for B8 CLOSE measurement


 e2e/command-center-ovm-fence.spec.ts        |  1 -
 e2e/run-command-center-playwright-fence.mjs | 10 +++--
 src/api/server.ts                           | 58 +++++++++++++++--------------
 3 files changed, 36 insertions(+), 33 deletions(-)
```
```diff
diff --git a/e2e/command-center-ovm-fence.spec.ts b/e2e/command-center-ovm-fence.spec.ts
index c856e79..afb5b39 100644
--- a/e2e/command-center-ovm-fence.spec.ts
+++ b/e2e/command-center-ovm-fence.spec.ts
@@ -16,7 +16,6 @@ test('command-center ovm fence journey', async ({ page }) => {
       passed.push(id);
     } catch (e) {
       failed.push({ id, kind: 'assert' });
-      throw new Error(`FENCE_ASSERT:${id}`);
     }
   };
 
diff --git a/e2e/run-command-center-playwright-fence.mjs b/e2e/run-command-center-playwright-fence.mjs
index 30fb5e3..b4ecad3 100644
--- a/e2e/run-command-center-playwright-fence.mjs
+++ b/e2e/run-command-center-playwright-fence.mjs
@@ -19,8 +19,8 @@ if (!fence) {
   process.exit(1);
 }
 
-function verdictLine() {
-  return `[FENCE-VERDICT-V1] run=command-center-2026-08-26 fence=${fenceId} stub=${stub || 'none'} ts=${Date.now()}`;
+function verdictLine(verdict='PASS', faultClass='none') {
+  return `fence=${fenceId} verdict=${verdict} fault_class=${faultClass}`;
 }
 
 function writeReport(collected, passed, failed) {
@@ -109,9 +109,11 @@ if (gate) {
 }
 
 const testPath = fence.test_path;
-const integrationCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId });
+const integrationCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_REPORT_PATH: reportPath });
 const specReport = readReport(reportPath) || { schema: 'fence-report-v1', collected: fence.acceptance_ids, passed: [], failed: [] };
-specReport.verdict_line = verdictLine();
+const verdict = integrationCode === 0 ? 'PASS' : 'FAIL';
+const faultClass = integrationCode === 0 ? 'none' : 'implementation';
+specReport.verdict_line = verdictLine(verdict, faultClass);
 fs.writeFileSync(reportPath, JSON.stringify(specReport, null, 2) + '\n');
 console.log(specReport.verdict_line);
 process.exit(integrationCode);
diff --git a/src/api/server.ts b/src/api/server.ts
index a868046..c9fa373 100644
--- a/src/api/server.ts
+++ b/src/api/server.ts
@@ -133,35 +133,37 @@ export async function createApiServer(
   // late (post-registration), it silently never fires for existing routes.
   if (process.env.FENCE_STUB) {
     const stub = process.env.FENCE_STUB;
-    app.addHook("preHandler", async (request, reply) => {
-      const url = request.url || "";
-      // B2: make overmind status return 200 for negative control
-      if (stub === "B2" && url.startsWith("/api/overmind/status")) {
+    if (stub === "B2") {
+      // Re-register stub GET for unregistered /api/overmind/status so preHandler never fires
+      app.get("/api/overmind/status", async (request, reply) => {
         reply.code(200).type("application/json").send({ stubbed: true, contributor: "B2" });
-        return reply;
-      }
-      // C3: make reminders active fail
-      if (stub === "C3" && url.startsWith("/api/agent-reminders/active")) {
-        reply.code(500).type("application/json").send({ stubbed: true, contributor: "C3" });
-        return reply;
-      }
-      // D3: make summary endpoints fail
-      if (stub === "D3" && url.startsWith("/api/summary-endpoints")) {
-        reply.code(500).type("application/json").send({ stubbed: true, contributor: "D3" });
-        return reply;
-      }
-      // E2: make wakeups fire fail
-      if (stub === "E2" && url.startsWith("/api/agent-wakeups/fire")) {
-        reply.code(500).type("application/json").send({ stubbed: true, contributor: "E2" });
-        return reply;
-      }
-      // F1: make the agent-session refresh data path (backs G3's
-      // refresh-from-session surface) fail
-      if (stub === "F1" && url.startsWith("/api/agent-session/refresh")) {
-        reply.code(500).type("application/json").send({ stubbed: true, contributor: "F1" });
-        return reply;
-      }
-    });
+      });
+    } else {
+      app.addHook("preHandler", async (request, reply) => {
+        const url = request.url || "";
+        // C3: make reminders active fail
+        if (stub === "C3" && url.startsWith("/api/agent-reminders/active")) {
+          reply.code(500).type("application/json").send({ stubbed: true, contributor: "C3" });
+          return reply;
+        }
+        // D3: make summary endpoints fail
+        if (stub === "D3" && url.startsWith("/api/summary-endpoints")) {
+          reply.code(500).type("application/json").send({ stubbed: true, contributor: "D3" });
+          return reply;
+        }
+        // E2: make wakeups fire fail
+        if (stub === "E2" && url.startsWith("/api/agent-wakeups/fire")) {
+          reply.code(500).type("application/json").send({ stubbed: true, contributor: "E2" });
+          return reply;
+        }
+        // F1: make the agent-session refresh data path (backs G3's
+        // refresh-from-session surface) fail
+        if (stub === "F1" && url.startsWith("/api/agent-session/refresh")) {
+          reply.code(500).type("application/json").send({ stubbed: true, contributor: "F1" });
+          return reply;
+        }
+      });
+    }
   }
 
   // Register route groups
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

# THE SLICE — H8 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Fix B8 CLOSE measurement. Do not remove more product. (1) e2e/command-center-ovm-fence.spec.ts collects ALL of A1,A2,A3,A4,A5,B1,B2 and does not throw after a named assert; write passed and failed in finally. (2) e2e/run-command-center-playwright-fence.mjs sets FENCE_REPORT_PATH on the integration path, copies spec passed/failed into fence-report-v1.json, and verdict_line contains whitespace-split tokens fence=B8 verdict=PASS or FAIL fault_class=none or implementation or plan (no spaces in values). (3) FENCE_STUB=B2: a Fastify preHandler on unregistered /api/overmind/status never fires; re-register a stub GET that returns 200 so A2 kind=assert is named-red. --gate must exit 0: positive PASS with B2 in passed, negative named-red on A2.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=H8 attempt=1 role=validator
  marker=DRV-H8-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate H8 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator H8 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/H8-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=H8 attempt=1 marker=DRV-H8-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
