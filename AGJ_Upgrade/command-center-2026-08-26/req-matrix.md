# req-matrix — agjassist-command-center

Status: ASSIGNED after planning custody. VERIFIED only after independent gate.
A0 is HARNESS-SMOKE only (not product A5).

| AC | statement (short) | slices | status |
|----|-------------------|--------|--------|
| A1 | OVM screens/nav gone | B1, B8, G1 | VERIFIED (B8 --gate 78fe35e1, elite; G1 --gate 28d4605) |
| A2 | /api/overmind + watcher/brain gone | B2, B3, B4, B8, G1 | VERIFIED (B8 --gate 78fe35e1, elite; G1 --gate 28d4605) |
| A3 | bot /overmind /om_* /ovm_* unknown | B5, B8, G1 | VERIFIED (B8 --gate 78fe35e1, elite; G1 --gate 28d4605) |
| A4 | backup then drop overmind_* tables; schema parity | B7, B8, G2 | VERIFIED (B8 --gate 78fe35e1, elite; G2 --gate 6c26334, elite) |
| A5 | boot + terminal/chat + suites green after teardown | B4, B8, G1, G2 | VERIFIED (B8 --gate 78fe35e1, elite; G1 --gate 28d4605; G2 --gate 6c26334, elite) |
| B1 | guardian escalate removed | B6, B8 | VERIFIED (B8 --gate 78fe35e1, elite) |
| B2 | non-guardian paging still works | B6, B8 | VERIFIED (B8 --gate 78fe35e1, elite) |
| C1 | folder-level reminder create | C1, C4, C5, C6 | VERIFIED (C6 --gate fe98610e, elite) |
| C2 | cadence 15/30/45/60/90 + custom | C1, C2, C5, C6 | VERIFIED (C6 --gate fe98610e, elite) |
| C3 | stop-after-N or unlimited | C1, C2, C5, C6 | VERIFIED (C6 --gate fe98610e, elite) |
| C4 | per-agent include/skip | C1, C2, C4, C5, C6 | VERIFIED (C6 --gate fe98610e, elite) |
| C5 | server-side solicit, safety + audit | C3, C6 | VERIFIED (C6 --gate fe98610e, elite) |
| C6 | active-reminders view persisted | C1, C2, C4, C6 | VERIFIED (C6 --gate fe98610e, elite) |
| D1 | one-time wakeup schedule | E1, E2, E3, E4, E5 | VERIFIED (E5 --gate 126885a5, elite; positive+negative-control green) |
| D2 | pending chip, clears on fire/cancel | E1, E2, E3, E4, E5 | VERIFIED (E5 --gate 126885a5, elite) |
| D3 | fire action once, safety + audit | E1, E2, E4, E5 | VERIFIED (E5 --gate 126885a5, elite) |
| E1 | summary after reminder reply | D1, D3, D7 | VERIFIED (D0 --gate 7a4c7c0; D7 satisfied-via-D0) |
| E2 | summaries dropdown newest first | D4, D6, D7 | VERIFIED (D0 --gate 7a4c7c0; D7 satisfied-via-D0) |
| E3 | endpoint provenance; LLM fail degrades | D1, D3, D6, D7 | VERIFIED (D0 --gate 7a4c7c0; D7 satisfied-via-D0) |
| F1 | named OpenAI-compatible endpoints | D2, D4, D5, D7 | VERIFIED (D0 --gate 7a4c7c0; D7 satisfied-via-D0) |
| F2 | default endpoint 140 | D1, D2, D4, D5, D7 | VERIFIED (D0 --gate 7a4c7c0; D7 satisfied-via-D0) |
| F3 | owner-only, no plaintext secrets | D1, D2, D4, D5, D7 | VERIFIED (D0 --gate 7a4c7c0; D7 satisfied-via-D0) |
| G1 | per-agent draft kept on switch | F1, F2, F7 | VERIFIED (F7 --gate 126885a5, elite; F0b/F0c/F0d/F8 harness+regression fixes folded in) |
| G2 | send clears draft; switcher indicator | F1, F2, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| G3 | localStorage isolation + reload | F1, F2, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| H1 | independent collapse, default tabs-collapsed | F4, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| H2 | one-row collapsed header + bell | F4, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| H3 | theme-adaptive, readable, 3 widths | F6, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| I1 | refresh re-pulls tmux transcript + details | F3, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| I2 | refresh in-progress, composer unblocked | F3, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| J1 | phone dropdown switcher | F5, F6, F7 | VERIFIED (F7 --gate 126885a5, elite) |
| J2 | wide drag scrubber + same switch action | F5, F6, F7 | VERIFIED (F7 --gate 126885a5, elite; F8 restored 390px controls per locked mockup, north-ruled regression fix) |

All 44 acceptance criteria VERIFIED via independent INTEGRATION fence gates (B8, C6, D7, E5, F7 — all elite redteam, all positive+negative-control green, all superset-clean). Queue: 47/47 DONE, 0 pending, 0 parked, run_complete=true. Harness-correctness rows (F0/F0b/F0c/F0d/E0/E0b/E0c/D0/C0/H8) and the two north-ruled product-regression fixes (F8, and the reminder/wakeup route param-typing fix folded into G2) are not separate ACs — they are what let the fences above measure the real product honestly.
