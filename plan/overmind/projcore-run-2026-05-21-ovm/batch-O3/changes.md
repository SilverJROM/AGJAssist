# Batch O3 Changes

User report:
Add a fourth `OVM` tab beside `Active / Completed / History` that renders a live chat/terminal view of the tmux `OVM` session using the existing `/ws/tmux/:target` stream and O2 OVM session endpoints. UI only.

Root cause / gap:
O2 exposed the OVM session lifecycle endpoints, and the app already had reusable tmux pane streaming, but the Overmind dashboard had no UI entry point for the OVM operator session.

Files changed:
- `src/web/public/app.js`: added the `OVM` tab and `OvmConsole` component with Open / Restart / Close actions, status dot, `/api/overmind/ovm/*` wiring, `/ws/tmux/OVM:0.0` live stream consumption, and websocket input forwarding.
- `src/web/public/overmind-helpers.js`: added `buildTmuxWsUrl()` to centralize the tmux websocket URL construction used by the OVM console.
- `src/web/public/style.css`: added responsive OVM console, prompt, transcript, composer, and status-dot styling.
- `tests/overmind-stream.test.ts`: added pure helper coverage for `buildTmuxWsUrl()`.

Autonomous decisions:
- Used `OVM:0.0` as the pane target per the batch brief and existing tmux target validation.
- Kept live browser/WS manual validation out of the artifact because the batch brief assigns DOM/WS live behavior verification to projcore manually.
