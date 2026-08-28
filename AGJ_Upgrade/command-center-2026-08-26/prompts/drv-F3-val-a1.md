# [driver] F3 — THE COMMIT UNDER TEST IS `f825618ec778ca5209ce59ecf3babead8f02dc02`

Analyse EXACTLY that commit: `git show f825618ec778ca5209ce59ecf3babead8f02dc02`, `git diff f825618ec778ca5209ce59ecf3babead8f02dc02^..f825618ec778ca5209ce59ecf3babead8f02dc02`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=f825618ec778ca5209ce59ecf3babead8f02dc02`.

## The change under test (produced by the driver, not reported by the implementer)
```
[F3] Refresh rebuilds transcript and test fixtures


 e2e/command-center-refresh.spec.ts | 17 ++++++++++++++++-
 src/web/public/app.js              | 15 ++++++++++++++-
 2 files changed, 30 insertions(+), 2 deletions(-)
```
```diff
diff --git a/e2e/command-center-refresh.spec.ts b/e2e/command-center-refresh.spec.ts
index 6bcc448..2ab1417 100644
--- a/e2e/command-center-refresh.spec.ts
+++ b/e2e/command-center-refresh.spec.ts
@@ -39,7 +39,15 @@ test('command-center refresh control is always reachable and re-pulls output and
   await page.route('**/api/tmux/panes/*/output*', async route => {
     outputCallCount++;
     const isExplicitRefresh = new URL(route.request().url()).searchParams.get('refresh') === '1';
-    if (!isExplicitRefresh || !pendingRefreshOutput) {
+    if (!isExplicitRefresh) {
+      await route.fulfill({
+        status: 200,
+        contentType: 'application/json',
+        body: JSON.stringify({ output: 'initial output fixture' })
+      });
+      return;
+    }
+    if (!pendingRefreshOutput) {
       await route.fulfill({
         status: 200,
         contentType: 'application/json',
@@ -84,6 +92,9 @@ test('command-center refresh control is always reachable and re-pulls output and
 
   const refreshStatus = page.locator('[data-testid="terminal-refresh-status"]');
 
+  // Initial output fixture must be rendered
+  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('initial output fixture', { timeout: 10000 });
+
   // The second literal output fixture belongs to the normal-topbar refresh.
   pendingRefreshOutput = 'refreshed output fixture';
 
@@ -109,6 +120,7 @@ test('command-center refresh control is always reachable and re-pulls output and
 
   // Verify UI reflects second fixtures: output appears in transcript
   await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('refreshed output fixture', { timeout: 10000 });
+  await expect(page.locator('[data-testid="terminal-conversation"]')).not.toContainText('initial output fixture');
 
   // Search-open uses the same persistent refresh cluster, including live status.
   const searchToggle = page.locator('[data-testid="terminal-search-toggle"]');
@@ -131,5 +143,8 @@ test('command-center refresh control is always reachable and re-pulls output and
   await expect(refreshStatusInSearch).toContainText('Refreshing');
   await expect(refreshStatusInSearch).not.toContainText('Updated');
   await expect(refreshStatusInSearch).toContainText('Updated', { timeout: 10000 });
+  // Verify search-open refresh replaces transcript
+  await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('search refresh output fixture', { timeout: 10000 });
+  await expect(page.locator('[data-testid="terminal-conversation"]')).not.toContainText('initial output fixture');
   expect(searchRefreshOutputServed).toBe(true);
 });
diff --git a/src/web/public/app.js b/src/web/public/app.js
index 4733c13..ebe9a5c 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -3706,6 +3706,19 @@ function FriendlyTerminalView({ target, sessionName, lineLimit, refreshTick, sho
     setStatusLine(extractStatus(latest));
   }
 
+  function processRefreshSnapshot(latest) {
+    if (!latest) return;
+    maybeFlushPendingNote(latest);
+    snapshotRef.current = latest;
+    previousSnapshotRef.current = latest;
+    setSnapshot(latest);
+    setLastUpdatedAt(Date.now());
+    setStatusLine(extractStatus(latest));
+    const seed = [];
+    const entriesNext = applyAgentPatch(seed, latest);
+    setEntries(entriesNext);
+  }
+
   // A note attached to a selection can only be delivered once the agent is idle
   // again (typing into a busy composer doesn't submit). Hold it until the prompt
   // is gone and the agent isn't generating — after we've seen it busy, or a
@@ -3751,7 +3764,7 @@ function FriendlyTerminalView({ target, sessionName, lineLimit, refreshTick, sho
 
   async function refreshOutput() {
     const data = await api(`/api/tmux/panes/${encodeURIComponent(target)}/output?lines=${getCaptureLines()}&refresh=1`);
-    processSnapshot(normalizeTerminalOutput(data.output));
+    processRefreshSnapshot(normalizeTerminalOutput(data.output));
   }
 
   async function handleRefresh() {
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

# THE SLICE — F3 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: always-reachable refresh control on `FriendlyTerminalView`; re-pull pane output and session metadata together; in-progress then completion; composer stays interactive. Project `cc` supplies live API/tmux. North 2026-08-27 PLAN_SOUND: I1/I2 satisfiable; after L1 resume at L4 (sol) with budget 6 so >=2 strong informed attempts on the a4 remainder.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **I1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **I2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-refresh.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F3 attempt=1 role=validator
  marker=DRV-F3-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate F3 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator F3 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F3-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F3 attempt=1 marker=DRV-F3-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
