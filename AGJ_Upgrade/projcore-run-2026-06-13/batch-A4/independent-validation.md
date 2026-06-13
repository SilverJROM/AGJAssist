# Batch A4 Independent Validation

## Self-Validation
- Confirmed `AgentEventIngest` retains universal git HEAD and pane-idle detection unchanged; A4 only adds the optional status-file signal before those existing signals.
- Confirmed grok status-file DONE and git DONE share `correlationId(runId, batchId, "DONE")`, producing one terminal row with merged `sources`.
- Confirmed provider-scoped grok dispatch checks exist only in `src/services/provider-dispatch-service.ts`.
- Confirmed `~/.claude/agents/lib/projcore-dispatch.sh` was not edited.

## External Gate
- Live grok end-to-end proof is intentionally deferred to the projcore gate per A4 brief.
