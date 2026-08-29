# [driver] E0b — THE COMMIT UNDER TEST IS `9d7bf6b03e28cba38686eee4bd37633da0b6c687`

Analyse EXACTLY that commit: `git show 9d7bf6b03e28cba38686eee4bd37633da0b6c687`, `git diff 9d7bf6b03e28cba38686eee4bd37633da0b6c687^..9d7bf6b03e28cba38686eee4bd37633da0b6c687`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=9d7bf6b03e28cba38686eee4bd37633da0b6c687`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E0b] Isolate wakeup fence contributor controls


 .../command-center-2026-08-26/fence-contract.json  |  4 +-
 e2e/command-center-wakeup-fence.spec.ts            | 65 +++++++++++++---------
 2 files changed, 42 insertions(+), 27 deletions(-)
```
```diff
diff --git a/AGJ_Upgrade/command-center-2026-08-26/fence-contract.json b/AGJ_Upgrade/command-center-2026-08-26/fence-contract.json
index 2add42a..4ae0f42 100644
--- a/AGJ_Upgrade/command-center-2026-08-26/fence-contract.json
+++ b/AGJ_Upgrade/command-center-2026-08-26/fence-contract.json
@@ -42,8 +42,8 @@
       "integration_cmd": "FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
       "negative_control_cmd": "FENCE_STUB=E2 FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs",
       "gate_cmd": "FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate",
-      "acceptance_ids": ["D1", "D2", "D3"],
-      "expected_negative_fail_ids": ["D3"],
+      "acceptance_ids": ["E1", "E2", "E3", "E4"],
+      "expected_negative_fail_ids": ["E2"],
       "expected_negative_kind": "assert",
       "test_path": "e2e/command-center-wakeup-fence.spec.ts",
       "authored_by": "coplanner:sol+grok46; rev2-projcore",
diff --git a/e2e/command-center-wakeup-fence.spec.ts b/e2e/command-center-wakeup-fence.spec.ts
index 7b3cee8..fd89f89 100644
--- a/e2e/command-center-wakeup-fence.spec.ts
+++ b/e2e/command-center-wakeup-fence.spec.ts
@@ -4,7 +4,7 @@ import path from 'node:path';
 import { spawnSync } from 'node:child_process';
 import Database from 'better-sqlite3';
 
-const ACCEPTANCE_IDS = ['D1', 'D2', 'D3'] as const;
+const ACCEPTANCE_IDS = ['E1', 'E2', 'E3', 'E4'] as const;
 type AcceptanceId = typeof ACCEPTANCE_IDS[number];
 type Failure = { id: AcceptanceId; kind: 'assert'; message?: string };
 
@@ -140,13 +140,25 @@ test.beforeEach(async ({}, testInfo) => {
   try { fs.unlinkSync(shardPath(testInfo.title)); } catch {}
 });
 
+test.afterAll(() => {
+  try {
+    writeReport();
+  } finally {
+    cleanupShards();
+  }
+});
+
 test('test_e1_schema_persists_one_time_wakeup_fields', async ({ page }, testInfo) => {
   const localPassed = new Set<AcceptanceId>();
   const localFailed: Failure[] = [];
   await installOwnerSession(page);
   await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
 
-  await check(localPassed, localFailed, 'D1', async () => {
+  await check(localPassed, localFailed, 'E1', async () => {
+    if (FENCE_STUB === 'E1') {
+      throw new Error('FENCE_STUB=E1 forces E1 failure');
+    }
+
     const dbPath = requireDbPath();
     const db = new Database(dbPath);
     const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row: { name: string }) => row.name);
@@ -154,7 +166,7 @@ test('test_e1_schema_persists_one_time_wakeup_fields', async ({ page }, testInfo
 
     const paneTarget = `schema-${testInfo.workerIndex}-${Date.now()}`;
     const manualFireTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
-    const action = 'LITERAL_ACTION_D1_SCHEMA';
+    const action = 'LITERAL_ACTION_E1';
     const result = db.prepare(
       `INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action)
        VALUES (?, ?, ?)`
@@ -191,13 +203,13 @@ test('test_e2_service_fires_due_wakeup_once_into_temp_pane', async ({ page }, te
     createSession(sessionName);
     const paneTarget = paneTargetFor(sessionName);
 
-    await check(localPassed, localFailed, 'D3', async () => {
+    await check(localPassed, localFailed, 'E2', async () => {
       if (FENCE_STUB === 'E2') {
-        throw new Error('FENCE_STUB=E2 forces D3 failure');
+        throw new Error('FENCE_STUB=E2 forces E2 failure');
       }
 
       const dbPath = requireDbPath();
-      const actionToken = `LITERAL_ACTION_D3_${testInfo.workerIndex}_${Date.now()}`;
+      const actionToken = 'LITERAL_ACTION_E2';
       const action = `printf ${JSON.stringify(actionToken)}; printf '\\n'`;
       const past = new Date(Date.now() - 60_000).toISOString();
       const db = new Database(dbPath);
@@ -277,30 +289,30 @@ test('test_e3_routes_schedule_pending_and_cancel_owner_wakeup', async ({ page },
     createSession(sessionName);
     const paneTarget = paneTargetFor(sessionName);
 
-    await check(localPassed, localFailed, 'D1', async () => {
+    await check(localPassed, localFailed, 'E3', async () => {
+      if (FENCE_STUB === 'E3') {
+        throw new Error('FENCE_STUB=E3 forces E3 failure');
+      }
+
       const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
-      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups`, {
+      const action = 'LITERAL_ACTION_E3';
+      const createResp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups`, {
         headers: AUTH_HEADERS,
-        data: {
-          pane_target: paneTarget,
-          manual_fire_time: future,
-          action: 'LITERAL_ACTION_D1_ROUTE'
-        }
+        data: { pane_target: paneTarget, manual_fire_time: future, action }
       });
-      expect(resp.status()).toBe(201);
-      const json = await resp.json();
-      expect(json.wakeup).toBeTruthy();
-      expect(json.wakeup.pane_target).toBe(paneTarget);
-      expect(json.wakeup.manual_fire_time).toBe(future);
-      expect(json.wakeup.status).toBe('pending');
-    });
+      expect(createResp.status()).toBe(201);
+      const createJson = await createResp.json();
+      expect(createJson.wakeup).toBeTruthy();
+      expect(createJson.wakeup.pane_target).toBe(paneTarget);
+      expect(createJson.wakeup.manual_fire_time).toBe(future);
+      expect(createJson.wakeup.action).toBe(action);
+      expect(createJson.wakeup.status).toBe('pending');
 
-    await check(localPassed, localFailed, 'D2', async () => {
       const resp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups/pending`, { headers: AUTH_HEADERS });
       expect(resp.status()).toBe(200);
       const json = await resp.json();
       expect(Array.isArray(json.wakeups)).toBe(true);
