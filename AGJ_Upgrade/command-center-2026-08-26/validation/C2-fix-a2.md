# C2 attempt 2 — FAIL prescription

commit judged: `217ae6b85937426415ba9c150cb58a1161973816`
Focused row command PASSES (8/8). a1 F1/F3/F4 and the **datetime() impl** of F2 are in. The due spec still does not discriminate the lexical trap. **1 finding.**

Do not re-touch `update()` null handling, cadence literal, or listActive projection.

---

FINDING 1 of 1
WHAT FAILED: `tests/unit/agent-reminder-service.spec.ts:155-190` `"getDueReminders returns due reminders respecting repeat limit"` creates SQLite-format `'2000-01-01 00:00:00'` (due) and `'2099-01-01 23:59:59'` (not due). Probe `validation/C2-probe-a2.json` `spec_2099_discriminates_lexical.would_old_lexical_pass_spec=true`: both the old `next_fire <= isoNow` compare and the new `datetime(next_fire) <= datetime('now')` agree on those two years, because the **date prefix** differs. The actual a1 trap is space (0x20) vs `T` (0x54) on the **same** UTC date: at `nowIso=2026-08-27T05:55:04.678Z`, next_fire `'2026-08-27 23:59:59'` has `lex_due=1` and `dt_due=0`. Service impl is already `dt_due` (not in due list). Reverting only the WHERE clause to lexical ISO would keep this spec green. The comment "to catch lexical bug" does not.
THE FIX: Keep the 2000/2099/exhausted-limit rows. In the **same** test, add a same-UTC-day SQLite-format future that sits in the lexical-trap window, prove it with a second path that does not call `getDueReminders`, then assert the service follows datetime:

```ts
const now = new Date();
const y = now.getUTCFullYear();
const mo = now.getUTCMonth();
const d = now.getUTCDate();
const endUtc = Date.UTC(y, mo, d, 23, 59, 59);
if (endUtc > now.getTime()) {
  const sqliteEod =
    `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")} 23:59:59`;
  const sameDay = service.create({
    user_id: userId,
    folder_group: "sameday-sqlite-future",
    cadence_minutes: 30,
    next_fire: sqliteEod,
    recipients: [{ agent_name: "a4" }],
  });
  const nowIso = now.toISOString();
  const trap = db.prepare(
    `SELECT
        next_fire <= ? AS lex_due,
        datetime(next_fire) <= datetime('now') AS dt_due
     FROM agent_solicit_reminders WHERE id = ?`
  ).get(nowIso, sameDay.id) as { lex_due: number; dt_due: number };
  expect(trap.lex_due).toBe(1);
  expect(trap.dt_due).toBe(0);
  expect(ids).not.toContain(sameDay.id);
}
```

`ids` must be computed **after** this create (move `getDueReminders()` below it). The `lex_due===1 && dt_due===0` pair is the specimen that contradicts lexical; `not.toContain` is the service following datetime. Do **not** drop the 2000/2099 pair. Do **not** change `getDueReminders` SQL — it is already the a1 datetime() form. The `if (endUtc > now.getTime())` skips the last second of a UTC day when 23:59:59 is no longer future; that window is not the regression.
WHY THE LAST ATTEMPT MISSED IT: a1 prescribed the 2099/2000 literals; those years do not share a date prefix with ISO-now, so they never enter the space-vs-T trap.
