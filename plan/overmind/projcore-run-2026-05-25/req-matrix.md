# Requirements Matrix — Overmind Idle Detection Three-Path Refactor

| Req# | Requirement (verbatim, first 80 chars)                                           | Batch | Evidence | Status |
|------|----------------------------------------------------------------------------------|-------|----------|--------|
| R1   | All three nudge paths use single cooldown key `unified_idle_nudge`               | B1    | —        | IN-PROGRESS |
| R2   | PATH 1: stuck response, `stuck_nudge_cooldown_minutes`, increments nudge_count   | B1    | —        | IN-PROGRESS |
| R3   | PATH 2: all-sessions idle, 10min grace, unified msg, no nudge_count increment    | B1    | —        | IN-PROGRESS |
| R4   | PATH 3: artifact fail-safe, 30min threshold, fires regardless of pane state      | B1    | —        | IN-PROGRESS |
| R5   | Settings renamed/added: stuck_nudge_cooldown, unified_idle_threshold, compat     | B1    | —        | IN-PROGRESS |
| R6   | NudgeStateService: lastUnifiedIdleNudgeAt + get/set methods                      | B1    | —        | IN-PROGRESS |
| R7   | On-deploy legacy seed from MAX(old keys) to prevent burst                        | B1    | —        | IN-PROGRESS |
| R8   | npm test exits 0, new tests cover all 3 paths + cross-path + backward compat     | B1    | —        | IN-PROGRESS |
