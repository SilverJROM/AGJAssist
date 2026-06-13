# Batch A3a Independent Validation

Validation method: outcome-level Vitest coverage plus full-suite regression.

Evidence:
- Callback DONE writes one status event.
- Git HEAD advance with no callback writes a DONE status event.
- Callback plus git for the same batch dedupes to one terminal event and records merged `callback` + `git` provenance.
- Structured chat message event round-trips from insert to run-scoped query.
- Pane-idle terminal detection requires observed prior activity before emitting DONE.

Result: PASS.
