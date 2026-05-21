# Requirements Coverage Matrix — Overmind

| Req# | Requirement (first 80 chars) | Batch | Evidence | Status |
|------|------------------------------|-------|----------|--------|
| R1 | Schema v11 overmind_workflows table + migration + CRUD | A1 | validation/batch-A1.md (tsc clean, 3/3 vitest) | VERIFIED |
| R2 | Lifecycle endpoints register/complete, OVERMIND_TOKEN localhost guard | A2 | — | UNASSIGNED |
| R3 | GET /api/overmind/workflows (auth, pure DB read) | A2 | — | UNASSIGNED |
| R4 | Watcher loop ~45s, capture coordinator+child panes, markers, mtimes | A3 | — | UNASSIGNED |
| R5 | Classifier state machine (working/waiting_human/stuck/completed/...) | A3 | — | UNASSIGNED |
| R6 | Nudge ladder Tier 1-2 coordinator-only, backoff | A5 | — | UNASSIGNED |
| R7 | Sonnet brain Tier 3, tiny context, no outside API | A6 | — | UNASSIGNED |
| R8 | Tier 4 + DONE/BLOCKED Telegram push, waiting_human halt | A5,A6 | — | UNASSIGNED |
| R9 | Telegram /overmind /om_pause /om_resume /om_drop | A4 | — | UNASSIGNED |
| R10 | UI /overmind Preact panel | A7 | — | UNASSIGNED |
| R11 | OvermindStreamManager WS /ws/overmind live updates | A7 | — | UNASSIGNED |
| R12 | projcore.md register/complete curl wiring | B | — | UNASSIGNED |
| R14 | Tasklist ingestion (POST /tasks) + done/processing/pending display | A2,A4,A7,B | — | UNASSIGNED |
| R15 | Decision interception + Sonnet answer-from-northstar / escalate guardrail | A3,A6 | — | UNASSIGNED |
| R16 | Projcore frontload-correction (log + coordinator reminder) | A6,B | — | UNASSIGNED |
| R13 | Onboard 3 live workflows visible on dashboard | C | — | UNASSIGNED |

**Final acceptance:** every row VERIFIED. None may remain UNASSIGNED/IN-PROGRESS/CLAIMED/FAIL at run-complete.
