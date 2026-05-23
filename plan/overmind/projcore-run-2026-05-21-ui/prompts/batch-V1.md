Batch-V1: Workflow cards — collapsible/auto-collapsed + status color scheme

Batch ID: V1
Requirements: plan/overmind/projcore-run-2026-05-21-ui/og-requirements-ui.md (RU1, RU2)
North-star: plan/overmind/projcore-run-2026-05-21-ui/north-star-ui.md (UI-NS-1 colors, UI-NS-6 collapsed)
Branch: feat/overmind (CONTINUE — do not branch)

Estimated: SHORT (<30min).

Context:
The overmind dashboard (#/overmind) exists (src/web/public/app.js OvermindWorkflows component + overmind-helpers.js + style.css). Right now each workflow card shows ALL fields expanded (name, status, current_task, Tier, Stuck, Coordinator, Children, Tasks). This batch: auto-collapse cards and add the status color scheme.

Requirements (verbatim):
RU1: "Each workflow card defaults to COLLAPSED. Collapsed shows ONLY: name, status badge, and a sub-status line = current_task. All other data (tier, stuck, coordinator/child sessions, tasklist) hidden until expand (click/tap toggle). Remember expand state per card during the session."
RU2: "Status badge + a card accent use: yellow=working; green=waiting for me (waiting_human + awaiting_decision); red=stuck + failed; grey=completed + paused; active→neutral. Pure helper statusColor in overmind-helpers.js applied to badge + card."

Observed:
- src/web/public/app.js: OvermindWorkflows() component (~line 450) renders the cards. Uses imports from ./overmind-helpers.js (statusIcon, countDoneTasks, formatStuckDuration, taskGlyph, buildOvermindWsUrl).
- src/web/public/overmind-helpers.js: has OVERMIND_STATUS_ICONS, statusIcon(), etc. ADD statusColor() here.
- src/web/public/style.css: card styles.
- Status values: active|working|waiting_human|awaiting_decision|stuck|paused|completed|failed.

Expected (acceptance):
1. `statusColor(status)` pure helper in overmind-helpers.js returning a color token/class: working→yellow, waiting_human|awaiting_decision→green, stuck|failed→red, completed|paused→grey, active→neutral. Export it. (Return a stable class name like 'ovm-yellow' or a hex — your call; use CSS classes for theming.)
2. Each workflow card is COLLAPSED by default. Collapsed = name + status badge (colored per statusColor) + sub-status line (current_task, or '—'). A clear affordance (chevron ▸/▾ or tap the header) toggles expand. Expanded reveals the existing detail (tier, stuck, coordinator, children, tasklist).
3. Expand/collapse state tracked per-card in component state (useState) for the session (no persistence needed). Default collapsed.
4. Status badge AND a card accent (e.g. left border or badge bg) use the statusColor. Density-light, consistent with style.css.
5. `npx tsc` clean (no TS touched likely, but run it). Frontend: no build step — edit app.js/helpers/css; the helper must stay valid ESM importable by node tests.

Likely files:
- src/web/public/overmind-helpers.js (statusColor + maybe a color map const)
- src/web/public/app.js (OvermindWorkflows: collapse state + collapsed/expanded render + apply colors)
- src/web/public/style.css (color classes + collapsed/expanded styles)
- tests/overmind-helpers... extend tests/overmind-stream.test.ts OR a helper test for statusColor (node-importable .js)

Scope:
- Collapsible + colors ONLY. Do NOT change tabs (V3), active-session (V2), nav (V4), backend. UI only.
- Surgical, match Preact/HTM + style.css conventions.

Tests (targeted):
- Add/extend a node test asserting statusColor maps each status correctly (working→yellow class, waiting_human/awaiting_decision→green, stuck/failed→red, completed/paused→grey). Run that test + `npx tsc`.

Plan handshake (MANDATORY): read brief + og-requirements-ui + north-star-ui + app.js (OvermindWorkflows) + overmind-helpers.js + style.css. Reply STATUS: PROPOSED with the statusColor design (class names), the collapse toggle approach, and what the collapsed vs expanded layouts look like. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate (tsc + targeted test + `npm run build` so the static deploy is current). Artifacts batch-V1/changes.md + test-report.md + independent-validation.md.

Completion: append callback FIRST to plan/overmind/projcore-run-2026-05-21-ui/callbacks.md: `[projcore callback] V1 <STATE> <note>`, THEN reply ending STATUS: <verb> -- reason.
