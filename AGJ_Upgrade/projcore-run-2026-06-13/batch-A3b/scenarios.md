# Batch A3b Scenarios

## Requirement

R21 — App-owned wake/callback substrate: agents request wake + emit status through ONE uniform app interface; the app performs SCHEDULING/WAKING regardless of provider.

## Scope

- Add additive `agent_wake_schedule` storage.
- Add service-level `requestWake(run_id, batch_id, target_session, kind, due_at)`.
- Process due wakes from the app scheduler via the existing overmind watcher cadence.
- Keep overmind standalone behavior unchanged when no scheduler is wired.

## Acceptance Scenarios

- A due `poke-pane` wake invokes `TmuxService.sendAndSubmit` for the target session and stamps `fired_at`.
- A not-yet-due wake does not invoke tmux and leaves `fired_at` empty.
- A wake with `fired_at` already set never fires again.
- A `wake-coordinator` wake records a `status` agent event for the coordinator and stamps `fired_at`.
- A processed wake that is skipped, such as a missing target pane, is stamped with `fired_at` and an outcome so it does not retry forever.

Autonomous decisions: none.
