# Queue — Overmind (dynamic; append on mid-run injection §1.4b)

Locked initial set (ordered by dependency). One atomic slice at a time.

1. **A1** — Schema v11 (incl `tasks`,`current_task`,`pending_decision`, `awaiting_decision`) + migration + CRUD (R1) — SHORT — PENDING
2. **A2** — Lifecycle + read + tasks endpoints + OVERMIND_TOKEN (R2,R3,R14-endpoint) — SHORT — PENDING
3. **A3** — Watcher loop + classifier incl decision-prompt detection, detection only (R4,R5,R15-detect) — SHORT* (split if PROPOSED >30min) — PENDING
4. **A4** — Telegram cmds (+`/om_tasks`, current-task display) + start loop in index.ts (R9,R14-tg) — SHORT — PENDING
5. **A5** — Nudge ladder Tier 1-2 + DONE/BLOCKED push (R6,R8) — SHORT — PENDING
6. **A6** — Sonnet brain: Tier 3 unstick + decision answer-from-northstar/escalate + projcore correction + waiting_human/pause (R7,R8,R15,R16) — SHORT* (split A6a unstick / A6b decision+correction if PROPOSED >30min) — PENDING
7. **A7** — UI panel (+tasklist done/processing/pending, pending_decision) + WS stream manager (R10,R11,R14-ui) — SHORT* (split if PROPOSED >30min) — PENDING
8. **B** — Wire projcore.md register/tasks/complete + frontload-reinforcement (R12,R14-submit,R16-projcore) — SHORT — PENDING
9. **C** — Onboard 3 live workflows, capstone (R13) — SHORT, NS-7 gated — PENDING

`*` candidate split points flagged for Phase 0.5 handshake.
