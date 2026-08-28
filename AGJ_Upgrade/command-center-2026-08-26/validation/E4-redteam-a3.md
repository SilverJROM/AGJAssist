E4 red-team pass: standard-fail

Lens 1 - Focused command:
Failed. `npx playwright test e2e/command-center-wakeup.spec.ts --project=cc` timed out waiting for `[data-testid="terminal-menu"]`.

Lens 2 - Navigation mechanism:
Failed. The attempt added `setActiveTarget(next[0].panes[0].target)` inside `loadSessions()`, but TerminalTab remains in list view because `viewMode` is not set to `chat`. The UI probe captured `hasTerminalMenu: false`, `hasSectionNav: true`, and a present session row for `pane-1`.

Lens 3 - WakeupSheet assertions:
Blocked by the navigation failure in the focused spec. Static inspection shows the activeTarget display filter is now present, but the committed test cannot reach the sheet until it uses the existing row-click/switchActiveTarget path or the auto-select path sets both state values.

Evidence:
- Focused command: validation/E4-playwright-a3.log
- UI failure state: validation/E4-dom-aria-a3.json, validation/E4-ui-a3.png
- Prescription: validation/E4-fix-a3.md
