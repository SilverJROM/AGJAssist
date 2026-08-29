# [driver] G1 — THE COMMIT UNDER TEST IS `28d46055f20ee75805516dd6e881454b4aea3c87`

Analyse EXACTLY that commit: `git show 28d46055f20ee75805516dd6e881454b4aea3c87`, `git diff 28d46055f20ee75805516dd6e881454b4aea3c87^..28d46055f20ee75805516dd6e881454b4aea3c87`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=28d46055f20ee75805516dd6e881454b4aea3c87`.

## The change under test (produced by the driver, not reported by the implementer)
```
[G1] harden cleanup regression guards


 src/services/pane-utils.ts           |  5 +++--
 src/web/public/style.css             |  7 +++++++
 tests/command-center-cleanup.test.ts | 28 +++++++++++++++++++++++-----
 3 files changed, 33 insertions(+), 7 deletions(-)
```
```diff
diff --git a/src/services/pane-utils.ts b/src/services/pane-utils.ts
index f17677a..c265f3f 100644
--- a/src/services/pane-utils.ts
+++ b/src/services/pane-utils.ts
@@ -1,5 +1,7 @@
 import { createHash } from "node:crypto";
 
+export const SPINNER_GLYPHS = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
+
 export function hashPane(pane: string): string {
   return createHash("sha256").update(extractBody(pane)).digest("hex");
 }
@@ -28,8 +30,7 @@ export function extractBody(pane: string): string {
 
 export function isPaneChromeLine(line: string): boolean {
   const trimmed = line.trim();
-  const spinnerGlyphs = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
-  const leadingSpinnerRe = new RegExp(`^\\s*[${spinnerGlyphs}]`, "u");
+  const leadingSpinnerRe = new RegExp(`^\\s*[${SPINNER_GLYPHS}]`, "u");
   const statusChromeRe = /bypass permissions|ctrl\+t|to manage|for agents|\/ps to view|\/stop|\bshells?\b|\bmonitors?\b|\/model/i;
   const modelFooterRe = /^\s*(gpt-5|sonnet|opus|haiku|claude)\b.*[·•]\s*~\//i;
   const cwdFooterRe = /[·•]\s*~\/\S*\s*$/;
diff --git a/src/web/public/style.css b/src/web/public/style.css
index af5d488..db83c25 100644
--- a/src/web/public/style.css
+++ b/src/web/public/style.css
@@ -2064,6 +2064,13 @@ input:focus, textarea:focus, select:focus { outline: none; border-color: var(--a
 .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
 
 /* Settings */
+/* JROM 2026-05-24: landing-page preference at the bottom of the Home dashboard.
+   Subtle, separated from the dash cards by a thin border. */
+.tg-home-preferences {
+  margin-top: 20px;
+  padding-top: 14px;
+  border-top: 1px solid var(--border);
+}
 .settings-section { margin-bottom: 24px; }
 .settings-section h3 { font-size: 14px; margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
 .pattern-row {
diff --git a/tests/command-center-cleanup.test.ts b/tests/command-center-cleanup.test.ts
index a1dc565..91ecfb2 100644
--- a/tests/command-center-cleanup.test.ts
+++ b/tests/command-center-cleanup.test.ts
@@ -1,6 +1,7 @@
 import { existsSync, readdirSync, readFileSync } from "node:fs";
 import { resolve } from "node:path";
 import { describe, expect, it } from "vitest";
+import { SPINNER_GLYPHS, hashPane, isPaneChromeLine } from "../src/services/pane-utils.js";
 
 const root = process.cwd();
 
@@ -61,11 +62,9 @@ describe("command-center promotion cleanup", () => {
     }
 
     const app = readFileSync(resolve(root, "src/web/public/app.js"), "utf8");
-    const identifiers = [...new Set(app.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])];
-    for (const identifier of identifiers) {
-      const declaration = new RegExp(`(?:^|\\n)\\s*(?:const|let|var)\\s+${identifier}\\b|import[\\s\\S]*?\\b${identifier}\\b`, "m");
-      expect(declaration.test(app), identifier).toBe(true);
-    }
+    expect(undeclaredModuleConstants(app)).toEqual([]);
+    expect(undeclaredModuleConstants(app.replace("const MCP_OAUTH_RETURN_KEY", "const REMOVED_OAUTH_RETURN_KEY")))
+      .toContain("MCP_OAUTH_RETURN_KEY");
   });
 
   it("keeps only terminal-chat OVM compatibility selectors", () => {
@@ -83,6 +82,12 @@ describe("command-center promotion cleanup", () => {
       ".ovm-chat-text"
     ]);
   });
+
+  it("keeps the complete neutral spinner filter used by pane ingestion", () => {
+    expect([...SPINNER_GLYPHS]).toHaveLength(26);
+    expect(isPaneChromeLine("  ⠧ Working (12s)")).toBe(true);
+    expect(hashPane("same body\n⠧ Working (12s)")).toBe("8f6372a8b1509601faa57ff3a292cfcccb95aa2325c18b8e50b0c035ea1648fe");
+  });
 });
 
 function listFiles(directory: string): string[] {
@@ -96,3 +101,16 @@ function listFiles(directory: string): string[] {
 function escapeRegExp(value: string): string {
   return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
 }
+
+function undeclaredModuleConstants(source: string): string[] {
+  const importedNames = new Set(
+    [...source.matchAll(/^import\s+\{([^}]*)\}\s+from/gm)]
+      .flatMap((match) => match[1].split(",").map((name) => name.trim().split(/\s+as\s+/).pop()!.trim()))
+  );
+  const declaredNames = new Set(
+    [...source.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\b/g)].map((match) => match[1])
+  );
+  const allowlist = new Set(["DAY_YYMMDD_DT", "DAY_YYMMDD_WT"]);
+  const identifiers = [...new Set(source.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]*\b/g) ?? [])];
+  return identifiers.filter((id) => !declaredNames.has(id) && !importedNames.has(id) && !allowlist.has(id));
+}
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

# THE SLICE — G1 (run command-center-2026-08-26)

## Scope (do ONLY this)
PROMOTION CLEANUP: delete residual dead OVM source/tests/tools and `mockups/final/*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`; keep `mockups/final/agent-window-v2.html`. Targeted cleanup test plus served-browser terminal regressions so no orphan import survives. Full unit+e2e stay on B8/F7, not this row. Per-slice temp cleanup is already each row's isolated runner, not this janitor.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A1** — The mini-app no longer exposes Overmind: the **Workflows**, **Overmind Projects**, and **OVM Console** screens and their bottom-nav entries are gone; no route renders them (navigating there 404s / redirects home).
- **A2** — The `/api/overmind/*` routes and the `overmind-stream-manager` WebSocket are removed; the server boots clean with no overmind service wiring (`overmind-watcher`, `overmind/` brain, notifications) instantiated.
- **A3** — The bot no longer registers `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end`; sending them yields the normal unknown-command path.
- **A5** — After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the full unit + e2e suites are green (no dangling overmind imports/types).

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx vitest run tests/command-center-cleanup.test.ts --minWorkers=1 --maxWorkers=4 && npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=G1 attempt=1 role=validator
  marker=DRV-G1-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate G1 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator G1 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/G1-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=G1 attempt=3 marker=DRV-G1-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
