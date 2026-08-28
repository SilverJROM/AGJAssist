# C2 Validator Red-Team A1

commit under test: `90df357522aa119c41380ae903ac019c05e323b1`
parent: `87117c7ac3f9cf726d762ebd3823c1742f22abcb`
verdict: standard-fail
focused command: PASS (8/8) — see `validation/C2-vitest-a1.log`
probes: `validation/C2-probe-a1.json`

## Criterion authority

The brief says C2/C3/C4/C6 have **NO CRITERION TEXT** in og-requirements.md and to treat Scope as authority.
That is wrong. The real text is at `og-requirements.md:57-68`:

- **C2.** A reminder has a cadence chosen from presets 15/30/45/60/90 min or a custom minute value.
- **C3.** A reminder has a repeat setting: stop after N fires (then auto-deactivates) or unlimited.
- **C4.** Each agent in the folder has an include/skip flag; a skipped agent receives no solicit; toggling it is reflected immediately.
- **C6.** An active-reminders view shows, per folder and per agent, the cadence, next-fire, and remaining count; it survives an app reload (state is server-persisted).

This pass judged against that text plus the row Scope (CRUD + due-state + persisted active-reminder projections).

Outcomes-without-mechanism — choices used here:
- Remaining count is **not** a stored column (C1). Mechanism: `repeat_limit` null ⇒ unlimited; else remaining = `repeat_limit - repeat_count`.
- Active projection mechanism: `listActive(userId)` → reminder row + `recipients[]`.
- C4 "skipped agent receives no solicit" is **C3 `fireDue`**, not this slice. C2's in-scope half is persist include/skip immediately. Not counted as a C2 fail.

---

## Lens 1: update() null-coalesce cannot switch to unlimited — **FAIL (C3)**

`src/services/agent-solicit-service.ts:145-146`:

```ts
const repeatLimit = updates.repeat_limit ?? existing.repeat_limit;
const nextFire = updates.next_fire ?? existing.next_fire;
```

`??` treats `null` as "keep existing". Probe: create `repeat_limit=5`, `update({ repeat_limit: null, next_fire: null })` returned `repeat_limit=5` and `next_fire="2026-01-01T00:00:00.000Z"`. C3's unlimited setting cannot be applied after a stop-after-N create. C4's update route will inherit this.

`active: 0` is safe (`??` does not swallow 0). Only the nullable columns are broken.

## Lens 2: getDueReminders lexical ISO compare vs C1 SQLite datetime — **FAIL (due-state)**

`getDueReminders` binds `new Date().toISOString()` and uses `next_fire <= ?` as a **string** compare.

C1's specimen stores next_fire as `'2026-01-01 00:00:00'` (space, no `T`/`Z`). Space (0x20) < `T` (0x54), so a **same-UTC-day future** SQLite timestamp compares as earlier than ISO now.

Probe at `nowIso=2026-08-27T05:44:38.337Z`:
- next_fire `'2026-08-27 23:59:59'` → `sqlite_in_due=true` (wrong)
- next_fire `'2026-08-27T23:59:59.000Z'` → `iso_in_due=false` (correct)
- `datetime(next_fire) <= datetime('now')` is 0 for both (correct)

The focused spec only feeds ISO strings, so it cannot catch this.

## Lens 3: advanceReminder cadence assertion does not discriminate — **FAIL (D-082 / C2)**

`tests/unit/agent-reminder-service.spec.ts:189`:

```ts
expect(new Date(advanced!.next_fire!).getTime()).toBeGreaterThan(new Date(nextFire).getTime());
```

Impl actually adds `cadence_minutes * 60 * 1000` (probe: `2026-01-01T00:00:00.000Z` → `2026-01-01T00:30:00.000Z`). The spec would still pass if the impl added 1ms. C2's cadence clause is the thing being advanced; the expected next_fire must be the **literal** `start + 30min`.

## Lens 4: listActive spec does not lock C6 projection fields — **FAIL (TEST_NOT_DISCRIMINATING / C6)**

`listActive` test only asserts length, `folder_group`, and recipients length. It never asserts `cadence_minutes`, `next_fire`, `repeat_limit`, or `repeat_count`. Impl currently `SELECT *` so the fields are present (probe remaining 5-2=3), but a thinner projection would still pass. C6's persisted projection is cadence + next-fire + remaining ingredients.

## Lens 5: include/skip persist + user isolation + stop-after-1 deactivate — **clean**

- Create with include 0/1: asserted.
- Update recipients include flip: asserted.
- `advanceReminder` with `repeat_limit=1` sets `active=0`: asserted.
- Probe: user A/B `list()` isolation holds (untested in spec, impl OK).
- Probe: `repeat_limit=5` first advance stays `active=1` (untested, impl OK).
- Probe: inactive-but-past `next_fire` excluded from due (untested, impl OK).

Not findings. Do not expand this slice into C3 `fireDue`.

## Test command

`node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4`

Exit 0, 8/8. Focused green does not override Lenses 1–4.

Conclusion: standard-fail. Prescription: `validation/C2-fix-a1.md`.
