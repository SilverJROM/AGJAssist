# Requirements Coverage Matrix — Overmind

| Req# | Requirement (first 80 chars) | Batch | Evidence | Status |
|------|------------------------------|-------|----------|--------|
| R1 | Schema v11 overmind_workflows table + migration + CRUD | A1 | validation/batch-A1.md (tsc clean, 3/3 vitest) | VERIFIED |
| R2 | Lifecycle endpoints register/complete, OVERMIND_TOKEN localhost guard | A2 | validation/batch-A2.md (live: 201/401/200/404) | VERIFIED |
| R3 | GET /api/overmind/workflows (auth, pure DB read) | A2 | validation/batch-A2.md (live: 401 no-auth) | VERIFIED |
| R4 | Watcher loop ~45s, capture coordinator+child panes, markers, mtimes | A3,A4 | validation/batch-A4.md (live: real pane hash on session ovm-build) | VERIFIED |
| R5 | Classifier state machine (working/waiting_human/stuck/awaiting_decision) | A3 | validation/batch-A3.md (7/7 unit) | VERIFIED |
| R6 | Nudge ladder Tier 1-2 coordinator-only, backoff | A5 | validation/batch-A5.md (live: Tier1→2→stop, child clean) | VERIFIED |
| R7 | Sonnet brain Tier 3, tiny context, no outside API | A6a | validation/batch-A6a.md (live Sonnet verdict parsed) | VERIFIED |
| R8 | Tier 4 + DONE/BLOCKED Telegram push, waiting_human halt | A5,A6a | DONE(A5)+BLOCKED→waiting_human(A6a) logic verified; live TG delivery blocked by env polling issue | VERIFIED* |
| R9 | Telegram /overmind /om_tasks /om_pause /om_resume /om_drop | A4 | validation/batch-A4.md (3/3 command tests) | VERIFIED |
| R10 | UI /overmind Preact panel | A7 | — | UNASSIGNED |
| R11 | OvermindStreamManager WS /ws/overmind live updates | A7 | — | UNASSIGNED |
| R12 | projcore.md register/complete curl wiring | B | — | UNASSIGNED |
| R14 | Tasklist ingestion (POST /tasks) + done/processing/pending display | A2,A4,A7,B | endpoint live-verified A2; display pending | IN-PROGRESS |
| R15 | Decision interception + Sonnet answer-from-northstar / escalate guardrail | A3,A6b | validation/batch-A6b.md (live answer + guardrail test) | VERIFIED |
| R16 | Projcore frontload-correction (log + coordinator reminder) | A6b,B | validation/batch-A6b.md (correction note + log) | VERIFIED |
| R13 | Onboard 3 live workflows visible on dashboard | C | — | UNASSIGNED |

**Final acceptance:** every row VERIFIED. None may remain UNASSIGNED/IN-PROGRESS/CLAIMED/FAIL at run-complete.
