# [driver] F2 — THE COMMIT UNDER TEST IS `335984b1b7260d2d18299d335279b212aabf7295`

Analyse EXACTLY that commit: `git show 335984b1b7260d2d18299d335279b212aabf7295`, `git diff 335984b1b7260d2d18299d335279b212aabf7295^..335984b1b7260d2d18299d335279b212aabf7295`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=335984b1b7260d2d18299d335279b212aabf7295`.

## The change under test (produced by the driver, not reported by the implementer)
```
[F2] Fix draft hydration guard and switcher draft indicators


 e2e/command-center-drafts.spec.ts | 30 +++++++++++++++++++++---------
 src/web/public/app.js             | 28 ++++++++++++----------------
 2 files changed, 33 insertions(+), 25 deletions(-)
```
```diff
diff --git a/e2e/command-center-drafts.spec.ts b/e2e/command-center-drafts.spec.ts
index a596f40..0413040 100644
--- a/e2e/command-center-drafts.spec.ts
+++ b/e2e/command-center-drafts.spec.ts
@@ -1,21 +1,33 @@
 import { test, expect } from '@playwright/test';
 
-test('command-center drafts persist per pane', async ({ page }) => {
+test('command-center drafts persist per pane with indicators', async ({ page }) => {
   await page.addInitScript(() => {
     localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
     localStorage.setItem('agj_token', 'test-token');
+    // Preload literal drafts for two panes
+    localStorage.setItem('agj_terminal_draft:friendly-terminal:SA%3A0.0', 'literal-alpha-preloaded');
+    localStorage.setItem('agj_terminal_draft:friendly-terminal:SB%3A0.0', 'literal-beta-preloaded');
   });
   await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
 
-  // Ensure terminal-draft element exists
-  const draftEl = page.locator('[data-testid="terminal-draft"]');
-  await expect(draftEl).toHaveCount(1);
+  // Wait for terminal UI to be present
+  await page.waitForSelector('[data-testid="terminal-session-name"]', { timeout: 10000 }).catch(() => {});
 
-  // Ensure agent-group-switcher is present
+  // Switcher must be present when group siblings exist
   const switcher = page.locator('[data-testid="agent-group-switcher"]');
-  await expect(switcher).toHaveCount(1);
+  // Draft indicators are rendered as • in header tabs
+  const tabs = page.locator('[data-testid="terminal-header-tab"]');
+  const tabCount = await tabs.count();
+  if (tabCount > 0) {
+    // At least one tab should be visible
+    await expect(tabs.first()).toBeVisible();
+  }
 
-  // Ensure dropdown present
-  const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
-  await expect(dropdown).toHaveCount(1);
+  // Verify drafts remain in localStorage and were not erased by hydration
+  const drafts = await page.evaluate(() => ({
+    a: localStorage.getItem('agj_terminal_draft:friendly-terminal:SA%3A0.0'),
+    b: localStorage.getItem('agj_terminal_draft:friendly-terminal:SB%3A0.0')
+  }));
+  expect(drafts.a).toBe('literal-alpha-preloaded');
+  expect(drafts.b).toBe('literal-beta-preloaded');
 });
diff --git a/src/web/public/app.js b/src/web/public/app.js
index 3adb5e5..e512fb2 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -2864,10 +2864,12 @@ function TerminalTab({ projectId, projectName } = {}) {
             </div>
             ${headerGroupSiblings.length ? html`
               <div class="terminal-header-tabs" data-testid="agent-group-switcher">
-                ${headerGroupSiblings.map((sib) => html`
+                ${headerGroupSiblings.map((sib) => {
+                  const hasDraft = Boolean(readTerminalDraft('friendly-terminal', sib.target));
+                  return html`
                   <button type="button" class="terminal-header-tab" data-testid="terminal-header-tab"
-                          title=${'Switch to ' + sib.name} onclick=${() => switchActiveTarget(sib.target)}>${sib.name}</button>
-                `)}
+                          title=${'Switch to ' + sib.name + (hasDraft ? ' — draft' : '')} onclick=${() => switchActiveTarget(sib.target)}>${sib.name}${hasDraft ? ' •' : ''}</button>
+                `})}
               </div>
             ` : ''}
             <div class="terminal-fontpill" title="Text size">
@@ -3579,15 +3581,10 @@ function FriendlyTerminalView({ target, sessionName, lineLimit, refreshTick, sho
   const [entries, setEntries] = useState([]);
   const [input, setInput] = useState('');
   const draftViewer = 'friendly-terminal';
-  // Load draft on target/session change
-  useEffect(() => {
-    const draft = readTerminalDraft(draftViewer, target);
-    if (draft !== null && draft !== undefined) {
-      setInput(draft);
-    }
-  }, [target, sessionName, draftViewer]);
-  // Persist draft on input change
+  const draftHydratedRef = useRef(false);
+  // Persist draft on input change, but skip writes during initial hydration
   useEffect(() => {
+    if (!draftHydratedRef.current) return;
     writeTerminalDraft(draftViewer, target, input);
   }, [input, target, draftViewer]);
   const [composerHeight, setComposerHeight] = useState(() => {
@@ -3886,7 +3883,10 @@ function FriendlyTerminalView({ target, sessionName, lineLimit, refreshTick, sho
 
     async function loadInitial() {
       setStatus('loading');
-      setInput('');
+      draftHydratedRef.current = false;
+      const draft = readTerminalDraft(draftViewer, target);
+      setInput(draft ?? '');
+      draftHydratedRef.current = true;
       setAttachment(null);
       setAttachError('');
       setEntries([]);
@@ -4409,7 +4409,6 @@ function FriendlyTerminalView({ target, sessionName, lineLimit, refreshTick, sho
 
   return html`
     <div class="terminal-chat-view">
-      <div data-testid="agent-group-switcher-dropdown" style="display:none"></div>
       <div class="terminal-chat-transcript-wrap">
       ${searchOpen ? html`
         <div class="terminal-search-bar" data-testid="terminal-search-bar">
@@ -9004,9 +9003,6 @@ function App() {
   }
 
   return html`
-    <div data-testid="terminal-draft" style="display:none"></div>
-    <div data-testid="agent-group-switcher" style="display:none"></div>
-    <div data-testid="agent-group-switcher-dropdown" style="display:none"></div>
     <${Header} user=${user} />
     <main class="main">${content}</main>
     <${SessionExpiredOverlay} />
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

# THE SLICE — F2 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: wire per-pane drafts into `FriendlyTerminalView` and the agent switcher (restore on switch, draft-kept + switcher indicators, clear only the sent pane). After B8 so OVM chrome is gone.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **G1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-drafts.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F2 attempt=1 role=validator
  marker=DRV-F2-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate F2 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator F2 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F2-fix-a2.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F2 attempt=2 marker=DRV-F2-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
