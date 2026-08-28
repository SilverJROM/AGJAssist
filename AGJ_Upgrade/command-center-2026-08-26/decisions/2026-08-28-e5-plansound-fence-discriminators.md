# Decision — E5 (F-WAKEUP fence) = PLAN_SOUND, harness-correctness fix (2026-08-28)

logged by `[north]`. projcore asked: "E5 D1/D2 same fingerprint twice — PLAN_SOUND or re-plan?" and had a
`DIRECTION-E5-a6 SKIP` staged (unapplied). Ruling: **PLAN_SOUND — do NOT SKIP, do NOT re-plan.**

## Diagnosis (from e2e/command-center-wakeup-fence.spec.ts)
`ACCEPTANCE_IDS = ['D1','D2','D3']` are the fence's internal **discriminator ids** — a name-collision with
the D-series slices; they are NOT the summaries slices. There are only **3 ids for 4 contributors** (E1
schema / E2 service fire-once / E3 route / E4 UI), and two are **double-mapped**:
- `D1` ← `test_e1` (LITERAL_ACTION_D1_SCHEMA) **and** `test_e3` (LITERAL_ACTION_D1_ROUTE)
- `D2` ← `test_e3` **and** `test_e4` (LITERAL_ACTION_D2_UI)
- `D3` ← `test_e2` only

So breaking the schema seam and breaking the route seam both surface as id `D1` → identical fingerprint
(`fp1:4c534f69…`) → non-discriminating ("same seam twice"). `D3` maps to E2 alone, so it discriminates
cleanly — that is projcore's "CLOSE still red D1,D2 (D3 green)."

## Ruling
The F-WAKEUP journey + E5 product ACs are **satisfiable** — E1–E4 are DONE. The defect is purely in the
fence harness's discriminator design, not the product. projcore was right that it's composition/plan class
(a blind L2/L3 impl retry won't fix it) but wrong to SKIP — SKIP would leave F-WAKEUP unproven.

**Fix (harness-correctness, same class as E0):** give EACH contributor its own distinct named-red — one id
per layer (E1/E2/E3/E4 or D1/D2/D3/D4), each with its own LITERAL token AND its own `FENCE_STUB` target, so
`FENCE_STUB=E1|E2|E3|E4` each forces a UNIQUE id red → four DISTINCT fingerprints. Keep the positive journey
composing all four; CLOSE requires all four named-reds independently observable. Dispatch to the INTEGRATION
fence-author at a strong tier (sonnet5/opus5), NOT a blind impl retry. **Product E1–E4 unchanged.**

## Sequencing
E5 stays held until the F4 gate lands (driver was inside F4). north is NOT poking the driver; projcore
applies this after F4.

## JROM notification
None — routine north ruling, folds into the ready summary.
