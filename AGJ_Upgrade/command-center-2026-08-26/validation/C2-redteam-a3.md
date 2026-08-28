# C2 Validator Red-Team A3

commit under test: `65b3b528577e153a4b4e90abed4b5d2d16266d20`
parent: `217ae6b85937426415ba9c150cb58a1161973816`
verdict: standard-clean
focused command: PASS (8/8) — `validation/C2-vitest-a3.log`
probes: `validation/C2-probe-a3.json`

## Criterion authority

Brief says C2/C3/C4/C6 have no og-requirement text. Real text is `og-requirements.md:57-68`. Judged against that plus Scope.

Mechanisms used:
- Remaining count: `repeat_limit` null ⇒ unlimited; else `repeat_limit - repeat_count` (no stored remaining column; C1 has none).
- Active projection: `listActive(userId)` → reminder row + `recipients[]`.
- Due-state: `datetime(next_fire) <= datetime('now')`, not lexical ISO.
- C4 "skipped agent receives no solicit" is C3 `fireDue`, not this slice. C2 persists include/skip immediately.

---

## Lens 1: a2 specimen actually ran and contradicts lexical — **clean**

This run: `window_open=true` at `nowIso=2026-08-27T06:01:47.738Z`, sqlite EOD `'2026-08-27 23:59:59'`.
Second-path SQL: `lex_due=1`, `dt_due=0`.
`getDueReminders()` does **not** contain the id.
A lexical `next_fire <= isoNow` query **does** contain it (`revert_would_fail_notToContain=true`).
The new `expect(ids).not.toContain(sameDay.id)` is what would go red on a WHERE-clause revert. The `if (endUtc > now.getTime())` skip is the last second of a UTC day only, as prescribed; it was not taken.

## Lens 2: a1 F1 update nulls still hold — **clean**

`!== undefined` for `repeat_limit` / `next_fire`. Probe `update_nulls_ok=true`. Spec still asserts both nulls.

## Lens 3: a1 F3 cadence literal still holds — **clean**

`advanceReminder` from `"2026-01-01T00:00:00.000Z"` + 30 min asserts `"2026-01-01T00:30:00.000Z"`. Probe `cadence_literal_ok=true`.

## Lens 4: a1 F4 listActive C6 projection still holds — **clean**

Second-path `repeat_count=2`, asserts cadence 15, next_fire literal, repeat_limit 5, repeat_count 2, skip include 0, remaining 3.

## Lens 5: 2000/2099/exhausted-limit rows kept — **clean**

Probe: 2000 in due, 2099 not, exhausted repeat not. Diff did not drop them.

## Lens 6: product SQL unchanged this commit — **clean**

Diff is tests-only. `getDueReminders` still `datetime(next_fire) <= datetime('now')` with no ISO bind.

## Test command

`node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4`

Exit 0, 8/8, `reclaimed_bytes=7606272`. Working tree matches `65b3b52` for the two C2 files.

Conclusion: standard-clean PASS.
