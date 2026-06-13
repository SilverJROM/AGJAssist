# Batch A4 Scenarios

## TS-A4-001 — grok status-file normalizes into agent_events
- Given a grok status file containing strict JSON `{status, commit, dev_url, notes}`
- When `AgentEventIngest.tick()` runs with `statusFilePath`
- Then one `agent_events` row is recorded with `type=status`, `state=DONE`, `source=callback`, and terminal correlation id `terminal:<run>:<batch>:DONE`

## TS-A4-002 — app dispatch launches grok through resolver and feeds composed prompt
- Given a caller-supplied composed prompt and grok launch metadata
- When `ProviderDispatchService.dispatchToProvider()` runs
- Then A2 resolver returns a launch command containing `--agent agj-implementer` and launch-time `--effort high`
- And the helper creates/uses the tmux session, sends the launch command, feeds the exact composed prompt plus dispatch marker, and capture-verifies the marker

## TS-A4-003 — grok status-file and git DONE reconcile
- Given grok emits a status-file DONE and the git HEAD later advances for the same batch
- When both signals are ingested
- Then they produce one terminal status row keyed by the same correlation id with merged callback + git provenance
