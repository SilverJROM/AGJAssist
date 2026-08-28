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

# [driver] F1 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed F1: defect_class=ALIAS_BYPASS gate=None.
**Validator's callback summary:** [projcore callback] validator F1 STATUS: DONE — FAIL colon-join aliases distinct viewer/pane pairs onto one key

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
# F1 attempt 1 — FAIL prescription

commit judged: fa77ed72a0d3d195644a0fb92c73ff7686161c8e
Focused row command PASSES (6/6) — see `validation/F1-vitest-a1.log`. It fails on G3 isolation: two distinct (viewer, pane) pairs alias onto one localStorage key, and the clear spec cannot catch a wipe-all. **2 findings, fix in this order.**

Read first: the brief says G1/G2/G3 have **NO CRITERION TEXT** in og-requirements.md. That is wrong. Real text is at `og-requirements.md:93-99`. This slice's Scope is still the authority for *what F1 builds* (helpers only). Do **not** port composer/switcher UI (that is F2). G3's isolation+reload clause IS this row.

- **G1.** Composer text kept per-agent on switch + "draft kept" affordance → F2 UI. F1 only supplies the storage helpers.
- **G2.** Send clears draft + switcher indicator → F2 UI. F1's `clearTerminalDraft` is the primitive.
- **G3.** Draft state per-viewer/client (localStorage keyed by pane), survives reload, never leaks one agent's draft into another's.

Mechanism chosen for G3: `localStorage` key per (viewer, pane) pair. That pair-to-key map must be injective.

Probe: `validation/F1-probe-a1.json` (real jsdom `localStorage`, not the spec's Map mock).

---

FINDING 1 of 2
WHAT FAILED: `_terminalDraftKey` in `src/web/public/terminal-chat-state.js` is
`agj_terminal_draft:${String(viewer)}:${String(pane)}`. Colon is both the field delimiter and a legal character in tmux pane targets (`session:0.0`) and in any viewer string that contains `:`. Probe specimen:
- `writeTerminalDraft("v", "a:b", "draft-X")`
- `writeTerminalDraft("v:a", "b", "draft-Y")`
leaves a **single** key `agj_terminal_draft:v:a:b` and both reads return `"draft-Y"`. Distinct pairs leaked. Focused spec never feeds a `:` in either field (`"0.0"`, `"0.1"`, `"1.2"`), so 6/6 stays green.
THE FIX: Make the key injective over the pair by encoding each field with `encodeURIComponent` (turns `:` into `%3A`):
```
const _terminalDraftKey = (viewer, pane) =>
  `agj_terminal_draft:${encodeURIComponent(String(viewer))}:${encodeURIComponent(String(pane))}`;
```
Do not JSON.stringify the pair as the only change and then assert via `_terminalDraftKey` — that would compute the expected key from the mechanism under test (D-082).
Add a spec `it` with those two literal pairs. Assert **literal** keys and values:
- `localStorage.getItem("agj_terminal_draft:v:a%3Ab")` === `"draft-X"`
- `localStorage.getItem("agj_terminal_draft:v%3Aa:b")` === `"draft-Y"`
- `readTerminalDraft("v", "a:b")` === `"draft-X"`
- `readTerminalDraft("v:a", "b")` === `"draft-Y"`
Colon-free keys used by the persist test (`agj_terminal_draft:viewer-persist:1.2`) are unchanged under `encodeURIComponent` — keep that assertion as the same literal.
WHY THE LAST ATTEMPT MISSED IT: isolation cases only used colon-free `"0.0"` / `"0.1"` panes, which cannot collide under `:`-join.

FINDING 2 of 2
WHAT FAILED: `tests/unit/terminal-draft-jsdom.spec.ts` `"clears a specific viewer/pane draft"` writes the survivor **after** `clearTerminalDraft`. Sequence today: write `v1/0.0` → clear `v1/0.0` → write `v1/0.1` → expect `v1/0.1`. Probe `spec_clear_passes_with_wipe_all`: a stand-in that calls `localStorage.clear()` (wipes every draft) still passes this test. The isolation claim for **clear** is untested. Impl `removeItem` on one key is actually scoped (probe `clear_key_scoped_impl`), but the spec cannot fail the wipe-all alias.
THE FIX: In that same `it()`, write **both** drafts first, then clear one:
```
writeTerminalDraft("v1", "0.0", "to be cleared");
writeTerminalDraft("v1", "0.1", "must-remain");
clearTerminalDraft("v1", "0.0");
expect(readTerminalDraft("v1", "0.0")).toBeNull();
expect(readTerminalDraft("v1", "0.1")).toBe("must-remain");
```
Do not write `"must-remain"` after the clear. Leave the Map mock in place if you want; this sequence fails wipe-all on that mock too.
WHY THE LAST ATTEMPT MISSED IT: the comment said "Other drafts remain" but the other draft was created after the clear.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

## BRAIN DIRECTION — intercept at the MODULE-LOAD / PROXY boundary, not per-method
Your interception is being bypassed because you patch methods AFTER the module is loaded, so a reference captured before the patch (`const w = fs.writeFile; w(...)`), a wrapper, or a fresh `require('fs')` escapes it. Catch aliases at the boundary itself:
- Intercept at RESOLUTION: wrap `Module._load` (or a `--loader`) so EVERY `require('fs'|'child_process'|'net'|'http'|'https')` returns a **Proxy** whose traps route through your interceptor — an alias of a proxied member is still the proxied member.
- For `globalThis.fetch`/timers, replace the global with a Proxy and assert no un-trapped global remains.
- The harness's own invariant test must PROVE an alias/wrapper attempt is caught (that is `AC-R8.1`'s 'alias/wrapper attempts are caught'), driving the REAL adapter boundary — not a mock of it.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F1): <summary>` or `[F1] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F1 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
`terminal-chat-state.js` only: `readTerminalDraft` / `writeTerminalDraft` / `clearTerminalDraft`, keyed by viewer and pane, localStorage isolation, reload persistence. Does not wait on wakeups.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **G1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx vitest run tests/unit/terminal-draft-jsdom.spec.ts --minWorkers=1 --maxWorkers=4`
