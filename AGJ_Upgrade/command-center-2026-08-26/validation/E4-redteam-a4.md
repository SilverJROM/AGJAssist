E4 red-team pass: standard-clean

Lens 1 - Focused command:
Passed. `npx playwright test e2e/command-center-wakeup.spec.ts --project=cc` completed green under the required timeout wrapper.

Lens 2 - Test discrimination:
Passed. The committed Playwright test now uses two literal pane targets and two literal pending wakeups, clicks the active terminal row, opens the active chat menu, asserts the WakeupSheet controls, verifies only the active pane's wakeup appears, drives the date/time/action inputs and Save button, and drives the Cancel button.

Lens 3 - Active-agent scope:
Passed. Static inspection and the independent UI probe show display rows and collapsed summary derive from wakeups filtered by `w.pane_target === activeTarget`; the other pane's wakeup is not rendered or counted in the active pane sheet.

Lens 4 - Pending indicator and clear behavior:
Passed. The collapsed summary names pending time and remains visible while details collapse. Cancel removes the cancelled row while leaving the newly saved active wakeup. The fire-clear probe shows a near-due wakeup is removed after the menu-open refresh tick and the sheet returns to "No pending wakeups".

Evidence:
- Focused command: validation/E4-playwright-a4.log
- UI path DOM/screenshot: validation/E4-dom-aria-a4.json, validation/E4-ui-a4.png
- Fire-clear DOM/screenshot: validation/E4-fire-clear-a4.json, validation/E4-fire-clear-a4.png
