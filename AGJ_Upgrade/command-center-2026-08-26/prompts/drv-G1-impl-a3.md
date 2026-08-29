# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# [driver] G1 CORRECTION (attempt 3) — fix EVERY finding the validator listed


## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too

F8 LANDED (advance-F8.marker, commit d70d12c, PASS). Checked the 'A4 migration criterion conflicts with UI scope' note in F8's callback before clearing this -- it is NOT the mockup-vs-do-not-regress conflict north flagged as an escalation trigger: the redteam pass explains it as an ACCEPTANCE-ID COLLISION (og-requirements.md's 'A4' text elsewhere describes an unrelated database criterion; the slice scope, naming the terminal mobile regression, was correctly used as authority instead) and explicitly confirms 'the locked final 390px mockup keeps the compact controls visible by default' -- no mockup/contract conflict, nothing to escalate. Retry your own gate (npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts) and re-verify A4/A6/A7 yourself against d70d12c rather than trusting F8's report alone.

**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
The independent validator FAILed G1: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator G1 STATUS: DONE — FAIL a1 findings fixed; live .tg-home-preferences CSS lost + vacuous new assertion

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
# G1 attempt 2 — validator prescription (marker DRV-G1-21)

commit under test: `4d957a0ddd130294e037c6827232637c563a8615` ("[G1] preserve cleanup dependencies")
verdict: **FAIL** · failed_gate: **A5** · defect_class: **TEST_NOT_DISCRIMINATING**

## What attempt 2 FIXED — verified, do not re-do any of it
All nine actionable findings from `G1-fix-a1.md` were addressed, and eight of them land clean:

- **a1-F1 MCP OAuth** — `const MCP_OAUTH_RETURN_KEY = 'mcp_oauth_return';` restored at
  `src/web/public/app.js:470`. `e2e/mcp-oauth.spec.ts` AC-6 now PASSES (was a deterministic
  16s timeout at `41f51e9`).
- **a1-F2/F3 pane semantics** — real `src/services/pane-utils.ts` created with `hasActiveTurn`
  chrome masking and `hashPane` = `sha256(extractBody(pane))`; both call sites import it.
  Differentially verified against the deleted original across 6 busy specimens, 5 body
  specimens and 26 spinner glyphs — equivalent everywhere except FINDING 2 below.
- **a1-F4/F5/F6** — `tests/bottom-nav-helpers.test.ts` repointed to `nav-helpers.js` and its
  assertions correctly inverted (`/overmind` is now REJECTED by `addBottomNavTab`);
  `tests/unit/agent-wake-scheduler.spec.ts` and `tests/telegram-resilience.test.ts` updated to
  the new strings. All three green.
- **a1-F7** — `e2e/parent-hint-b5.spec.ts` deleted; the `overmind` alternative dropped from the
  mock-route regex in `e2e/terminal-ux-sectionnav.spec.ts:40`.
- **a1-F8** — 108 dead `.overmind-*` selectors purged from `style.css`, and the 9 live
  `.ovm-chat-*` selectors correctly KEPT. Braces balance (depth 0), no empty rule blocks, no
  declarations outside a rule. Only the collateral in FINDING 1 below.
- **a1-F10 differential baselining** — re-run at `4d957a0`. **Zero G1-attributable regressions
  remain.** Unit: 6 failed files / 13 failed tests, every one on the pre-existing list
  (`agent-wakeup-routes`, `mcp-migration` x3, `telegram-commands` (broken by ccc0bdd [B5]),
  `unit/agent-reminder-schema` x2, `unit/command-center-migration` x2, `unit/database` x4) —
  down from 32 failed files at `41f51e9^`. E2E chromium: 16 failed / 78 passed, all 16 on the
  pre-existing `command-center-*-fence` / `window-fence` / `terminal-ux-header-tabs` list that
  the Scope assigns to B8/F7. `tsc --noEmit`: only the 3 pre-existing unrelated TS18046 errors.
- **A1/A2/A3 re-verified at this commit** — `#/overmind` redirects home; `#/overmind-projects`,
  `#/ovm`, `#/workflows`, `#/ovm-console` all render "Page not found"; 0 `[class*=overmind]`
  nodes; bottom nav is Home/Tasks/Notes/Terminal/Settings (`validation/G1-a2-dom.txt`,
  `G1-a2-home-nav.png`, `G1-a2-overmind-route.png`). Real boot on :3399 is clean, every
  `/api/overmind/*` and `/api/app-settings` 404s, no overmind wiring anywhere in `src/`. All
  seven bot commands return "Unknown command. Use /help." while `/help` still works
  (`validation/G1-a2-server.txt`).

**Three things block the gate.** Two are proven by executed probes, not by reading.

---

