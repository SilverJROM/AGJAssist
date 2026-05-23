Task: Overmind — on workflow completion, remind the PARENT to close its CHILD sessions

Repo: /home/agjrom/TGBOTS/AGJAssist · Branch: feat/overmind (or current). Build = `npx tsc` + `npm run build`. Tests = `npx vitest run`.

Goal (JROM verbatim): "wire up the algorithm on overmind to ask the parent sessions after sending a completion message of their task to remind them to close all their child sessions so that we dont hog the system with opened session that is not needed anymore, their session is fine to stay up just their child session should be closed."

So: when a workflow is marked COMPLETE (the POST /api/overmind/complete transition), overmind sends a ONE-TIME reminder to the COORDINATOR (parent) pane telling it to close its child session(s) (the parent's own session stays up). It's a REMINDER (the parent does the closing) — overmind does NOT force-kill.

Implementation:
1. src/api/routes/overmind-routes.ts:
   - Add a `tmuxService?: TmuxService` param to `registerOvermindRoutes(...)` (import TmuxService type from ../../tmux/tmux-service.js). Thread it through.
   - In the POST /api/overmind/complete handler, INSIDE the existing completion-transition block (where `workflow.status !== "completed"` and `completed` is truthy — same place the DONE notification fires), add a best-effort child-close reminder:
     - If `completed.child_sessions` is non-empty AND tmuxService is provided:
       - Determine which children are still ALIVE via `tmuxService.sessionExists(child)` (await; it uses `tmux has-session`).
       - If at least one child is alive, send a ONE-LINE reminder to the coordinator pane via `tmuxService.sendCommand(completed.coordinator_session, <msg>, true, true)` (pressEnter=true, skipSafetyCheck=true — same call shape overmind's nudges use).
       - msg (single line, no embedded newlines), e.g.: `Overmind: '<label>' is marked complete — please close your child session(s) to free resources (your own session can stay up): tmux kill-session -t <alive1> ; tmux kill-session -t <alive2>`
       - If NO children are alive, send nothing (don't nag).
     - Wrap in try/catch; a failure here must NEVER fail the /complete response (log + continue), exactly like the existing notify try/catch.
   - This naturally fires once (only on the status transition to completed).
2. src/api/server.ts: pass `services.tmuxService` into the `registerOvermindRoutes(...)` call (it's available as services.tmuxService).
3. Test (extend tests/overmind-routes.test.ts): add a tmux mock ({ sessionExists: vi.fn, sendCommand: vi.fn, capturePane: vi.fn }) to the route registration. Assert:
   - completing a workflow that has child_sessions with ≥1 alive child → sendCommand called once on the coordinator_session with a message containing the alive child name(s) + "kill-session".
   - completing a workflow with NO child_sessions → sendCommand NOT called.
   - (optional) all children dead (sessionExists→false) → sendCommand NOT called.
   Keep the existing route tests green (they pass tmuxService as undefined or a mock — ensure the new optional param doesn't break them; default behavior with no tmuxService = no reminder, no crash).
4. `npx tsc` + `npm run build` clean; `npx vitest run` fully green (0 failures).

Scope/DON'T: only overmind-routes.ts + server.ts + the route test. Do NOT force-kill children (reminder only). Do NOT touch the watcher/brain, OVM chat, Notes, providers. Do NOT change other endpoints. Surgical.

Artifacts: write a short changes.md to plan/overmind/changes-ovm-child-close-reminder.md (User Report verbatim + per-file WHAT+WHY + Verification: tsc/build/vitest + how the reminder is gated one-time + alive-only). Commit `[overmind] on /complete, remind parent to close its child sessions (alive-only, one-time, reminder not kill)`. End with STATUS marker.
