# Batch B15 Changes

## Summary

- Added `formatTerminalOutput(raw)` in `src/web/public/terminal-chat-state.js` as a pure display-time formatter for raw tmux pane captures.
- The formatter strips ANSI/control noise through the existing cleanup path, trims trailing whitespace, collapses repeated blank lines, and conservatively rejoins likely hard-wrapped prose lines.
- Structured output is guarded from reflow: bullets, code indentation, prompts, stack traces, object-like lines, tables, and box-drawing/TUI lines remain line-oriented.
- Updated the Current output card in `src/web/public/app.js` to render `formatFriendlyTerminalOutput(formatTerminalOutput(snapshot), lineLimit)`, keeping raw normalized snapshots unchanged for command diffing.
- Added focused Vitest coverage in `tests/terminal-chat-state.test.ts`.

## Files

- `src/web/public/terminal-chat-state.js`
- `src/web/public/app.js`
- `tests/terminal-chat-state.test.ts`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b15/screenshots/terminal-output-formatting.png`

## Notes

- The live xterm.js terminal view is untouched.
- Formatting is applied only immediately before display in the friendly Current output view.
