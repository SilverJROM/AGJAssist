# Batch 1 Changes

## Batch
- Batch 1: Friendly terminal-chat foundation

## Scope Delivered

1. Added a friendly terminal-chat mode on the terminal route.
2. Added a transcript-style command/result surface backed by the existing tmux send/output APIs.
3. Added an easier bottom composer for terminal command entry.
4. Added full-screen Telegram-focused presentation scaffolding and safe back-path behavior.
5. Added transcript persistence so the user can leave focused mode without losing the shown terminal-chat history immediately.
6. Kept raw terminal mode available as an advanced fallback.
7. Stabilized friendly-mode polling so transcript refresh no longer reinitializes on every snapshot change.
8. Improved transcript readability in Telegram by forcing terminal text contrast and loosening the full-screen/mobile spacing.
9. Changed background transcript updates to buffered 1-second sampling with thresholded UI flushes, so small tmux changes do not blink the screen constantly.
10. Reworked friendly transcript initialization so it prefers the live tmux snapshot and only reuses saved transcript state when it is recent and still matches the current pane.
11. Added a regression test for terminal-chat bootstrap state to guard against stale transcript replay.
12. Disabled raw terminal cursor blink to reduce fallback-mode visual noise.

## Files Changed

- `src/web/public/app.js`
- `src/web/public/style.css`
- `src/web/public/terminal-chat-state.js`
- `tests/unit/terminal-chat-state.spec.ts`
- `plan/test-scenarios/00-scenario-index.md`
- `plan/test-scenarios/00-complete-crud-operations.md`
- `plan/test-scenarios/_staging/terminal-visibility-regression/impact-analysis.md`
- `plan/test-scenarios/_staging/terminal-visibility-regression/terminal-visibility-regression.md`

## Implementation Notes

- Reused the existing terminal route instead of replacing the terminal backend.
- Friendly mode uses the current tmux REST endpoints:
  - send command
  - capture output
  - render command/result exchanges in a more readable transcript
- Full-screen mode is implemented as a focused Telegram overlay/state rather than a separate backend system.

## Verification

- `npm run build` ✅
- `npm test` ✅
  - 12 test files passed
  - 167 tests passed

## Remaining For This Batch

1. UI-level validation against the running app
2. Product-owner review of transcript feel and full-screen behavior
3. Final adjustment if the current transcript grouping is too lossy for some commands
4. Live Telegram Mini App confirmation that the user-reported stale friendly transcript issue is gone
