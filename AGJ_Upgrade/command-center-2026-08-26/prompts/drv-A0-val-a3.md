# [driver] A0 — THE COMMIT UNDER TEST IS `dc3833015586d0268a57704d941df14158b678ae`

Analyse EXACTLY that commit: `git show dc3833015586d0268a57704d941df14158b678ae`, `git diff dc3833015586d0268a57704d941df14158b678ae^..dc3833015586d0268a57704d941df14158b678ae`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=dc3833015586d0268a57704d941df14158b678ae`.

## The change under test (produced by the driver, not reported by the implementer)
```
[A0] Pre-registration FENCE_STUB hook, real F1->G3 session-refresh wiring


 e2e/command-center-window-fence.spec.ts |  7 +++++--
 src/api/server.ts                       | 37 +++++++++++++++++++++++++++++++++
 src/index.ts                            | 33 -----------------------------
 3 files changed, 42 insertions(+), 35 deletions(-)
```
```diff
diff --git a/e2e/command-center-window-fence.spec.ts b/e2e/command-center-window-fence.spec.ts
index 67b0f5b..461f45d 100644
--- a/e2e/command-center-window-fence.spec.ts
+++ b/e2e/command-center-window-fence.spec.ts
@@ -34,8 +34,11 @@ test('command-center window fence journey', async ({ page }) => {
     });
 
     await check('G3', async () => {
-      const refresh = page.locator('[data-testid="refresh-from-session"]');
-      await expect(refresh).toBeVisible();
+      // Direct check on the backing session-refresh data path (not a UI
+      // locator) so FENCE_STUB=F1 can force this assertion mechanically,
+      // matching the endpoint-check pattern used by every sibling fence.
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-session/refresh`);
+      expect(resp.status()).toBe(200);
     });
 
     await check('H1', async () => {
diff --git a/src/api/server.ts b/src/api/server.ts
index faf8020..b6ada9e 100644
--- a/src/api/server.ts
+++ b/src/api/server.ts
@@ -135,6 +135,43 @@ export async function createApiServer(
     timestamp: new Date().toISOString()
   }));
 
+  // FENCE_STUB pre-registration patch: this hook must be added before any
+  // register*Routes() call below, because a Fastify hook only applies to
+  // routes declared after it in the same encapsulation context — added
+  // late (post-registration), it silently never fires for existing routes.
+  if (process.env.FENCE_STUB) {
+    const stub = process.env.FENCE_STUB;
+    app.addHook("preHandler", async (request, reply) => {
+      const url = request.url || "";
+      // B2: make overmind status return 200 for negative control
+      if (stub === "B2" && url.startsWith("/api/overmind/status")) {
+        reply.code(200).type("application/json").send({ stubbed: true, contributor: "B2" });
+        return reply;
+      }
+      // C3: make reminders active fail
+      if (stub === "C3" && url.startsWith("/api/agent-reminders/active")) {
+        reply.code(500).type("application/json").send({ stubbed: true, contributor: "C3" });
+        return reply;
+      }
+      // D3: make summary endpoints fail
+      if (stub === "D3" && url.startsWith("/api/summary-endpoints")) {
+        reply.code(500).type("application/json").send({ stubbed: true, contributor: "D3" });
+        return reply;
+      }
+      // E2: make wakeups fire fail
+      if (stub === "E2" && url.startsWith("/api/agent-wakeups/fire")) {
+        reply.code(500).type("application/json").send({ stubbed: true, contributor: "E2" });
+        return reply;
+      }
+      // F1: make the agent-session refresh data path (backs G3's
+      // refresh-from-session surface) fail
+      if (stub === "F1" && url.startsWith("/api/agent-session/refresh")) {
+        reply.code(500).type("application/json").send({ stubbed: true, contributor: "F1" });
+        return reply;
+      }
+    });
+  }
+
   // Register route groups
   registerTgLoginRoutes(app, config, services.telegramAssistant);
   registerLokalaiLinkRoutes(app, config);
diff --git a/src/index.ts b/src/index.ts
index e1a2218..6d6a1e2 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -158,39 +158,6 @@ async function main(): Promise<void> {
     telegramAssistant
   });
 
-  // FENCE_STUB in-process preload: patch Fastify before route registration
-  if (process.env.FENCE_STUB) {
-    const stub = process.env.FENCE_STUB;
-    apiServer.addHook('preHandler', async (request, reply) => {
-      const url = request.url || '';
-      // B2: make overmind status return 200 for negative control
-      if (stub === 'B2' && url.startsWith('/api/overmind/status')) {
-        reply.code(200).type('application/json').send({ stubbed: true, contributor: 'B2' });
-        return reply;
-      }
-      // C3: make reminders active fail
-      if (stub === 'C3' && url.startsWith('/api/agent-reminders/active')) {
-        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'C3' });
-        return reply;
-      }
-      // D3: make summary endpoints fail
-      if (stub === 'D3' && url.startsWith('/api/summary-endpoints')) {
-        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'D3' });
-        return reply;
-      }
-      // E2: make wakeups fire fail
-      if (stub === 'E2' && url.startsWith('/api/agent-wakeups/fire')) {
-        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'E2' });
-        return reply;
-      }
-      // F1: make agent group switcher fail
-      if (stub === 'F1' && url.startsWith('/api/agent-group-switcher')) {
-        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'F1' });
-        return reply;
-      }
-    });
-  }
-
   await apiServer.listen({ port: config.api.port, host: config.api.host });
   console.log(`AGJAssist API server listening on ${config.api.host}:${config.api.port}`);
   overmindWatcher.start();
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

# THE SLICE — A0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Validator gates this row on `--harness-smoke` exit 0, NEVER on product A5. `acs` is HARNESS-SMOKE (not A5 — A5 stays B8/G2). Recovered HEAD still uses an HTTP proxy for FENCE_STUB (`scripts/cc-run-isolated.mjs` startStubProxy); remaining work: replace that with in-process Fastify preload so FENCE_STUB=ID patches the unit before route/job registration (INTERCEPTION_GAP). Also: every spec writes fence-report-v1.json in finally; `--gate` requires named expected_negative_fail_ids kind=assert (no synthesized ids); print reclaimed_bytes. Recovered commits already on HEAD (3439337). No product OVM removal.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --harness-smoke`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=A0 attempt=1 role=validator
  marker=DRV-A0-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate A0 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator A0 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/A0-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=A0 attempt=3 marker=DRV-A0-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
