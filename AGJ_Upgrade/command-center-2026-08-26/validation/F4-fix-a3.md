# F4 prescription — validator attempt=3, marker DRV-F4-21, commit bb82a579400cc546ab44f26f24f78278197bdfa0
Read this WITH validation/F4-redteam-v3.md — every number below is a measurement in it.

## THE HEADLINE
`npx playwright test e2e/command-center-header.spec.ts --project=cc` **EXITS 1** on this commit
(run twice, deterministic — validation/F4-focused-v3.log). It times out at spec line 68 because
`[data-testid="terminal-session-name"]` is HIDDEN: the agent name and status line have zero width in
the real UI. That is a user-visible regression this commit introduced, not a test artefact.

## ALREADY DONE — DO NOT REDO
- a1 f7/f8 dependency-array freshness fixes: still good (summariesFreshness {1,2,true}).
- a2 finding 3 (bell pending-hint): LANDED. `.cc-util-icon-dot` + `.cc-util-icon-count` render inside
  the bell, gated by `has-reminder` / `has-wakeup`; the count badge shows the literal fixture value 1.
- a2 finding 6 (controls positive twins): LANDED — visible-before assertions plus an expand-again check.
- a2 finding 7 (request counting): LANDED — `page.on('request', ...)` with counts for
  `/api/summary-agents/.*/summaries` and `/api/agent-reminders/active`, gear click asserted via
  `aria-expanded`. Right mechanism, keep it.
- The `...` / `‹` handle LABEL is correct. Keep it.

FINDING 1 of 6
WHAT FAILED: `.command-center-header` lost `display:flex` and the session name collapsed to zero
width. The commit deleted the WHOLE rule
`.command-center-header { display:flex; align-items:center; gap:4px; min-width:0; flex:1 0 100%; white-space:nowrap; }`
plus `.terminal-topbar-main:has(.command-center-header){flex-wrap:wrap}`, with no replacement, so the
element is now a bare block div. Measured on bb82a57 (validation/F4-dom-aria-v3.json, step
"detail-default"): `.terminal-topbar-target` {w:0, h:34} and `[data-testid="terminal-session-name"]`
{w:0, h:18} — invisible, which is the exact spec timeout; `.command-center-header` {w:112, h:124,
display:block} with its children stacked into 4 internal bands; topbar height 137 (a2 was 131 — worse).
See validation/F4-header-v3.png: the topbar shows no session name at all.
THE FIX: Put the rule back MINUS the row-forcing declaration. Add to src/web/public/style.css:
`.command-center-header { display:flex; align-items:center; gap:4px; min-width:0; flex:0 1 auto; white-space:nowrap; }`
— i.e. everything the deleted rule had except `flex:1 0 100%`, which is replaced by `flex:0 1 auto`
so the header shares row 1 instead of claiming a full row. Do NOT re-add
`.terminal-topbar-main:has(.command-center-header){flex-wrap:wrap}`. Then re-check that
`.terminal-topbar-target` keeps non-zero width: the existing
`@media (max-width:420px){ .terminal-topbar-target:has(+ .command-center-header){flex:0 1 86px} }`
gives it a basis, and `min-width:0` on the header must not let it eat the target's 86px.
WHY THE LAST ATTEMPT MISSED IT: The prescription said remove the `flex:1 0 100%` declaration; the
attempt removed the entire rule, taking `display:flex` with it.

FINDING 2 of 6
WHAT FAILED: The row split exists only as CSS. `.cc-utilarea` and
`.terminal-shell-header.util-collapsed .cc-utilarea` were added to style.css, and NOTHING in
src/web/public/app.js carries either class — measured grep counts: `cc-utilarea` css=2 app.js=0,
`util-collapsed` css=2 app.js=0. The chips are still rendered INSIDE `.command-center-header`, which
is why H2's one-row clause still fails: step "fully-collapsed" measures topbar height 69 (target 46)
with the header's own leaves in 2 bands — [tabs-collapse, controls-collapse] at top=12 and the bell
block at top=39, i.e. the bell is still on the second row
(validation/F4-header-v3-fully-collapsed.png).
THE FIX: Move the chips out of the header in the MARKUP, in src/web/public/app.js around line 3040.
Row 1 (`.terminal-topbar-main`) keeps [back][.terminal-topbar-target][tabs area][bell][control
cluster] as flex siblings; the reminder/wakeup/summary chips move into a NEW sibling element
rendered AFTER `.terminal-topbar-main` and INSIDE `.terminal-shell-header`:
`<div class="cc-utilarea" data-testid="utilities">…three chips…</div>`, and add `util-collapsed` to
the `terminal-shell-header` className when `utilitiesCollapsed` is true so the existing
`.terminal-shell-header.util-collapsed .cc-utilarea{display:none}` rule fires. The bell
(`data-testid="bell-indicator"`) must be a direct child of row 1, NOT inside the chips element, so
it survives when the chip row is hidden. Keep `data-testid="utilities-collapse"` on the toggle that
lives in row 1 next to the bell.
WHY THE LAST ATTEMPT MISSED IT: It ported the stylesheet half of the mockup and none of the markup half.

