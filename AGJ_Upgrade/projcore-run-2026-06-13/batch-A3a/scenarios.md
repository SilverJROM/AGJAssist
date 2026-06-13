# Batch A3a Scenarios

## TS-A3a-001 Callback terminal event
Given a run has a `callbacks.md` line for `implementer A3a STATUS: DONE`
When the agent event ingest ticks the run
Then one `agent_events` status row is written with `source = callback`, `state = DONE`, and the terminal correlation id.

## TS-A3a-002 Silent-agent git terminal event
Given no callback line exists and the expected branch HEAD advances
When the agent event ingest ticks the run after the advance
Then one `agent_events` status row is written with `source = git` and `state = DONE`.

## TS-A3a-003 Multi-signal terminal dedupe
Given callback DONE and git HEAD advance both occur for the same batch
When ingest observes both signals
Then only one logical terminal status event remains for the shared correlation id and its body records both `callback` and `git` sources.

## TS-A3a-004 Structured chat message round trip
Given a structured message event is posted through the event service
When the event stream is queried by run id
Then the message row round-trips with real role, status, timestamp, source, and body.

## TS-A3a-005 Pane idle requires prior activity
Given a pane is idle without observed prior activity
When ingest ticks past the idle threshold
Then no terminal event is emitted.
When the pane changes and then becomes idle
Then a pane-sourced DONE status event is emitted.
