# batch-B5 test-report (R6 UI proof)

## Render path used
- Full real app.js via Playwright + static harness (e2e/static-server.mjs + playwright.config.ts, reuseExistingServer:false)
- `?b5hint=1#/overmind-projects` + addInitScript token+user (same pattern as e2e/agent-os-chat-b4.spec.ts)
- Modals opened exclusively via REAL clicks on rendered elements:
  - Create: `button:has-text("+ New Project")`.click() → exercises openCreate + showCreate conditional
  - Edit: `.overmind-project-summary-row`.click() (expand) + `.overmind-project-menu-button`.click() + `.context-menu-item:has-text("Edit")`.click() → exercises toggle + handleProjectMenuEdit + openEdit + editingProject conditional
- Smoke seed (in app.js b5hint block) only to populate list for edit clicks; no hand-written HTML, no setContent, no direct state mutation from test.
- Helper text node asserted present in the actually-rendered DOM for BOTH forms.

## Assertions executed
- `await expect(editModal.getByText(/Base name \(e\.g\. agj\) — auto-resolves to the live session/i)).toBeVisible()`
- `await expect(createModal.getByText(/auto-resolves to the live session/i)).toBeVisible()`
- `await expect(createModal.locator('input[placeholder="agj"]')).toBeVisible()`
- Modal visibility after real user actions.

## Gates
- `npx tsc --noEmit` → clean (0 errors)
- `npx playwright test e2e/parent-hint-b5.spec.ts` → **1 passed** (chromium, 1.8s)

## Screenshot
- `plan/parent-autodetect/projcore-run-2026-06-21/batch-B5/screenshots/parent-hint.png` (PNG 560x490, 24KB) — captured from create modal locator after real render + hint visible.

## Notes
- Path: modal (preferred); escape valve not needed.
- Acceptance met: helper states the base-name behavior in rendered form.
- No other files touched.
