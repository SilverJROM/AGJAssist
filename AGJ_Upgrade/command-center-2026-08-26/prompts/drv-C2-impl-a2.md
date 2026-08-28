# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# [driver] C2 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed C2: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator C2 STATUS: DONE — FAIL update ?? keeps repeat_limit; due lexical ISO vs sqlite next_fire

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
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
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(C2): <summary>` or `[C2] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer C2 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Services layer: `AgentSolicitService` CRUD and due-state for preset/custom cadence, stop-after-N or unlimited, immediate include/skip, persisted active-reminder projections.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **C2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C6** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4`
