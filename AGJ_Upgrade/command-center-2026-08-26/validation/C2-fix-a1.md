# C2 attempt 1 — FAIL prescription

commit judged: `90df357522aa119c41380ae903ac019c05e323b1`
Focused row command PASSES (8/8). It fails C3 (unlimited via update), due-state (SQLite vs ISO next_fire), and D-082 on cadence/C6 projection. **4 findings, fix in this order.**

The brief says C2/C3/C4/C6 have no og-requirement text. That is wrong. Real text is `og-requirements.md:57-68`. Judge against that, plus Scope.

C4 "skipped agent receives no solicit" is C3 `fireDue` — do **not** implement firing in this slice.

---

FINDING 1 of 4
WHAT FAILED: `AgentSolicitService.update` at `src/services/agent-solicit-service.ts:145-146` uses `??`, so `update(id, { repeat_limit: null, next_fire: null })` keeps the previous values. Probe in `validation/C2-probe-a1.json` `update_repeat_limit_null`: before=5, after_repeat_limit=5, after_next_fire still `"2026-01-01T00:00:00.000Z"`. C3 requires a reminder to be switchable to **unlimited** (`repeat_limit` NULL). C4's update path cannot do that through this service.
THE FIX: In `update()`, take nullable fields with `!== undefined`, not `??`:
```ts
const repeatLimit = updates.repeat_limit !== undefined ? updates.repeat_limit : existing.repeat_limit;
const nextFire = updates.next_fire !== undefined ? updates.next_fire : existing.next_fire;
```
Leave `folder_group` / `cadence_minutes` / `solicit_message` / `active` on `??` (those are non-null; `active: 0` already survives `??`).
Add a spec: create with `repeat_limit: 5` and `next_fire: "2026-01-01T00:00:00.000Z"`, then `service.update(id, { repeat_limit: null, next_fire: null })`, then assert via `getById` (public path) `repeat_limit === null` and `next_fire === null`. Literals, not values read back from the update return only as the expected.
WHY THE LAST ATTEMPT MISSED IT: the update spec only changes `cadence_minutes` and replaces recipients; it never passes JSON-null for a nullable column.

FINDING 2 of 4
WHAT FAILED: `getDueReminders` (`src/services/agent-solicit-service.ts:186-194`) compares `next_fire <= ?` against `new Date().toISOString()`. C1 stores next_fire as SQLite datetime `'YYYY-MM-DD HH:MM:SS'` (space, no T/Z). Lexicographic compare: space (0x20) < `T` (0x54), so a **same-UTC-day future** SQLite timestamp is treated as due. Probe `format_due_sameday`: at `nowIso=2026-08-27T05:44:38.337Z`, next_fire `'2026-08-27 23:59:59'` had `sqlite_in_due=true`; the ISO twin `'2026-08-27T23:59:59.000Z'` was not due. `datetime(next_fire) <= datetime('now')` was 0 for both.
THE FIX: Compare through SQLite datetime, not raw strings:
```sql
SELECT * FROM agent_solicit_reminders
 WHERE active = 1 AND next_fire IS NOT NULL
   AND datetime(next_fire) <= datetime('now')
   AND (repeat_limit IS NULL OR repeat_count < repeat_limit)
```
No bound ISO parameter. Do **not** "fix" this by rejecting SQLite-format strings in `create` — C1's specimen and `datetime('now')` writers use that shape.
Add a spec that creates one reminder with next_fire **literal** `'2099-01-01 23:59:59'` (SQLite format, far future) and one with `'2000-01-01 00:00:00'` (SQLite format, past). `getDueReminders()` ids must contain the past id and must **not** contain the future id. That specimen is what Lens 2 used; an ISO-only pair will not catch the regression.
WHY THE LAST ATTEMPT MISSED IT: the due spec only inserts `Date.toISOString()` values, which sort consistently with the bound parameter.

FINDING 3 of 4
WHAT FAILED: `tests/unit/agent-reminder-service.spec.ts` `"advanceReminder increments next_fire and repeat_count"` asserts only `next_fire` `toBeGreaterThan` the input. Impl does add 30 minutes (probe `advance_cadence.got=2026-01-01T00:30:00.000Z`), but `+1ms` would still pass. C2's cadence is the clause; the spec does not discriminate it (D-082).
THE FIX: Freeze a literal start. Create with `next_fire: "2026-01-01T00:00:00.000Z"` and `cadence_minutes: 30`. Assert `advanced.next_fire === "2026-01-01T00:30:00.000Z"` and `repeat_count === 1`. The expected ISO string is a literal (`00:30:00`), not `Date.parse(got)+cadence` computed from the service. Keep `repeat_limit: null` so this case stays unlimited (C3) and `active` remains 1.
WHY THE LAST ATTEMPT MISSED IT: greaterThan is true for any forward bump, so cadence was never the expected value.

FINDING 4 of 4
WHAT FAILED: `"lists active reminders with recipients projection"` only asserts `length === 1`, `folder_group === "g1"`, and `recipients.length === 1`. C6 requires the persisted projection to carry cadence, next-fire, and remaining count (derived: `repeat_limit` null ⇒ unlimited; else `repeat_limit - repeat_count`). A `listActive` that dropped those columns would still pass.
THE FIX: In that spec (or a sibling it), create an **active** reminder with literals `cadence_minutes: 15`, `next_fire: "2026-01-01T00:00:00.000Z"`, `repeat_limit: 5`, recipients `[{agent_name:"inc", include:1},{agent_name:"skip", include:0}]`. Then `db.prepare("UPDATE agent_solicit_reminders SET repeat_count = 2 WHERE id = ?").run(id)` (second path, not the service). `listActive(userId)` for that id must equal:
- `cadence_minutes === 15`
- `next_fire === "2026-01-01T00:00:00.000Z"`
- `repeat_limit === 5`
- `repeat_count === 2`
- skip flag `recipients.find(r => r.agent_name==="skip")?.include === 0`
Remaining is asserted in the test as the literal `5 - 2 === 3` from those two fields (do not add a schema column; C1 has none). Keep the existing inactive control row so the filter still discriminates `active=0`.
WHY THE LAST ATTEMPT MISSED IT: the projection test checked identity of the folder, not the C6 fields the view must read.
