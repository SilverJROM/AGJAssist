# Overmind Round 3 — Requirements (locked 2026-05-21)

Follow-on to the completed overmind build + UI round. AGJAssist, branch `feat/overmind`. Frontend Preact/HTM no-build. Deploy `npm run build` + `pm2 restart agjassist`. Schema currently v13. Notification format per `~/.claude/agents/NOTIFICATION_PROTOCOL.md` (verdict-led).

**WU1 — Brain-gated Telegram notifications (resolve-first, escalate-last).** Overmind sends a Telegram message to JROM (via bot.sendMessage to AUTHORIZED_USER_ID) ONLY on these transitions, ONCE per transition, nothing else ever:
  - **completed → 🎉 DONE.**
  - **blocked/stuck OR awaiting-input (stuck/failed, waiting_human, awaiting_decision) → the brain MUST attempt resolution FIRST:** read the workflow's north-star (`run_dir/north-star.md`), trust-defaults (`~/.claude/JROM/style/trust-defaults.md`), AND JROM's previous decisions (the run's `run_dir/decisions/` + global `~/.claude/JROM/decisions/`, relevance-filtered by the blocker/decision topic — do NOT dump all; grep/select relevant entries to stay token-light). If the brain can resolve it from those (answer/nudge the COORDINATOR per existing coordinator-only rules) → resolve autonomously, do NOT notify JROM. Only when TRULY unresolvable from north-star + decisions → notify JROM (🛑 BLOCKED or 🚨 needs-your-input) with the verbatim issue + what the brain checked + why it couldn't resolve.
  - **JROM directive:** escalating something that COULD have been resolved from the north-star/decisions is an OVERMIND FAILURE. Bias hard toward autonomous resolution.
  - Messages follow NOTIFICATION_PROTOCOL verdict-led format (header → ✅/⛔/❓ verdict line → high-value labelled lines → action line). Best-effort send (try/catch, never crash the loop). No progress/interim/other messages.
*Acceptance:* a blocker the north-star/decisions covers is auto-resolved (no TG); a genuinely-unresolvable one produces ONE verdict-led TG message citing what was checked; completed produces ONE DONE message; nothing else fires.

**WU2 — Expanded-detail table.** In the expanded workflow card, present the details (parent, child-working/active session, tier, elapsed, stuck, coordinator, children) as a compact **2-column table** (label/value rows), mobile-friendly, replacing the current loose layout. Keep tasklist + history outside the table.
*Acceptance:* expanding a card shows a clean 2-col label/value table with those fields.

**WU3 — Rename workflow in the mini-app (persistent custom name).** Add a `display_name TEXT` column (schema bump). A rename control in the UI (expanded card or a small ✏️) lets JROM set a custom name; persisted via an authenticated endpoint (PATCH/POST /api/overmind/workflows/:id/name, JWT auth — browser action). The dashboard/cards/Telegram show `display_name ?? label`. **register()/tasks-update from projcore MUST NOT overwrite display_name** (projcore sets `label`; the user's display_name wins until cleared).
*Acceptance:* renaming a workflow in the UI sticks across a projcore re-register; clearing it falls back to the code label.

**WU4 — History tab + persistent archive.** Dashboard tabs become **Active / Completed / History** (rename "Done"→"Completed"; add History). History shows a **persistent archive** of task-log entries that SURVIVES workflow completion/removal (stored in a separate table, not just the workflow row's task_log). Layout: **grouped by workflow** (display_name ?? label), entries newest-first, collapsible per workflow. The archive is appended whenever a workflow's task log gains an entry (and retained on /om_drop / complete).
*Acceptance:* History tab lists past workflows (incl. dropped/completed ones) each with their logged task history; removing a live workflow does not erase its history.

**Constraints:** Preact/HTM no-build; pure helpers node-testable; coordinator-only + Sonnet-only + no-outside-API unchanged; brain context stays token-light (relevance-filtered decisions); migrations idempotent on the live DB; deploy `npm run build`; commit per batch; live-smoke.

## Injected 2026-05-21 (round-3 §1.4b)

**WU5 — Per-run elapsed reset + accumulated total.** The "elapsed" currently counts from created_at, so it ACCUMULATES across re-registers (JROM saw 1h7m after restarting). Fix: add `run_started_at TEXT` (set to now on EVERY register — work (re)start) and `accumulated_ms INTEGER NOT NULL DEFAULT 0`. On register: roll the prior run's elapsed ((ended_at ?? now) − run_started_at) into accumulated_ms, then set run_started_at = now (and recompute ended_at from the new tasklist). created_at stays first-creation. Display: **"Elapsed: <current run>" primary** (= (ended_at ?? now) − run_started_at, freezes when done) + **"Total: <accumulated_ms + current>" secondary**. (schema bump.)
*Acceptance:* re-registering a workflow resets its current Elapsed to ~0 (timing the new run); Total keeps the cumulative across runs; current freezes when all tasks done.
