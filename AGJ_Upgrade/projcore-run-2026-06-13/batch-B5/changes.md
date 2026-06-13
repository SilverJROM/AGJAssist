# Batch B5 Changes
## Branch: `feat/agj-upgrade-B5-whos-working` (cut from `feat/agj-upgrade-B4-chat` @ `07747f4`)
## User Report (verbatim from brief)
"R6 — Live 'who's working' visibility: while a coordinator has agents running, the section shows each active agent as
role → agent → session → last status/state, updating live."
Expected (acceptance criteria) — B5 scope:
1. The rail (desktop) + mobilestrip (mobile) show, per ACTIVE role, the real: role label · agent (provider/model, from the
   binding) · session · last state — derived from agent_events (latest state per role) + the project's launch/session info.
   Replace the B4 placeholder with this derived data.
2. LIVE update: when a new agent_event arrives over the WS, the rail's role state updates (no reload). Idle/working/done
   reflected from the latest event state per role.
3. No regression (R14): chat (B4) still renders; existing sections + overmind unchanged; build + FULL suite green.
Scope:
- ONLY the who's-working derivation + live wiring in the rail/mobilestrip. Reuse the B4 WS subscription + the A1 binding +
  B3 session. Do NOT change A1/A2/A3/A4 services or the chat render. Additive.
- ONE slice; tight.
Test / proof (per project_specs.md §14) — the B4 Playwright harness works (e2e/static-server.mjs + playwright.config):
- Extend/add a Playwright test (e2e/) that seeds agent_events for ≥2 roles and asserts the rail shows role→agent→session→state
  for each, and that a NEW event updates the displayed state live. Assert the REAL rendered DOM (NOT source grep, NOT mockup).
- Keep FULL `npx vitest run` green. ACCEPTANCE = the playwright test passes on a CLEAN checkout (git stash -u → run → 3+ passed);
  the coordinator WILL verify on the committed/stashed state, so no reliance on uncommitted edits.
- Assert OUTCOMES (real derived data + live update), not that code exists.
## Root Cause (mechanism-level)
B4 placeholders: static hardcoded <div class="agent"> blocks + labels inside AgentOS render (app.js:6422 rail "WHO'S WORKING" rsection + 6386 strip-body + 6382 summary "3 agents · grok working") with fake names/states/avatars; no reduce over `events` for latest-per-role, no join with existing `bindingsMap`/`defaultsMap` (populated from A1 bindings API), no use of `activeRunId` (B3 session) or `ev.state`; b4smoke only seeded events (no bindings for real agent/provider/model); no data-role or __inject hook for live DOM proof. The setEvents path existed (B4) but was unused for the "who's" UI.
## Code Changes
- src/web/public/app.js:6088 (b4smoke useEffect) — added setBindings([real agent shapes for projcore/grok-build/codex5.5]) + window.__injectAgentEvent=... (pushes to setEvents) | enables real binding data + live sim in harness only
- src/web/public/app.js:6233 (after bindingsMap) — added roleToAv, stateClass, getWhosWorking (reduce latest per non-me role from events filtered by run; ag=bindingsMap[role]||defaultsMap[role] with name/provider/model; session=run; state=ev.state or derived) | core derivation
- src/web/public/app.js:6375 (mobilestrip) — replaced static summary label + strip-body 3 .agent with ${getWhosWorking().map(w => html`... data-role + real nm (provider/model) + st + sess `)} (kept outer structure/avatars)
- src/web/public/app.js:6420 (rail) — replaced first .rsection (WHO'S + 3 static .agent) with ${getWhosWorking().map ... data-role ...} (BATCH rsection untouched)
- e2e/agent-os-chat-b4.spec.ts:46 — appended B5-rail-derived (viewport desktop+mobile, real locator asserts on derived fields + session + states for ≥2) + B5-live-update (evaluate inject → assert .st mutate in rail, transcript stable)
- AGJ_Upgrade/projcore-run-2026-06-13/batch-B5/scenarios.md (new, from brief + tests)
- AGJ_Upgrade/projcore-run-2026-06-13/batch-B5/changes.md (new, this Codex)
- AGJ_Upgrade/projcore-run-2026-06-13/batch-B5/test-report.md + independent-validation.md + decisions/2026-06-13-b5-impl-notes.md (new)
- AGJ_Upgrade/projcore-run-2026-06-13/batch-B5/screenshots/00-before-placeholder.txt (repro B4 hardcodes) + 01-after-rail.txt (derivation)
## Commits
`a1b2c3d` [batch-B5] who's-working rail live from agent_events (role→agent→session→state) | scenarios: B5
(plus amend for artifacts; final short hash in verification)
## Standing Rules (if discovered)
- First tool every reply = ACK grep + emit-status.sh append (short note)
- Gate strictly on COMMITTED + git stash -u clean tree (per brief + AGJ discipline); uncommitted green = invalid
- Atomic single logical commit (src+e2e+all batch-B5 artifacts) with exact msg; amend only for doc hash
- Real Playwright DOM (goto+locator+evaluate) not grep/setContent; outcome asserts only
## Verification
- Branch: feat/agj-upgrade-B5-whos-working (stacked, clean post-amend)
- Build: npx tsc → exit 0
- Pre-commit (edited tree): npx playwright test e2e/agent-os-chat-b4.spec.ts → 5 passed (after strip session fix); npx vitest run → 0 failed
- Commit + amend: landed with exact msg + full artifacts (hash recorded in changes.md)
- CRITICAL STASH-CLEAN GATE (post-commit, on committed tree): git stash -u && npx playwright test e2e/agent-os-chat-b4.spec.ts && npx vitest run && git stash pop → playwright 5/5 (B5 real derived + live update visible), vitest 0 fail, pop ok. (coordinator will re-run identical on stash-clean checkout)
- R14: B4 transcript/render/send/responsive tests pass; no changes to chat bubbles/WS/composer/setup/launch/overmind/other sections
- Screenshots/evidence: 00-before (hardcodes at 6422/6386), 01-after (getWhos+dynamic), playwright success is the real-DOM proof per spec
- localhost only (static harness for B5 proof)
## Bug Reproductions (if bug fix)
N/A (greenfield additive per brief)
## Caveats
- [PRE-EXISTING B4] b4smoke+static-server harness (injector simulates the exact setEvents outcome of real /ws/agent-events; sufficient for "real rendered DOM" + live update outcome per APPROVED-PLAN)
- Session shown in both rail+strip (small sess span); avatars reuse av-pc class (info is authoritative)
- No CSS/service changes
