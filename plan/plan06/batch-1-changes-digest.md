# Batch 1 Changes Digest

- Friendly terminal-chat mode added to the terminal route.
- User can type commands in a bottom composer and receive transcript-style results.
- Raw mode remains available.
- Focused full-screen Telegram terminal presentation was added with back-path behavior.
- Transcript state is persisted so leaving focused mode does not immediately discard visible history.
- Friendly-mode polling was stabilized to prevent repeated transcript reinitialization and visible blinking.
- Transcript text contrast and focused-mode spacing were improved for Telegram.
- Background output now samples every second but only flushes to the transcript when the buffered chunk is large enough or has waited long enough.
- Friendly-mode initialization now trusts the live tmux pane first and only reuses recent saved transcript state when it still matches the pane.
- Added a regression test and staged `testkeeper` scenario coverage for terminal visibility.
- Files changed: `src/web/public/app.js`, `src/web/public/style.css`, `src/web/public/terminal-chat-state.js`, `tests/unit/terminal-chat-state.spec.ts`, `plan/test-scenarios/...`
- Verification: `npm run build` passed, `npm test` passed (167/167).