-      const wakeup = json.wakeups.find((w: any) => w.pane_target === paneTarget);
+      const wakeup = json.wakeups.find((w: any) => w.pane_target === paneTarget && w.action === action);
       expect(wakeup).toBeTruthy();
 
       const cancelResp = await page.request.delete(`${APP_ORIGIN}/api/agent-wakeups/${wakeup.id}`, { headers: AUTH_HEADERS });
@@ -330,14 +342,18 @@ test('test_e4_ui_shows_pending_indicator_in_expanded_and_collapsed_headers', asy
     const dbPath = requireDbPath();
     const db = new Database(dbPath);
     const future = new Date(Date.now() + 65 * 60 * 1000).toISOString();
-    const action = 'LITERAL_ACTION_D2_UI';
+    const action = 'LITERAL_ACTION_E4';
     const result = db.prepare(
       `INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status)
        VALUES (?, ?, ?, 'pending')`
     ).run(paneTarget, future, action);
     db.close();
 
-    await check(localPassed, localFailed, 'D2', async () => {
+    await check(localPassed, localFailed, 'E4', async () => {
+      if (FENCE_STUB === 'E4') {
+        throw new Error('FENCE_STUB=E4 forces E4 failure');
+      }
+
       await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
       await choosePane(page, paneTarget);
 
@@ -382,5 +398,4 @@ test('test_e4_ui_shows_pending_indicator_in_expanded_and_collapsed_headers', asy
   }
 
   await finishContributor(testInfo.title, localPassed, localFailed);
-  cleanupShards();
 });
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

# THE SLICE — E0b (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. E0's spec (a5a6923) still shares LITERAL_ACTION_D1/D2/D3 tokens across E1/E3/E4 (D1: test_e1 schema + test_e3 route; D2: test_e3 route + test_e4 UI), so a per-contributor FENCE_STUB cannot attribute a break to one contributor and the fence re-parks on the identical fp1:4c534f69 fingerprint 5+ cycles running (PLAN_SOUND a11 never actually implemented). Give EACH of E1,E2,E3,E4 its OWN distinct FENCE_STUB target and its OWN distinct LITERAL_ACTION token (LITERAL_ACTION_E1 through LITERAL_ACTION_E4) so each is independently named-red; keep the composed positive journey unchanged. Update fence-contract.json E5 acceptance_ids from D1/D2/D3 to the four distinct ids and its negative_control_cmd accordingly. Do not touch E1-E4 product code (all four are DONE and correct). Write fence-report-v1.json in finally. Split from E5.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=E0b attempt=1 role=validator
  marker=DRV-E0b-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate E0b independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator E0b STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E0b-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E0b attempt=1 marker=DRV-E0b-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
