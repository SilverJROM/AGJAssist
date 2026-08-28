## STANDING DIRECTION for E5 — from the run's planner, overrides the generic guidance below
E0 injected as an E5 dep: rewrite the wakeup fence journey first. After E0, driver CLOSE E5 against real E3 pending routes plus E2 fire-once. Do not walk L2/L3 on the A0 scaffold. Product E1-E4 unchanged.

Follow it. If it contradicts anything further down, IT WINS — and say so in your callback so
the contradiction gets fixed at the source rather than re-decided every attempt.

# [driver] RE-PREPARE fence E5 — SPLIT the existing journey, do not rewrite it

`e2e/command-center-wakeup-fence.spec.ts` ALREADY EXISTS and declares **1 named test function(s) for 4 contributors**. That is the defect: a red CLOSE cannot say WHICH contributor broke,
so the fence requeues nothing and can never close.

**Split what is there into one test per contributor. Do NOT reduce what it already covers** —
every assertion in the current file must survive into one of the new tests. Do not weaken an
assertion to make the split tidy, and do not delete a case you cannot place: if an assertion
belongs to no single contributor, keep it in a shared setup or a clearly-named extra test and
say so in your callback.

Write **`e2e/command-center-wakeup-fence.spec.ts`**: **ONE SEPARATELY-NAMED TEST FUNCTION PER CONTRIBUTOR** — 4 of
them, one for each id listed below. Not one test that asserts everything.

## Why the granularity is the whole point
When this journey goes red at CLOSE, a validator reads it and must name WHICH contributor broke
composition, in `failing_units`. **A single monolithic test cannot be attributed to anyone.** The
validator then returns `fault_class=plan failing_units=(none)`, the fence requeues nothing, and it
can never close — which is its entire purpose. Measured on this engine: 18 of 20 fences authored
one test for N contributors, and every localization attempt returned no unit.
So: **`test_<contributor>_<what_it_must_do>`**, one per contributor, each exercising THAT
contributor's own deliverable through the real path. A contributor with no test of its own cannot
be blamed and cannot be cleared.

## The contract, and it is the opposite of a normal slice
**This test MUST FAIL when you are done**, and it must fail for ONE reason: the capability is not
built yet. The contributors that build it are: E1, E2, E3, E4.

- **Do NOT make it pass.** Writing product code to turn your own journey green is this job's
  characteristic failure. You are not implementing the capability; you are defining what would
  prove it. Write NO product code.
- **Do NOT make it fail trivially.** `assert False`, a placeholder, an import error, a missing
  fixture, or a fake too thin to exercise the real path are all *red for the wrong reason*. The
  driver runs this journey immediately and REFUSES a baseline whose only signal is an
  env/import/collect error — it requires a PROVING failure, i.e. a real assertion that really ran
  and really failed.
- **The test must go GREEN, unchanged, the moment E1, E2, E3, E4 land** — and be RED today only
  because they have not.

## One test per contributor — these are the 4 you must write
- `test_e1_...` — exercises **E1**'s own deliverable
- `test_e2_...` — exercises **E2**'s own deliverable
- `test_e3_...` — exercises **E3**'s own deliverable
- `test_e4_...` — exercises **E4**'s own deliverable

## Acceptance ids these tests must assert by name (spread across them, each id in the test
whose contributor owns it)
D1, D2, D3

## The command that runs it
`FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs`
It must emit `fence-report-v1.json` in the documented shape.

## When done, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
`[FENCE-PREPARE-V1] fence=E5 path=e2e/command-center-wakeup-fence.spec.ts red_because=<which_contributor_is_missing_no_spaces>`

**If you cannot name the contributor whose absence makes it red, you have not written the journey
yet** — say so in that line with `red_because=UNKNOWN` rather than reporting a path.