FINDING 1 of 4
WHAT FAILED: the CSS purge deleted a LIVE, non-OVM rule. `.tg-home-preferences` is used at
`src/web/public/app.js:7045` (it wraps `<${LandingPagePreference} />` on the Home dashboard),
but its rule went out of `src/web/public/style.css` because it sat between two
`.overmind-cooldown-row` blocks (see the removed hunk at `4d957a0` style.css lines 894-921:
`.overmind-cooldown-row` / `.tg-home-preferences` / `.tg-home-preferences .overmind-cooldown-row`
/ `.overmind-cooldown-select`). Browser-measured at 390px on the served app —
`getComputedStyle('.tg-home-preferences')` returns
`{marginTop:"0px", paddingTop:"0px", borderTopWidth:"0px", borderTopStyle:"none"}`; the deleted
rule set `margin-top:20px; padding-top:14px; border-top:1px solid var(--border)`. Recorded in
`validation/G1-a2-dom.txt` ("HOME styling preserved = false"). User impact: the "Default landing
page" control now butts directly against the dashboard card grid with no separator. This is the
SAME defect shape as a1-F1 (`MCP_OAUTH_RETURN_KEY`) one layer down — a live declaration adjacent
to OVM code swept out with it.
THE FIX: re-add to `src/web/public/style.css`, verbatim from
`git show 4d957a0^:src/web/public/style.css` lines 901-907 (keep the JROM 2026-05-24 comment):
```
/* JROM 2026-05-24: landing-page preference at the bottom of the Home dashboard.
   Subtle, separated from the dash cards by a thin border. */
.tg-home-preferences {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
```
Do NOT re-add `.tg-home-preferences .overmind-cooldown-row` — that nested rule targeted the OVM
cooldown row, which is gone. The full-range sweep (`41f51e9^..4d957a0`) found exactly ONE such
orphan; `.closed` also shows up in the diff but only ever existed as the compound
`.ovm-status-dot.closed`, and app.js's `closed` occurrences are JS locals — leave it deleted.
WHY THE LAST ATTEMPT MISSED IT: the sweep filtered on the `overmind`/`ovm` prefix in the
SELECTOR, which cannot see a non-prefixed rule sitting inside the deleted region.

FINDING 2 of 4
WHAT FAILED: `src/services/pane-utils.ts:29` — the ported `spinnerGlyphs` string is missing one
character. Original (`git show 41f51e9^:src/services/overmind/pane-utils.js`):
`"◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷"` = 26 glyphs. Ported: 25 — **`⠧` (U+2827,
BRAILLE PATTERN DOTS-1237) is absent**. That glyph is a frame of the braille spinner cycle the
agents actually render. Proven by loading the original module from git as a second path and
running both implementations over all 26 glyphs:
`isPaneChromeLine("  ⠧ Working")` → orig `true`, ported `false`; and
`hashPane` strips that line in the original but not in the port. Every other specimen matched
(`hasBusySignal` x6 including the idle-footer case, `hasActiveTurn`, `extractBody` x5, the other
25 glyphs). Consequence at `src/services/agent-event-ingest.ts:192`: a pane snapshot captured on
the `⠧` frame hashes differently from the same body on any other frame, so `existing.hash !==
currentHash` fires spuriously and resets `lastActivityMs` — a partial re-run of a1-F3. The
deleted file's own header states the contract this violates: "Behavior must remain byte-identical
to the in-watcher originals."
THE FIX: change the `spinnerGlyphs` literal in `src/services/pane-utils.ts:29` to the 26-glyph
original — insert `⠧` between `⠦` and `⠇`. Verify with a length assertion rather than by eye:
`[...spinnerGlyphs].length === 26`.
WHY THE LAST ATTEMPT MISSED IT: the port was re-typed rather than copied, and a dropped
combining-range braille character is invisible in a side-by-side read.

