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

# [driver] C2 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed C2: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator C2 STATUS: DONE — FAIL 2000/2099 due spec does not trap same-day sqlite vs ISO lexical

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
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