FINDING 3 of 6
WHAT FAILED: The controls cluster is also CSS-only. `cc-ctrlcluster` css=4 app.js=0,
`cc-ctrl-items` css=2 app.js=0. app.js still unmounts the controls with
`${!controlsTucked ? html\`…\` : ''}`, so gear/summaries/font/ME are removed from the DOM when
tucked rather than hidden by `.cc-ctrlcluster.collapsed .cc-ctrl-items{display:none}`. The commit
also appended `.cc-ctrl-toggle[data-testid="controls-collapse"]{display:flex}`, which overrides the
conditional-reveal rule directly above it and makes the handle unconditionally visible.
THE FIX: In src/web/public/app.js, wrap the font pill + ME nav + summaries button + gear in
`<div class=${'cc-ctrlcluster' + (controlsTucked ? ' collapsed' : '')}>` with those four controls
inside `<div class="cc-ctrl-items">…</div>`, and render them UNCONDITIONALLY — delete the
`${!controlsTucked ? … : ''}` ternary so the CSS does the hiding. Move the
`data-testid="controls-collapse"` handle inside that cluster as the `.cc-ctrl-toggle`. Then delete
the `.cc-ctrl-toggle[data-testid="controls-collapse"]{display:flex}` override so the mockup's rule
(`.terminal-shell-header.util-collapsed .cc-ctrl-toggle, .cc-ctrlcluster.collapsed .cc-ctrl-toggle
{display:flex}`) governs when the handle shows.
WHY THE LAST ATTEMPT MISSED IT: Same as finding 2 — stylesheet ported, markup not.

FINDING 4 of 6
WHAT FAILED: The spec's new one-row assertion is UNSATISFIABLE, so it can never go green even after
findings 1-3 land. `expect(geometry.count).toBe(1)` counts distinct `Math.round(rect.top)` bands over
`topbar.querySelectorAll('*')` — every descendant, not the row structure. Measured with the spec's
exact formula (validation/F4-bandcount-v3.mjs -> F4-bandcount-v3.json): specCount=4, specHeight=69,
with band top=24 holding [terminal-topbar-target, terminal-session-name, terminal-topbar-name-text]
and band top=42 holding [terminal-last-updated] — that is the name/sub two-line stack inside the
target block — plus band top=35 from the bell's absolutely-positioned `.cc-util-icon-dot` /
`.cc-util-icon-count`. Both structures are required by the mockup and by H2's own hint clause, so no
correct build reaches 1.
THE FIX: Count bands over the topbar's DIRECT FLEX CHILDREN only, not all descendants. Replace the
`leaves` expression with `[...topbar.querySelector('.terminal-topbar-main').children]` filtered by
`rect.width > 0 && rect.height > 0`, band them by `Math.round(rect.top)` with the same 4px tolerance,
and assert `bands.length === 1`. Keep `expect(geometry.height).toBeLessThanOrEqual(48)` — that
literal is sound (46 is the measured list-view one-row header; today's fully-collapsed value is 69).
WHY THE LAST ATTEMPT MISSED IT: The a2 prescription said "visible leaf descendants of
[data-term-topbar]"; the attempt used every descendant and never ran the assertion against a build
where it could pass.

FINDING 5 of 6
WHAT FAILED: The horizontal overflow bound is now dead code. The `evaluate` returns
`{ top, bottom, height, bands, count }` — there is no `children` key — so
`for (const child of geometry.children ?? [])` never iterates and the `right <= 391` / `left >= -1`
assertions never run. That bound was the one half of the old geometry check that DID discriminate
(a1 mutation M6: `.command-center-toggle` padding 7px -> 90px was CAUGHT; it would not be caught now).
THE FIX: Return the rects from the same evaluate and assert them for real — add
`rects: rows.map(r => ({ left: r.left, right: r.right }))` to the returned object (using the direct
flex children from finding 4) and iterate `geometry.rects`, keeping `expect(r.right)
.toBeLessThanOrEqual(391)` and `expect(r.left).toBeGreaterThanOrEqual(-1)`. Deleting the loop is also
acceptable; leaving it referencing a key that is never returned is not.
WHY THE LAST ATTEMPT MISSED IT: The evaluate's return shape was rewritten and the loop below it was
not updated, and `?? []` silently swallowed the mismatch.

FINDING 6 of 6
WHAT FAILED: Brief-generator defect, one side only. The IMPLEMENTER brief committed here
(AGJ_Upgrade/command-center-2026-08-26/prompts/drv-F4-impl-a3.md) DOES carry the resolved H1/H2 text,
so a2 finding 1 was acted on there. The VALIDATOR brief for this same attempt (drv-F4-val-a3.md)
still says "H1 - NO CRITERION TEXT FOUND" and "H2 - NO CRITERION TEXT FOUND".
THE FIX: Apply the same criterion resolution to the validator-brief generator that was applied to the
implementer-brief generator — resolve H1/H2 from og-requirements.md lines 102-106 into the validator
brief's acceptance-criteria block. Until then a validator that trusts the brief will grade F4 against
the lossy Scope one-liner and miss exactly the clauses that keep failing.
WHY THE LAST ATTEMPT MISSED IT: The fix was applied to the implementer path only.
