E4 red-team pass: standard-fail

Lens 1 - Focused command:
The required Playwright command passed under the timeout wrapper. This is not sufficient for PASS because the spec bypasses the WakeupSheet controls.

Lens 2 - Single-agent scope:
Failed. A public UI probe opened ACTIVE:0, while /api/agent-wakeups/pending returned wakeups for ACTIVE:0 and OTHER:0. The sheet rendered both rows and the collapsed summary counted both as "2 wakeups", so the indicator is global rather than scoped to the active agent window.

Lens 3 - Manual schedule/cancel UI path:
Partial. The app.js implementation has date/time/action inputs, posts pane_target ACTIVE:0 through the Save button, and removes a row after Cancel. The committed e2e spec does not prove that path because it calls fetch() directly instead of filling/clicking the component controls.

Lens 4 - Fire clearing:
The implementation now has a menu-open 30s interval that filters elapsed rows and refetches pending wakeups. That addresses the previous no-refresh gap well enough for this UI slice, subject to the active-pane scoping fix above.

Evidence:
- Focused command: validation/E4-playwright-a2.log
- UI probe DOM and screenshot: validation/E4-dom-aria-a2.json, validation/E4-ui-a2.png
- Prescription: validation/E4-fix-a2.md
