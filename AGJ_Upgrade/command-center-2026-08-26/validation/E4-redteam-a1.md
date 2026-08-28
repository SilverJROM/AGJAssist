E4 red-team pass: standard-fail

Lens 1 - Scope coverage:
D1 mostly passes through the UI probe: manual date/time/action inputs post to /api/agent-wakeups with pane_target "VAL:0" and the literal action. Cancel removes the selected pending row after DELETE /api/agent-wakeups/42.

Lens 2 - D2 collapsed/fired behavior:
Failed. The captured collapsed sheet text is "WAKEUP / Pending wakeups / Expand / SCHEDULE WAKEUP ..." with no pending count, action, or pending time. Static inspection finds wakeup state is loaded only when menuOpen becomes true; no wakeup-specific timer, timeout, SSE, or poll updates/removes rows when manual_fire_time passes.

Lens 3 - Test discrimination:
Failed. The focused Playwright spec passed, but it only asserts title/body visibility and catches missing menu/session interactions. It would pass if the wakeup-sheet block were deleted from app.js.

Evidence:
- Focused command passed: validation/E4-playwright-a1.log
- UI probe public-path DOM/screenshot: validation/E4-dom-aria-a1.json, validation/E4-ui-a1.png
- Prescription: validation/E4-fix-a1.md
