FINDING 1 of 2
WHAT FAILED: `AgentWakeupService.fire()` ignores the `SendCommandResult.blocked` value returned by `TmuxService.sendCommand`. A tmux result-path probe with `sendCommand` resolving `{ message: "blocked", blocked: true }` produced `{"ok":true,"status":"fired","firedAudits":1,"failAudits":0}`. That records a wakeup as fired even though the existing TmuxService contract says the command was blocked and not sent.
THE FIX: Capture the result of `await this.tmuxService.sendCommand(row.pane_target, row.action, true, false)`. If `result.blocked` is true, write an `agent_wakeup_blocked` or `agent_wakeup_send_failed` audit with the tmux result message/pattern details, update the claimed wakeup to `status = 'cancelled'`, and return false. Only write `agent_wakeup_fired` and return true when `blocked` is false.
WHY THE LAST ATTEMPT MISSED IT: It handled thrown tmux failures but not the non-throwing blocked return path in `TmuxService.sendCommand`.

FINDING 2 of 2
WHAT FAILED: `tests/unit/agent-wakeup-service.spec.ts` does not discriminate the non-throwing tmux blocked path. Current tests cover explicit `SafetyService` blocks and thrown tmux errors indirectly are not covered, but no specimen makes `sendCommand` resolve with `blocked: true`.
THE FIX: Add a unit test that creates a due wakeup, stubs `tmux.sendCommand` to resolve `{ message: "blocked", blocked: true }`, calls `service.fire(w.id)`, and asserts the return is false, final status is `cancelled`, no `agent_wakeup_fired` audit exists for that id, and a blocked/failure audit exists for that id.
WHY THE LAST ATTEMPT MISSED IT: The mocks always returned `{ blocked: false }`, so the service could ignore the result shape and still pass.
