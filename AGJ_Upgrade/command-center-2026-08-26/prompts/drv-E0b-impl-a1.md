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
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=E0b attempt=1 role=implementer
  marker=DRV-E0b-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(E0b): <summary>` or `[E0b] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer E0b STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[E0b] <summary>' \
  && printf '%s\n' '[projcore callback] implementer E0b STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer E0b STATUS: BLOCKED — <reason>`. Do not widen scope.
