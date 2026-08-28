# 2026-08-27 B8 c1 DIRECTION (projcore, no north)

RAISE-B8-c1: `integration reports green but 1 OPEN acceptance id(s) still do not pass: B2`
driver: `fault_class=implementation`, `plan_defect=false`, attempts=0.

## Evidence

`dispatch/fence-close.B8.json`: green=true, passed_ids=[], failed_ids=[], verdict_err=missing verdict and fault_class, detail=B2 removed since OPEN, negative_control_detail=nothing failed.

Mechanism (not a product miss):
1. `e2e/command-center-ovm-fence.spec.ts` `check()` throws `FENCE_ASSERT` so later ids may never collect.
2. Integration runner does not set `FENCE_REPORT_PATH`; driver then sees empty `passed` and treats OPEN-failed B2 as dropped.
3. `verdictLine()` omits required `verdict=` and `fault_class=` tokens.
4. `FENCE_STUB=B2` uses a Fastify `preHandler` on `/api/overmind/status`. After B2 the route is unregistered, so the hook never fires, A2 stays 404, negative is vacuous.

Product B1-B7 remain DONE. A1-A5/B1/B2 unchanged → not a north escalate.

## Action

- B8: `RETRY_WITH_DIRECTION` (`DIRECTION-B8-a0.json`).
- Inject **H8** (harness-only) as a B8 dep so a commit changes HEAD and E2 does not reuse the stashed CLOSE.
- F7: `SKIP_TO_PROJCORE` (plan/vacuous OPEN; F0 already in plan). Keep F7 parked.
- F1: `RETRY_WITH_DIRECTION` so F-WINDOW units can run after F0.
- Fix F0 `tests` cell: no `|` (PLAN_COLS split the previous `||[]` one-liner).

Not `STOP_TRUE_BLOCKED`. Repair round 1 of 3.
