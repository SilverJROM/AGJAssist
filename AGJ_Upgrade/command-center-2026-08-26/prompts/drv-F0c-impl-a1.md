# [projcore DIRECTION for this retry — apply this first]
F0c is a PLAIN slice (feeds F7's window fence) and has NEVER had an honest drive — every prior park was infrastructure: glimmer weekly-limit wedge, then repeated codex env outages at attempts=0. codex is now stable (auto-relink watcher keeps the bin symlink alive), so this is the first clean toolchain. Do NOT re-plan or split F0c — just drive it. CRITICAL COUPLING: F0c's park-rollback restores/reverts E5's fence-close.E5.json + fence-state.E5.json across the shared coordination commit, which UNDOES E5's re-measure every time F0c parks. So F0c MUST LAND to unblock E5. impl_tier=L3: the ladder runs terra at a1-a3 then sonnet5 at a4; per wflow-c1 the attempt counter resets on each un-park, so give it ONE clean uninterrupted drive to actually reach a4/sonnet5 rather than resetting on terra. Retry the F0c brief as-is per directions-active/F0c.txt (one named-red per G1-J2 via FENCE_STUB=<AC>, remap fence-contract.json F7 negative to I1 server-backed, F1-F6 frozen). If it reaches a4 on sonnet5 and still fails, THAT is the first real evidence about F0c's difficulty.

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

# THE SLICE — F0c (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. After F0b, add one named-red per G1-J2 via FENCE_STUB=<AC> that perturbs the public path (not FENCE_STUB_G* or throw-in-check). Remap fence-contract.json F7 expected_negative_fail_ids / negative_control_cmd to a server-backed contributor (I1 pane-output refresh, not F1 client-only). Collect ALL G1-J2. Write fence-report-v1.json in finally. Do not implement product UI.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

```
FINDING 1 of 2
WHAT FAILED: The I1 named-red is implemented as a throw-in-check. `e2e/command-center-window-fence.spec.ts:290-298` installs a pane-output refresh route, but `e2e/command-center-window-fence.spec.ts:306-309` throws `FENCE_STUB=I1 forces I1 failure` before clicking `[data-testid="terminal-refresh"]`. The negative report `validation/F0c-gate-neg-drv21-a1.json` therefore proves the direct throw branch, not the public `/api/tmux/panes/:target/output?...refresh=...` path required by scope.
THE FIX: Remove the `if (FENCE_STUB === 'I1') throw ...` branch from the I1 check. Keep the route perturbation, make the route match the actual refresh request shape issued by the product, click `[data-testid="terminal-refresh"]`, and assert the product-visible refreshed transcript/detail state so the route-level failure naturally records exactly `{ "id": "I1", "kind": "assert" }`.
WHY THE LAST ATTEMPT MISSED IT: It added a real-looking route stub but made the gate pass by short-circuiting the assertion before that stub could be exercised.

FINDING 2 of 2
WHAT FAILED: F0c scope required one named-red per G1-J2 via `FENCE_STUB=<AC>` that perturbs the public path. `rg FENCE_STUB e2e/command-center-window-fence.spec.ts` shows only `I1`; there are no named public-path perturbations for G1, G2, G3, H1, H2, H3, I2, J1, or J2.
THE FIX: Add AC-id stubs for every remaining acceptance id: `FENCE_STUB=G1`, `G2`, `G3`, `H1`, `H2`, `H3`, `I2`, `J1`, and `J2`. Each branch must alter the concrete specimen consumed by that assertion, such as draft storage/session selection for G ids, collapsed/header viewport state for H ids, refresh/composer request timing for I2, and dropdown/scrubber tab specimens for J ids. Do not use `FENCE_STUB_G*` names and do not throw directly inside `check()`; the public UI/API path must make the matching existing assertion fail.
WHY THE LAST ATTEMPT MISSED IT: It closed only the contract-selected I1 negative gate and did not implement the per-AC named-red matrix required by the F0c scope.
```
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F0c attempt=1 role=implementer
  marker=DRV-F0c-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(F0c): <summary>` or `[F0c] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer F0c STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[F0c] <summary>' \
  && printf '%s\n' '[projcore callback] implementer F0c STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer F0c STATUS: BLOCKED — <reason>`. Do not widen scope.
