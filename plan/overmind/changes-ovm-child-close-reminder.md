# changes: ovm-child-close-reminder

## User Report (verbatim)
"wire up the algorithm on overmind to ask the parent sessions after sending a completion message of their task to remind them to close all their child sessions so that we dont hog the system with opened session that is not needed anymore, their session is fine to stay up just their child session should be closed."

## Per-file changes

### src/api/routes/overmind-routes.ts
- **WHAT**: Added `import type { TmuxService }` at the top. Added optional `tmuxService?: TmuxService` as the 8th param to `registerOvermindRoutes`. Inside the `/complete` completion-transition block (same `if` guard as the DONE notify), added a best-effort child-close reminder: checks each `child_sessions` entry via `tmuxService.sessionExists`, collects alive children, sends a single-line reminder to `coordinator_session` via `sendCommand(target, msg, true, true)` naming all alive children with their `tmux kill-session -t <child>` commands. Wrapped in its own `try/catch` so it can never fail the `/complete` response.
- **WHY**: Remind the parent coordinator to clean up child sessions after completion without overmind force-killing them.

### src/api/server.ts
- **WHAT**: Added `services.tmuxService` as the 8th argument to the `registerOvermindRoutes(...)` call.
- **WHY**: Wire the existing `TmuxService` instance through to the route handler so the reminder can fire in production.

### tests/overmind-routes.test.ts
- **WHAT**: Added `import type { TmuxService }` at the top. Added a new `describe("child-close reminder on /complete")` block with four tests: (1) alive child → `sendCommand` called once on coordinator with child name + "kill-session"; (2) no child_sessions → `sendCommand` not called; (3) all children dead (sessionExists → false) → `sendCommand` not called; (4) no tmuxService provided → no crash, `/complete` still succeeds.
- **WHY**: Assert the reminder gating logic is correct under all cases.

## Verification

| Step | Result |
|------|--------|
| `npx tsc` | Clean (0 errors) |
| `npm run build` | Clean (tsc + cp web assets) |
| `npx vitest run` | 294 passed / 0 failed (26 test files) |

## How the reminder is gated

**One-time**: The reminder fires inside the `workflow.status !== "completed"` transition guard — the same guard that gates the DONE notification. It runs only when the workflow transitions FROM a non-completed state TO completed. A second `/complete` call on the same session hits `setStatus` again but `markNotificationTransition` returns false (already transitioned), so the entire block (notify + reminder) is skipped.

**Alive-only**: Before sending, `tmuxService.sessionExists(child)` is called for each entry in `child_sessions`. Only sessions that return `true` are included in the reminder message. If all children are already dead, `aliveChildren` is empty and `sendCommand` is never called.

**Non-blocking**: The entire reminder block is wrapped in `try/catch`. Any failure (tmux not running, invalid target, network error) is logged and swallowed — the `/complete` response succeeds regardless.
