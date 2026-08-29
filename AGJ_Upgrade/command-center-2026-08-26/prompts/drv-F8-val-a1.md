# [driver] F8 — THE COMMIT UNDER TEST IS `d70d12cd6783dfcf713e2d1c052c1bfd7257a07c`

Analyse EXACTLY that commit: `git show d70d12cd6783dfcf713e2d1c052c1bfd7257a07c`, `git diff d70d12cd6783dfcf713e2d1c052c1bfd7257a07c^..d70d12cd6783dfcf713e2d1c052c1bfd7257a07c`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=d70d12cd6783dfcf713e2d1c052c1bfd7257a07c`.

## The change under test (produced by the driver, not reported by the implementer)
```
[F8] restore mobile terminal controls


 src/web/public/app.js    |  2 +-
 src/web/public/style.css | 23 ++++++++++++++++++++---
 2 files changed, 21 insertions(+), 4 deletions(-)
```
```diff
diff --git a/src/web/public/app.js b/src/web/public/app.js
index bffde04..d5e8c0d 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -3220,7 +3220,7 @@ function TerminalTab({ projectId, projectName } = {}) {
                   }, {diff: Infinity});
                   const nearestMin = count ? Math.max(0, Math.round(nearest.diff/60000)) : null;
                   return html`
-                    <button type="button" data-testid="wakeup-expand-toggle" onclick=${() => setWakeupExpanded(e => !e)}>${wakeupExpanded ? 'Collapse' : 'Expand'}</button>
+                    <button type="button" data-testid="wakeup-expand-toggle" onclick=${() => setWakeupExpanded(e => !e)}>${wakeupExpanded ? 'Hide wakeups' : 'Show wakeups'}</button>
                     <span data-testid="wakeup-collapsed-summary" style="margin-left:8px">${count === 0 ? 'No pending wakeups' : `${count} wakeup${count!==1?'s':''} · in ${nearestMin}m`}</span>
                     ${wakeupExpanded ? html`
                       ${count === 0 ? html`<div>No pending wakeups</div>` : html`
diff --git a/src/web/public/style.css b/src/web/public/style.css
index 2b85b46..06a0d51 100644
--- a/src/web/public/style.css
+++ b/src/web/public/style.css
@@ -1058,9 +1058,26 @@ body.tg-miniapp:not(.tg-light) .terminal-group-overlay {
   .command-center-toggle { display:none; }
   .terminal-header-tabs { display: none !important; }
   .agent-group-switcher-scrubber { display: none !important; }
-  /* Keep the phone switcher and terminal controls in separate flex boxes. */
-  .terminal-topbar-main:has(.command-center-header) .cc-ctrl-items { display:none; }
-  .terminal-topbar-main:has(.command-center-header) .cc-ctrl-toggle { display:flex; width:28px; height:28px; border-radius:8px; font-size:16px; }
+  /* Keep every terminal control reachable on phones without widening the
+     viewport. The group switcher and the compact control cluster get their
+     own cells within the one topbar, rather than hiding the cluster. */
+  .terminal-topbar-main:has(.command-center-header) {
+    display:grid;
+    grid-template-columns:28px minmax(0, 1fr) auto;
+    grid-template-areas:
+      "back target utilities"
+      "switcher switcher controls";
+    gap:5px;
+  }
+  .terminal-topbar-main:has(.command-center-header) > .terminal-menu-trigger { grid-area:back; }
+  .terminal-topbar-main:has(.command-center-header) > .terminal-topbar-target { grid-area:target; }
+  .terminal-topbar-main:has(.command-center-header) > .command-center-header { grid-area:switcher; }
+  .terminal-topbar-main:has(.command-center-header) > .cc-util-toggle,
+  .terminal-topbar-main:has(.command-center-header) > .command-center-bell { grid-area:utilities; }
+  .terminal-topbar-main:has(.command-center-header) > .cc-ctrlcluster { grid-area:controls; }
+  .terminal-topbar-main:has(.command-center-header) .cc-ctrl-items { display:flex; }
+  .terminal-topbar-main:has(.command-center-header) .cc-ctrl-toggle { display:none; }
+  .terminal-topbar-main:has(.command-center-header) .cc-ctrlcluster.collapsed .cc-ctrl-toggle { display:flex; width:28px; height:28px; border-radius:8px; font-size:16px; }
 }
 @media (min-width: 900px) {
   .terminal-header-tabs { display: flex !important; }
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

# THE SLICE — F8 (run command-center-2026-08-26)

## Scope (do ONLY this)
PRODUCT REGRESSION FIX (north-ruled, not harness). e2e/terminal-ux-conversation.spec.ts A4/A6/A7 fail on current HEAD — confirmed by direct execution, not a harness or environment artifact. The effort north-star's non-negotiable ("do not regress the existing terminal/chat surface — key row, send-as-command/raw-keys, image attach, ME-nav, search, font, groups, selection prompts — across phone/tablet/desktop") is broken at 390px: A4 (type/font live Settings sync + mobile fit), A6 (single topbar controls still perform their functions at 390), A7 (show-raw reveals stripped chrome). The spec is untouched by this run; F4/F5/F6 rewrote app.js/style.css for agent-window-v2 and dropped this. Restore the terminal topbar controls' functionality at 390px per the LOCKED mockup (mockups/final/agent-window-v2.html, mobile-first/390px reference) — un-hide/re-enable what the collapse work dropped, do NOT revert F4-F6's product intent otherwise. Claude implementer only (sonnet5/opus5) — this is app.js/style.css UI work. STOP and escalate to north (not a coordinator call) if the locked mockup itself is found to intentionally omit a control A4/A6/A7 require — that specific conflict is JROM's to resolve, not a default "fix the code" case.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A4** — Migration drops `overmind_projects`, `overmind_workflows`, `overmind_task_history` (+ any overmind-only columns), with a timestamped DB backup taken first; a **fresh** DB and an **upgraded** DB converge to the same schema; `SCHEMA_VERSION` bumped.
- **A6** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **A7** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F8 attempt=1 role=validator
  marker=DRV-F8-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate F8 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator F8 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F8-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F8 attempt=1 marker=DRV-F8-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
