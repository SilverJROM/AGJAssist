# req-matrix — agjassist-command-center

Status: ASSIGNED after planning custody. VERIFIED only after independent gate.
A0 is HARNESS-SMOKE only (not product A5).

| AC | statement (short) | slices | status |
|----|-------------------|--------|--------|
| A1 | OVM screens/nav gone | B1, B8, G1 | ASSIGNED |
| A2 | /api/overmind + watcher/brain gone | B2, B3, B4, B8, G1 | ASSIGNED |
| A3 | bot /overmind /om_* /ovm_* unknown | B5, B8, G1 | ASSIGNED |
| A4 | backup then drop overmind_* tables; schema parity | B7, B8, G2 | ASSIGNED |
| A5 | boot + terminal/chat + suites green after teardown | B4, B8, G1, G2 | ASSIGNED |
| B1 | guardian escalate removed | B6, B8 | ASSIGNED |
| B2 | non-guardian paging still works | B6, B8 | ASSIGNED |
| C1 | folder-level reminder create | C1, C4, C5, C6 | ASSIGNED |
| C2 | cadence 15/30/45/60/90 + custom | C1, C2, C5, C6 | ASSIGNED |
| C3 | stop-after-N or unlimited | C1, C2, C5, C6 | ASSIGNED |
| C4 | per-agent include/skip | C1, C2, C4, C5, C6 | ASSIGNED |
| C5 | server-side solicit, safety + audit | C3, C6 | ASSIGNED |
| C6 | active-reminders view persisted | C1, C2, C4, C6 | ASSIGNED |
| D1 | one-time wakeup schedule | E1, E2, E3, E4, E5 | ASSIGNED |
| D2 | pending chip, clears on fire/cancel | E1, E2, E3, E4, E5 | ASSIGNED |
| D3 | fire action once, safety + audit | E1, E2, E4, E5 | ASSIGNED |
| E1 | summary after reminder reply | D1, D3, D7 | ASSIGNED |
| E2 | summaries dropdown newest first | D4, D6, D7 | ASSIGNED |
| E3 | endpoint provenance; LLM fail degrades | D1, D3, D6, D7 | ASSIGNED |
| F1 | named OpenAI-compatible endpoints | D2, D4, D5, D7 | ASSIGNED |
| F2 | default endpoint 140 | D1, D2, D4, D5, D7 | ASSIGNED |
| F3 | owner-only, no plaintext secrets | D1, D2, D4, D5, D7 | ASSIGNED |
| G1 | per-agent draft kept on switch | F1, F2, F7 | ASSIGNED |
| G2 | send clears draft; switcher indicator | F1, F2, F7 | ASSIGNED |
| G3 | localStorage isolation + reload | F1, F2, F7 | ASSIGNED |
| H1 | independent collapse, default tabs-collapsed | F4, F7 | ASSIGNED |
| H2 | one-row collapsed header + bell | F4, F7 | ASSIGNED |
| H3 | theme-adaptive, readable, 3 widths | F6, F7 | ASSIGNED |
| I1 | refresh re-pulls tmux transcript + details | F3, F7 | ASSIGNED |
| I2 | refresh in-progress, composer unblocked | F3, F7 | ASSIGNED |
| J1 | phone dropdown switcher | F5, F6, F7 | ASSIGNED |
| J2 | wide drag scrubber + same switch action | F5, F6, F7 | ASSIGNED |
