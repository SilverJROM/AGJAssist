# B5 Scenarios

## Requirement (verbatim from brief)
R6 — Live 'who's working' visibility: while a coordinator has agents running, the section shows each active agent as
role → agent → session → last status/state, updating live.

## North-star anchors
N1, N7

## Expected (acceptance criteria — B5 scope)
1. The rail (desktop) + mobilestrip (mobile) show, per ACTIVE role, the real: role label · agent (provider/model, from the
   binding) · session · last state — derived from agent_events (latest state per role) + the project's launch/session info.
   Replace the B4 placeholder with this derived data.
2. LIVE update: when a new agent_event arrives over the WS, the rail's role state updates (no reload). Idle/working/done
   reflected from the latest event state per role.
3. No regression (R14): chat (B4) still renders; existing sections + overmind unchanged; build + FULL suite green.

## Scope
- ONLY the who's-working derivation + live wiring in the rail/mobilestrip. Reuse the B4 WS subscription + the A1 binding +
  B3 session. Do NOT change A1/A2/A3/A4 services or the chat render. Additive.
- ONE slice; tight.

## Test / proof (per project_specs.md §14 + B4 harness)
- Extend/add a Playwright test (e2e/) that seeds agent_events for ≥2 roles and asserts the rail shows role→agent→session→state
  for each, and that a NEW event updates the displayed state live. Assert the REAL rendered DOM (NOT source grep, NOT mockup).
- Keep FULL `npx vitest run` green. ACCEPTANCE = the playwright test passes on a CLEAN checkout (git stash -u → run → 3+ passed);
  the coordinator WILL verify on the committed/stashed state, so no reliance on uncommitted edits.
- Assert OUTCOMES (real derived data + live update), not that code exists.

## Scenarios (executed via e2e/agent-os-chat-b4.spec.ts + b4smoke + static-server)
- B5-rail-derived (desktop + mobile): b4smoke seeds events (projcore/grok-build/codex5.5) + bindings (real agent shapes); assert .rail and .mobilestrip .agent[data-role] entries contain exact role · agent.name (provider/model) · session (agj-os-TEST) · state (PROPOSED/DONE etc) via real locator .toContainText / .toBeVisible on navigated DOM.
- B5-live-update: after initial render, page.evaluate __injectAgentEvent (drives setEvents same as WS path) for a role; assert that role's .st text visibly mutates in rail (PROPOSED → WORKING) while transcript structure remains (real outcome, no reload).
- R14 hold: original B4 transcript bubbles/chips/composer, send-guard, responsive (rail visible @980 / strip @390) tests continue to pass unchanged.

## Commands for proof
- npx tsc
- npx vitest run
- npx playwright test e2e/agent-os-chat-b4.spec.ts
- (mandatory gate) git stash -u && npx playwright test e2e/agent-os-chat-b4.spec.ts && npx vitest run && git stash pop

## Artifacts
See batch-B5/: changes.md, test-report.md, screenshots/, independent-validation.md
