# [driver] LOCALIZE a red fence CLOSE — fence C6 (READ-ONLY)

The integration journey for **C6** ran and is RED. Every contributing unit reports DONE.
**You are not fixing anything. Write NO product code, NO tests, and make NO commits.** Your only
deliverable is one line that tells the driver where to route the repair.

## What the driver measured (facts, not claims)
- failing acceptance ids: C1
- passing acceptance ids: (none)
- seam fingerprint: fp1:327fdd2db020d18e244b
- contributing units (the ONLY ids you may name): C1, C2, C3, C4, C5

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
`[FENCE-VERDICT-V1] fence=C6 verdict=FAIL fault_class=<implementation|plan> failing_units=<id[,id]> plan_defect=<true|false> plan_defect_reason=<no_spaces_use_underscores>`

**Values are whitespace-split — no spaces inside any value.** `failing_units` is required when
`fault_class=implementation` and must be omitted or left empty otherwise. `plan_defect=true`
requires `plan_defect_reason`.
