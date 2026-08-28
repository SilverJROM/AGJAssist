# Decision — F4 PLAN_SOUND + C0 security review (2026-08-28)

logged by `[north]`. The drain parked (D7, E5, F4) at a terminal needing two north items; both cleared, then resumed.

## (1) F4 (one-row-collapse header) — RAISE-F4-c1 PLAN REVIEW → PLAN_SOUND
Failed H1,H2 (IMPL_INCOMPLETE) across glimmer a1–a3 + terra a4. **Not** criterion drift — the ACs are
satisfiable. The a3 fix brief diagnoses 5 concrete, fixable issues: (F2) app.js htm/preact render throws
`i.push is not a function` — the header template branch isn't a valid array; (F4) fully-collapsed util must be
**bell-only** (currently renders both the hide-button and the bell); (F5) the header-v2 chrome was never ported
to `style.css` (selectors exist, no CSS); (F1,F3) two test bugs (row locator clicks the parent container;
DOM-count vs visibility assertion). **Ruling:** PLAN_SOUND → RETRY_WITH_DIRECTION with the a3 brief at a strong
tier (sol/opus5) + more budget; **split F4 (render/htm vs collapse-states/CSS) if it fails again.**

## (2) C0 security review — APPROVED, with a RELEASE REQUIREMENT
C0's `src/api/server.ts` change is a 1-line refinement to the `FENCE_STUB` preHandler (guarded by
`stub === "C3"`, inert without the fence-stub env) — harness-only, no production behavior change, low risk.
**APPROVED.**

**But it exposed a real safety item:** the `FENCE_STUB` preHandler (test scaffolding) is embedded in the
**production `createApiServer`**. **RELEASE GATE (imposed on G1/G2):** the shipped build must carry **no active
fence-stub path** — the scaffolding is removed or hard-gated, and the final regression proves none is reachable
in the production build. **Test scaffolding must not ship to the live app.** To carry into the completion
summary + verify at the release step.
