Task: Overmind — make coordinator messages RELIABLY SUBMIT (fix the paste-not-promoted stall)

Repo: /home/agjrom/TGBOTS/AGJAssist. Build = `npx tsc` + `npm run build`. Tests = `npx vitest run`.

Problem (observed live): overmind sends a message to a coordinator pane via `tmuxService.sendCommand(target, text, true, true)` (send-keys -l <text> + C-m). On Claude-Code / codex TUIs, a longer message is treated as a PASTE and the single Enter does NOT submit it — the text sits in the composer (`❯ <text>`) until a human presses Enter again. Result: overmind's nudges/demands silently stall in the composer and the coordinator never sees them. (This is the quirk documented in ~/.claude/agents/lead.md Rule 18 / CALLBACK_PROTOCOL: "press Enter ONE MORE TIME to promote paste → submit.")

Fix: add a robust submit path that verifies submission and re-presses Enter, and route overmind's coordinator-directed sends through it.

Read first: src/tmux/tmux-service.ts (sendCommand, capturePane, ensureValidTarget, send-keys usage), and src/services/overmind-watcher.ts (every place it sends to coordinator_session: the nudge ladder CANNED_NUDGE, applyCompleteness request, reconcile() demand, handleAllTasksDone completion consult) + src/api/routes/overmind-routes.ts (the /complete child-close reminder).

Acceptance criteria:
1. Add `async sendAndSubmit(target: string, text: string): Promise<boolean>` to TmuxService:
   - Send the text literally (`send-keys -l -t <target> -- <text>`), then Enter (`send-keys -t <target> C-m`) — as SEPARATE execFile calls (never chained).
   - Then verify-and-retry, up to 3 total Enter attempts: small sleep (~400-600ms), capturePane; check if the message is still UN-submitted in the composer — heuristic: the composer line (the last line starting with `❯` or `›`) still contains a distinctive chunk (first ~40 non-space chars) of `text`, OR the pane shows a paste indicator (`[Pasted Content`, `tab to queue`, `tab to queue message`). If un-submitted → send another `C-m` and loop; if the composer no longer holds the text → return true (submitted).
   - Cap at 3 Enter presses; if still un-submitted, return false (do NOT spam further). Best-effort: wrap in try/catch, never throw.
   - Validate target like sendCommand does.
2. Route overmind's coordinator sends through `sendAndSubmit` instead of `sendCommand`:
   - overmind-watcher.ts: the nudge ladder send (CANNED_NUDGE), the completeness request (applyCompleteness), the reconcile() demand, and the completion consult in handleAllTasksDone. Preserve the existing post-send pane-hash capture (re-capture after sendAndSubmit so the nudge-ladder anti-reloop hash is still set from the post-send pane).
   - overmind-routes.ts: the /complete child-close reminder → use tmuxService.sendAndSubmit.
   - Leave other callers (TG /tmux_send, the OVM chat relay) on their existing paths — out of scope.
3. Tests:
   - Unit test for sendAndSubmit (mock execFile + capturePane via the service's internals or inject): first capturePane returns the text still in the composer → it presses Enter again → second capturePane shows empty composer → returns true; and a case where it never clears → returns false after 3 attempts (no infinite loop).
   - Update the overmind nudge / reconcile / routes test mocks: they currently mock `sendCommand`; add a `sendAndSubmit` mock to the tmux mocks so those tests still exercise the send path. Keep assertions meaningful (the coordinator still receives the message). All existing tests stay green.
4. `npx tsc` + `npm run build` clean; `npx vitest run` fully green.

Scope/DON'T: tmux-service.ts (+sendAndSubmit) + overmind-watcher.ts + overmind-routes.ts + the affected tests. Do NOT change the OVM chat relay or TG /tmux_send. Do NOT add a DB migration. Keep the messages single-line as they already are.

Artifacts: changes.md to plan/overmind/changes-reliable-submit.md (problem + the verify/re-Enter algorithm + which call sites switched + how it's capped at 3 + tests). Commit `[overmind] reliable coordinator-message submit: verify + re-Enter to promote paste (fixes nudges/demands stalling in composer)`. End with STATUS marker.
