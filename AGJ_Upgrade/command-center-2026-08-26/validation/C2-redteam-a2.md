# C2 Validator Red-Team A2

commit under test: `217ae6b85937426415ba9c150cb58a1161973816`
parent: `90df357522aa119c41380ae903ac019c05e323b1`
verdict: standard-fail
focused command: PASS (8/8) — `validation/C2-vitest-a2.log`
probes: `validation/C2-probe-a2.json`

## Criterion authority

Brief again says C2/C3/C4/C6 have no og-requirement text. Real text is `og-requirements.md:57-68`. Judged against that plus Scope.

Mechanism choices (unchanged from a1): remaining = `repeat_limit - repeat_count` (null limit ⇒ unlimited); active projection = `listActive` + `recipients[]`. C4 "skipped agent receives no solicit" is C3 `fireDue`, not this slice.

---

## Lens 1: update() null coalesce (a1 F1) — **clean**

`update()` now uses `!== undefined` for `repeat_limit` / `next_fire`. Probe `update_nulls.impl_ok=true`: create 5 + ISO next_fire, `update({repeat_limit:null, next_fire:null})`, `getById` and raw SQL both null. Spec asserts the same.

## Lens 2: getDueReminders datetime vs lexical (a1 F2) — **impl clean, spec PARTIAL / FAIL**

Impl SQL is the prescribed `datetime(next_fire) <= datetime('now')`. Independent probe at `nowIso=2026-08-27T05:55:04.678Z`:
- `'2026-08-27 23:59:59'` → service `sqlite_in_due=false` (correct)
- same string `lex_due=1`, `dt_due=0` (the trap still exists in SQLite; the service now follows datetime)
- ISO-with-Z past/future through the service: `iso_due_via_service.impl_ok=true`
- `datetime('…Z')` is not NULL

The spec (`agent-reminder-service.spec.ts:155-190`) uses `'2000-01-01 00:00:00'` / `'2099-01-01 23:59:59'`. Probe `would_old_lexical_pass_spec=true`: those years differ in the **date prefix**, so `next_fire <= isoNow` and `datetime()` **agree**. Reverting the WHERE clause to lexical ISO would still pass 8/8. Comment "to catch lexical bug" is false. D-082: the specimen that contradicts lexical is same-UTC-day space-format `23:59:59`.

## Lens 3: advanceReminder cadence literal (a1 F3) — **clean**

Asserts `next_fire === "2026-01-01T00:30:00.000Z"` with start `"2026-01-01T00:00:00.000Z"` and cadence 30. +1ms would fail.

## Lens 4: listActive C6 projection (a1 F4) — **clean**

Second-path `UPDATE … SET repeat_count = 2`. Asserts cadence 15, next_fire literal, repeat_limit 5, repeat_count 2, skip include 0. Remaining asserted as literal 3 from those two fields.

## Lens 5: ISO after advance / skip-fire scope — **clean**

Recent ISO due → `advanceReminder` → no longer due (`advance_recent.impl_ok`). Do not implement C3 `fireDue` here.

## Test command

`node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4`

Exit 0. Focused green does not lock Lens 2's lexical trap.

Conclusion: standard-fail. Prescription: `validation/C2-fix-a2.md`.