FINDING 3 of 4
WHAT FAILED: the "undeclared module constants" half of the new assertion in
`tests/command-center-cleanup.test.ts` (the `it("has no caller imports for removed modules or
undeclared module constants")` block) is **VACUOUS — it cannot fail**. The regex is
`` new RegExp(`(?:^|\\n)\\s*(?:const|let|var)\\s+${identifier}\\b|import[\\s\\S]*?\\b${identifier}\\b`, "m") ``.
The second alternative matches whenever the literal word `import` appears ANYWHERE in the file
before the identifier — and `app.js` opens with `import` statements at lines 1-17, while
`[\s\S]*?` spans the whole file. So every one of the 105 scanned identifiers matches
unconditionally. Mutation-proved (`validation/G1-a2-probes.txt`, Probe A): deleting
`const MCP_OAUTH_RETURN_KEY` from an in-memory copy while leaving its two readers — i.e.
reproducing the exact a1 defect this assertion was written to catch — still yields
`flagged = 0`; alternative 1 correctly does not match, alternative 2 does. An invented
`TOTALLY_UNDECLARED_SENTINEL` is likewise not flagged. This violates the standing contract:
"If you cannot say what would make your test FAIL, it is not a test yet."
(The orphan-IMPORT half of the same block IS discriminating — Probe B restores the
a1-F4 `overmind-helpers` import and the scan reports the hit. Keep that half as written.)
THE FIX: drop the `import…` alternative entirely and resolve declarations structurally instead
of by one regex. Concretely, in that same `it()`:
```ts
const app = readFileSync(resolve(root, "src/web/public/app.js"), "utf8");
const importedNames = new Set(
  [...app.matchAll(/^import\s+\{([^}]*)\}\s+from/gm)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()))
);
const declaredNames = new Set(
  [...app.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1])
);
const identifiers = [...new Set(app.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])];
const undeclared = identifiers.filter((id) => !declaredNames.has(id) && !importedNames.has(id));
expect(undeclared).toEqual([]);
```
Then **prove the new assertion discriminates before reporting DONE**: delete
`const MCP_OAUTH_RETURN_KEY` from a scratch copy of app.js, run the same logic over it, and
confirm the identifier IS reported. If that scratch run still reports nothing, the assertion is
still vacuous. (Expect an initial non-empty `undeclared` list of legitimate globals —
DOM/browser names and any `SCREAMING_SNAKE` used as an object key or inside a string. Add a
short explicit allowlist constant for those rather than loosening the regex; loosening it is
exactly how this one became vacuous.)
WHY THE LAST ATTEMPT MISSED IT: the assertion was never run against a failing input — it went
green on the first try and green was taken as working.

FINDING 4 of 4
WHAT FAILED: PLAN_DEFECT, restated from a1-F10 and still unresolved upstream. AC **A5** demands
"the full unit + e2e suites are green"; the Scope paragraph says "Full unit+e2e stay on B8/F7,
not this row"; the row's `tests` command runs neither. Taken literally A5 can never be satisfied
by this row — 13 unit and 16 e2e failures at `4d957a0` predate G1 and belong to other rows.
**This is NOT blocking attempt 3** — it is recorded so the next seat does not burn an attempt
chasing absolute green.
THE FIX: fix findings 1-3, then re-run
`npx vitest run tests/command-center-cleanup.test.ts tests/bottom-nav-helpers.test.ts tests/unit/agent-wake-scheduler.spec.ts tests/telegram-resilience.test.ts --minWorkers=1 --maxWorkers=4`
and
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/mcp-oauth.spec.ts e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`,
plus a browser check that `.tg-home-preferences` computes `border-top-width: 1px` on `#/`.
Ask north to reword A5 to "no suite that was green before this slice is red after it".

---
## Mechanism chosen where the criterion stated only an outcome
A5 states an outcome ("suites are green") with no mechanism for proving a cleanup slice broke
nothing. **Mechanisms used, both re-usable by attempt 3:**
1. **Differential baselining** — every suite run at `4d957a0` and at the pre-G1 parent
   `41f51e9^` (a `git worktree` with `node_modules` symlinked); only a green→red flip is charged
   to this slice. That is what clears attempt 2 of every remaining unit/e2e failure.
2. **Second-path differential for ported code** — the deleted `pane-utils.js` loaded from git
   history as a `data:` module and run side-by-side with `src/services/pane-utils.ts` over
   enumerated specimens. Expected values come from the original, never from the port. That is
   what found FINDING 2, which no assertion in the repo covers.
3. **Mutation-testing the slice's own new assertions** — reintroduce the exact defect the
   assertion claims to catch and require it to go red. That is what found FINDING 3, and it is
   the check that should gate every guard-rail test this slice writes.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(G1): <summary>` or `[G1] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer G1 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
PROMOTION CLEANUP: delete residual dead OVM source/tests/tools and `mockups/final/*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`; keep `mockups/final/agent-window-v2.html`. Targeted cleanup test plus served-browser terminal regressions so no orphan import survives. Full unit+e2e stay on B8/F7, not this row. Per-slice temp cleanup is already each row's isolated runner, not this janitor.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **A1** — The mini-app no longer exposes Overmind: the **Workflows**, **Overmind Projects**, and **OVM Console** screens and their bottom-nav entries are gone; no route renders them (navigating there 404s / redirects home).
- **A2** — The `/api/overmind/*` routes and the `overmind-stream-manager` WebSocket are removed; the server boots clean with no overmind service wiring (`overmind-watcher`, `overmind/` brain, notifications) instantiated.
- **A3** — The bot no longer registers `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end`; sending them yields the normal unknown-command path.
- **A5** — After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the full unit + e2e suites are green (no dangling overmind imports/types).

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx vitest run tests/command-center-cleanup.test.ts --minWorkers=1 --maxWorkers=4 && npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`
