# Batch O3 Independent Validation

Requirement checked:
OU3 requires a fourth `OVM` tab with Open / Restart / Close controls, an open/closed status dot, a live view of the tmux `OVM` session, and websocket input forwarding through the existing tmux stream.

Validation:
- The Overmind tab bar now includes `OVM`.
- Selecting `OVM` renders `OvmConsole` instead of a workflow list.
- `OvmConsole` calls the O2 endpoints through the existing `api()` helper:
  - `GET /api/overmind/ovm/status`
  - `POST /api/overmind/ovm/open`
  - `POST /api/overmind/ovm/restart`
  - `POST /api/overmind/ovm/close`
- The live view uses `buildTmuxWsUrl(OVM:0.0, authToken)` and connects to `/ws/tmux/:target` with the existing websocket message contract.
- The composer sends `{ type: "input", data: "<message>\\r" }` on the existing websocket.
- Closed state shows an `Open OVM` prompt instead of the stream.
- Required gates passed: syntax check, targeted helper test, TypeScript, and build.

Residual risk:
- Live tmux rendering and real OVM message round-trip need projcore/browser validation against a running authenticated app session.
