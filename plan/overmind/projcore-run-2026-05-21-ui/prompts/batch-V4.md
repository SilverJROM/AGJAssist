Batch-V4: Home Workflows quick-view card (RU5) + Customizable bottom nav (RU6)

Batch ID: V4
Requirements: og-requirements-ui.md (RU5, RU6), north-star-ui.md (UI-NS-4, UI-NS-5)
Branch: feat/overmind (CONTINUE)

Estimated: SHORT* — if your PROPOSED shows this is >30min/sprawling, SPLIT into V4a (RU5 home card) + V4b (RU6 customizable nav). RU6 is the bigger piece; a split is likely right.

Context:
The AGJ mini-app (src/web/public/app.js, Preact/HTM no-build) has a home/dashboard screen with section cards and a BOTTOM NAV BAR (Home, Tasks, Notes, Terminal, Chat, Settings — see the app shell). The #/overmind Workflows dashboard already exists.

Requirements (verbatim):
RU5: "Add a card/button on the home screen ('Workflows'/Overmind) that navigates to #/overmind. Show a tiny live summary if cheap (e.g. '3 workflows · 1 active')."
RU6: "Make the bottom nav bar (Home, Tasks, Notes, Terminal, Chat, Settings — and a new Workflows tab) user-customizable: an edit mode lets the user REORDER tabs (up/down move buttons — NOT drag), DELETE/hide tabs, and ADD tabs from the available set (incl. Workflows). Persist the chosen tab set + order PER-DEVICE (localStorage) with a sensible default when unset. Edit mode reachable from home or settings."
UI-NS-5: the "quick access" to manage = the BOTTOM NAV BAR tabs (per JROM's screenshot), not the home cards. Reorder via MOVE BUTTONS (not drag).

Expected (acceptance):
RU5: a "Workflows" card/button on the home screen opens #/overmind; optional tiny summary (workflow count · active count) from GET /api/overmind/workflows.
RU6:
1. The bottom nav becomes CONFIG-DRIVEN: a default ordered list of tabs (id, label, icon, route) incl. a Workflows tab → #/overmind. Available/known tabs defined once.
2. A per-device config in localStorage: which tabs are shown + their order. When unset → default (current tabs). Read on load, applied to render the nav.
3. An EDIT MODE (reachable from home or settings — e.g. a pencil/edit affordance): shows the current tabs as a list with ↑/↓ MOVE buttons (reorder), a × / toggle to remove/hide a tab, and an "+ Add" picker listing tabs not currently shown (incl. Workflows). Changes persist to localStorage immediately (or on Save). Leaving edit mode returns to normal nav reflecting the new config.
4. Sensible guards: don't allow removing ALL tabs (keep ≥1, e.g. Home always available or a reset). A "reset to default" option is nice-to-have.
5. npx tsc clean.

Likely files:
- src/web/public/app.js (home Workflows card; nav config + render from config; edit-mode UI)
- src/web/public/overmind-helpers.js OR a small new helper module (pure nav-config logic: default list, apply-config, move/add/remove — node-testable)
- src/web/public/style.css (edit-mode + card styles)
- tests: pure nav-config helper tests (reorder, remove, add, persistence shape, default-when-unset)

Scope:
- RU5 + RU6 ONLY. Don't touch the workflow cards (V1/V2/V3 done) or backend or audit (V6). Frontend.
- localStorage persistence (per-device) — NO backend/schema for the nav config.
- Move buttons, NOT drag. Surgical.

Tests (targeted, node):
- Pure nav-config helpers: default list when localStorage empty; moveUp/moveDown reorders; remove hides; add appends from available; serialize/deserialize round-trip. Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + og/north-star + app.js (the app shell / bottom nav render + home screen) + overmind-helpers.js. Reply STATUS: PROPOSED with: whether you'll SPLIT (recommend V4a/V4b), the nav-config data shape + localStorage key, the edit-mode UX (move/remove/add), the home card, and the test plan. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate (test + tsc + npm run build). Artifacts batch-V4*/changes.md + test-report.md + independent-validation.md.

Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ui/callbacks.md `[projcore callback] V4 <STATE> <note>` (or V4a/V4b if split), THEN STATUS: <verb> -- reason.
