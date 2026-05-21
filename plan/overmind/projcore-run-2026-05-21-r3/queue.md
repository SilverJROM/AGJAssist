# Queue — Overmind Round 3 (branch feat/overmind)

1. **W1** — Brain-gated notifications: resolve-first (north-star + trust-defaults + JROM decisions, relevance-filtered) → escalate-last; DONE/BLOCKED/needs-input once-per-transition, NOTIFICATION_PROTOCOL format (WU1) — SHORT* (split W1a brain-decisions-context / W1b notify-gating if >30min) — PENDING
2. **W2** — Expanded-detail 2-col table (WU2) — SHORT — PENDING
3. **W3** — Rename workflow + display_name (schema) + auth endpoint + UI; survives re-register (WU3) — SHORT — PENDING
4. **W4** — History tab (Active/Completed/History) + persistent archive table, grouped-by-workflow (WU4) — SHORT* — PENDING

One batch at a time, plan-handshake, gate + live-smoke per batch.
1.5 **W5** — Per-run elapsed reset (run_started_at) + accumulated_ms + UI current/total (WU5), schema bump — SHORT — PENDING (bumped next after W1)

6. **W6** — Per-session status: classify parent + each child independently, persist (schema v18 parent_status+child_statuses) (WU6) — SHORT — PENDING
7. **W7** — Restructured detail card + unified color scheme (working=green) + remove inline history (WU7) — SHORT — PENDING
