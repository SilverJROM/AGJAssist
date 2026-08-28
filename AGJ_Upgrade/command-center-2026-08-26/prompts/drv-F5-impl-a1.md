# [projcore DIRECTION for this retry — apply this first]
[projcore 2026-08-28] F5 a4 validator PASS standard-clean at 40ec05e (J1,J2). Park was gate disagreement: uncommitted switcher.spec.ts at verdict. HEAD is 40ec05e. Make NO product edits. Run `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-switcher.spec.ts --project=cc`. Callback DONE immediately citing 40ec05e. Do not rebuild. Do not split.

[what_validator_missed]
Gate parked a PASS over dirty switcher.spec.ts. Spec is in 40ec05e. Re-gate existing commit.

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

# THE SLICE — F5 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: `AgentGroupSwitcher` — below 900px status/draft dropdown with no drag; at 900px+ horizontal strip plus working pointer scrubber; both paths call the same switch action.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **J1** — At **phone / narrow widths** the group agent switcher is a **dropdown** (current agent + caret → tap → pick from the group list, with status + draft indicators); no drag control.
- **J2** — At **wide tablet / desktop widths** it is the horizontal strip **+ a working draggable scrubber**; the presentation swaps by width and both paths switch the active agent identically.

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-switcher.spec.ts --project=cc`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

```
FINDING 1 of 2
WHAT FAILED: At 390px, `[data-testid="agent-group-switcher-dropdown"]` now has width `120px`, but it overlaps `.cc-ctrlcluster`; DOM evidence in `F5-narrow-a3-dom.txt` shows dropdown right `328.90625` and controls left `225`, and `F5-narrow-a3.png` shows the select visually colliding with the A-/A+ controls.
THE FIX: In `src/web/public/style.css`, add a phone-mode layout rule for the command-center topbar that reserves separate horizontal boxes for the switcher and controls. A concrete mechanism is to tuck or hide `.cc-ctrl-items` at `max-width:899px` while the switcher is expanded, or otherwise set `.terminal-topbar-main:has(.command-center-header)` children so `.agent-group-switcher-dropdown-wrap` right edge remains before `.cc-ctrlcluster` left edge with a gap.
WHY THE LAST ATTEMPT MISSED IT: It proved nonzero dropdown width, but did not test sibling-rectangle overlap inside the 390px Telegram header.

FINDING 2 of 2
WHAT FAILED: The committed `e2e/command-center-switcher.spec.ts` from A2 is an `about:blank` smoke test and does not fail when J1/J2 are violated; the validator had to replace it with fixture-backed assertions to expose the A3 overlap.
THE FIX: Keep a discriminating `e2e/command-center-switcher.spec.ts` in the implementation commit. Use a literal group fixture with active `alpha`, draft-bearing `bravo`, and enough siblings to overflow the desktop strip; assert phone dropdown value/options/no-scrubber/no-overlap, desktop strip/dropdown swap, tab switch, and scrubber-driven `scrollLeft`.
WHY THE LAST ATTEMPT MISSED IT: It delegated real validation to the validator instead of making the slice-owned focused spec enforce the acceptance criteria.
```
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F5 attempt=1 role=implementer
  marker=DRV-F5-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(F5): <summary>` or `[F5] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer F5 STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[F5] <summary>' \
  && printf '%s\n' '[projcore callback] implementer F5 STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer F5 STATUS: BLOCKED — <reason>`. Do not widen scope.
