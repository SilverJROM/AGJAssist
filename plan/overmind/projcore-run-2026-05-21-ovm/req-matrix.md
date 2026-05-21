# Req Matrix — OVM Operator Chat
| Req# | Requirement | Batch | Evidence | Status |
|------|-------------|-------|----------|--------|
| OU1 | Operator-control endpoints (pause/resume/drop, token) | O1 | live: 200/200/200/401, row gone | VERIFIED |
| OU2 | OVM session manager (open-reuse/restart/close) + primer | O2 | live: claude launched+primed+ready, reuse ok | VERIFIED |
| OU3 | OVM tab UI (live chat view + controls) | O3 | — | UNASSIGNED |
| OU4 | Telegram /ovm_start + /ovm_end chat relay + menu update | O4 | — | UNASSIGNED |

| OU5 | Telegram startup/polling non-fatal (app stays up if TG down) | O5 | batch-O5/independent-validation.md | VERIFIED |

| OU6 | Classifier: activity = pane change, not stale marker | O6 | 19 tests, deployed; lkcamp frozen-case fixed | VERIFIED |

Final acceptance: every row VERIFIED.
