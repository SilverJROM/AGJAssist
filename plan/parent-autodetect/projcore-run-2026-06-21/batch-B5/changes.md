# batch-B5 changes (R6)

- src/web/public/app.js
  - Create OVM Project form: placeholder on Parent Session changed "AGJ-51" → "agj"
  - Both Create and Edit forms: added helper hint immediately after the parent_session `<input>` inside `.form-group`:
    `<small class="form-hint" style="display:block;margin-top:4px;font-size:11px;color:var(--text-secondary)">Base name (e.g. agj) — auto-resolves to the live session even when the suffix changes (agj-51 → agj-4). Full names also work.</small>`
  - Added minimal b5hint smoke useEffect (UI-PROOF only) to seed a demo project row so that the Edit path can be reached via real DOM clicks (summary row → menu → Edit) without backend. Mirrors b4smoke pattern already in file.

- e2e/parent-hint-b5.spec.ts (new)
  - Playwright spec using exact existing static harness (e2e/static-server.mjs + playwright.config.ts)
  - beforeEach: real localStorage token+user (auth bypass for App render)
  - goto with ?b5hint=1#/overmind-projects
  - REAL clicks: "+ New Project" button for create modal; card summary + menu button + "Edit" menu-item for edit modal
  - Asserts: helper text visible via getByText(/auto-resolves to the live session/i) in BOTH modals; placeholder="agj" on create; modals via real conditional render paths
  - Screenshot of rendered create modal saved via locator.screenshot()

All per brief: only these files edited; no backend logic; real rendered-DOM proof (not setContent, not grep).
