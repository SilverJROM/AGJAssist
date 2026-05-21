Batch-W5: Per-run elapsed reset (run_started_at) + accumulated total

Batch ID: W5
Requirements: og-requirements-r3.md (WU5), north-star-r3.md
Branch: feat/overmind (CONTINUE). Schema currently v14.

Estimated: SHORT.

Context:
Elapsed currently = (ended_at ?? now) − created_at, so it ACCUMULATES across re-registers (JROM restarted overmind and saw ~1h7m). Fix: time the CURRENT run, reset on every (re)register, and keep a separate accumulated total.

Requirement (verbatim, WU5):
"Add run_started_at TEXT (set to now on EVERY register) and accumulated_ms INTEGER NOT NULL DEFAULT 0. On register: roll prior run's elapsed ((ended_at ?? now) − run_started_at) into accumulated_ms, then set run_started_at = now (recompute ended_at from new tasklist). created_at stays first-creation. Display: 'Elapsed: <current run>' primary (= (ended_at ?? now) − run_started_at, freezes when done) + 'Total: <accumulated_ms + current>' secondary."

Expected (acceptance):
1. Schema v15 (14→15): add run_started_at TEXT + accumulated_ms INTEGER NOT NULL DEFAULT 0 to SCHEMA_SQL + guarded version<15 migration (PRAGMA table_info + ALTER ADD COLUMN, idempotent). For existing rows, backfill run_started_at = created_at on migration (so they don't break).
2. register() in overmind-service:
   - If the row already exists (upsert): compute prior elapsed = (ended_at ?? now) − run_started_at (guard nulls), add to accumulated_ms; set run_started_at = now; recompute ended_at from the new tasklist (all-done → now, else null).
   - New row: run_started_at = now, accumulated_ms = 0, created_at = now.
3. OvermindWorkflow interface + GET mapping include run_started_at + accumulated_ms.
4. UI (app.js / overmind-helpers.js): 
   - Current elapsed = (ended_at ?? now) − run_started_at → "Elapsed: <Xh Ym>" primary (live-tick when ended_at null, frozen + "(done)" when set). Reuse existing now-interval.
   - Total = accumulated_ms + currentElapsedMs → "Total: <...>" secondary (smaller).
   - Pure helpers (currentElapsedMs, totalElapsedMs, formatElapsed) node-testable.
5. npx tsc clean.

Likely files:
- src/db/database.ts (v15 + migration + backfill run_started_at=created_at)
- src/services/overmind-service.ts (register roll-up + reset; interface/mapping)
- src/web/public/overmind-helpers.js (current/total helpers)
- src/web/public/app.js (Elapsed primary + Total secondary)
- tests: service (register resets run_started_at + rolls accumulated; ended_at recompute) + helper (current/total/format)

Scope: elapsed reset + total ONLY. Don't touch notifications (W1), table/rename/history (W2-W4). Migration safe on live DB + backfill existing rows. Surgical.

Tests (targeted):
- register existing row again → run_started_at advances to ~now, accumulated_ms increased by prior elapsed; new row → accumulated_ms 0.
- helper: currentElapsedMs (ticking vs frozen), totalElapsedMs = accumulated + current, formatElapsed.
Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + database.ts (v14 migration pattern) + overmind-service.ts (register) + app.js (elapsed display from V6) + overmind-helpers.js. Reply STATUS: PROPOSED with v15 migration+backfill, the register roll-up/reset logic, current/total helpers, UI, tests. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement, commit, gate (tests + tsc + npm run build). Artifacts batch-W5/changes.md + test-report.md + independent-validation.md. projcore will LIVE-SMOKE: re-register a workflow → current Elapsed resets ~0, Total carries over.

Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-r3/callbacks.md [projcore callback] W5 <STATE> <note>, THEN STATUS: <verb> -- reason.
