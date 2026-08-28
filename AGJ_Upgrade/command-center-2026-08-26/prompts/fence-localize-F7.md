# [driver] LOCALIZE a red fence CLOSE — fence F7 (READ-ONLY)

The integration journey for **F7** ran and is RED. Every contributing unit reports DONE.
**You are not fixing anything. Write NO product code, NO tests, and make NO commits.** Your only
deliverable is one line that tells the driver where to route the repair.

## What the driver measured (facts, not claims)
- failing acceptance ids: G2, G3, H3, I2, J1, J2
- passing acceptance ids: G1, H1, H2, I1
- seam fingerprint: fp1:d6ff8c3e05e42f8c1bb9
- contributing units (the ONLY ids you may name): F1, F2, F3, F4, F5, F6, F0

## Decide ONE of these
1. **A named unit broke composition** — read that unit's code against the journey's expectations.
   `fault_class=implementation` and name it in `failing_units`. **At most 2.** Naming more is
   read as a failure to localize, not a localization, and will be refused.
2. **The failure belongs to no contributing unit** — a baseline regression, an environment shift,
   or a journey asserting something the plan never asked any unit to build. Then
   `fault_class=plan` with `plan_defect=true` and a `plan_defect_reason`. This requeues nothing
   and goes to replanning, which is the correct outcome when no unit owns the failure.

**Do not guess between them.** A wrong `failing_units` requeues real slices and makes their
implementers chase a defect they do not own.

## Emit EXACTLY one line, appended to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
`[FENCE-VERDICT-V1] fence=F7 verdict=FAIL fault_class=<implementation|plan> failing_units=<id[,id]> plan_defect=<true|false> plan_defect_reason=<no_spaces_use_underscores>`

**Values are whitespace-split — no spaces inside any value.** `failing_units` is required when
`fault_class=implementation` and must be omitted or left empty otherwise. `plan_defect=true`
requires `plan_defect_reason`.
