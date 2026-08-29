
## PARKED+RAISED A0 — attempts=3
- why: PLAN REVIEW REQUIRED — the TOP RUNG failed. budget exhausted. THE QUESTION IS NOT "which model next" — it is: **is the acceptance criterion still true of the product?** Re-read the AC text against what the product actually does now. A criterion that has drifted fails IDENTICALLY at every tier, so a retry or an escalation buys more failures at higher cost. Answer the question before offering an action; RETRY_WITH_DIRECTION is NOT the default here. — REPEATED_FAILURE_SAME_REQUIREMENT (GAP_INTERCEPTION|A5): the same criterion failed the same way on consecutive attempts. Before retrying or escalating a tier, check whether the AC is satisfiable as written; a defective one fails identically at every tier.
- gate_failed: ['verdict=FAIL', 'redteam: need standard-clean, got standard-fail']
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED D7 — attempts=0
- why: OPEN refused: nothing failed — the behaviour already exists, or the test asserts nothing
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED E5 — attempts=0
- why: the same seam failed twice running (fingerprint fp1:4c534f69e7dd8f2fd157) — this is a composition defect, not an implementation gap
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F4 — attempts=0
- why: pre-dispatch: TRACKED PRODUCT dirt at slice entry — refusing to dispatch, tree preserved: M e2e/command-center-summaries-fence.spec.ts
- gate_failed: None
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F5 — attempts=4
- why: PLAN REVIEW REQUIRED — the driver itself judged this not implementer-fixable. hard-edge/gate-input (not implementer-fixable). THE QUESTION IS NOT "which model next" — it is: **is the acceptance criterion still true of the product?** Re-read the AC text against what the product actually does now. A criterion that has drifted fails IDENTICALLY at every tier, so a retry or an escalation buys more failures at higher cost. Answer the question before offering an action; RETRY_WITH_DIRECTION is NOT the default here.
- gate_failed: ["commit: PRODUCT dirt at verdict commit (inside this slice's own diff): [' M e2e/command-center-switcher.spec.ts']"]
- note: THE VALIDATOR RECORDED **PASS** — this park is a GATE disagreement, not failed work. Do NOT answer RETRY_WITH_DIRECTION: another implementer attempt re-does work that already succeeded and burns the budget (U29b, lokalAI). The gate objected to: ["commit: PRODUCT dirt at verdict commit (inside this slice's own diff): [' M e2e/command-center-switcher.spec.ts']"]. Resolve THAT — usually a missing/renamed evidence file or a commit the gate could not bind — then re-gate the existing commit rather than rebuilding it.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F7 — attempts=0
- why: F7_journey_asserts_surfaces_no_slice_was_asked_to_build_and_contradicts_its_own_H1_so_no_contributing_unit_owns_the_six_reds__G3_asserts_data-testid_refresh-from-session_visible_but_that_testid_exists_nowhere_under_src_and_og-req_G3_is_localStorage_draft_persistence_owned_by_F1_terminal-chat-state.js_a_client-only_module_with_no_DOM_surface__H3_asserts_document.documentElement_data-theme_truthy_measured_null_but_data-theme_appears_nowhere_in_src_web_public_and_row_F6_asked_only_for_style.css_theme_tokens_delivered_as_prefers-color-scheme_at_style.css_267_while_the_locked_agent-window-v2_mockup_puts_data-theme_on_its_own_cc-phone_harness_node__I2_asserts_terminal-composer-input_keeps_its_value_across_page.reload_which_requires_active-pane_restoration_that_no_plan_row_owns_while_og-req_I2_is_refresh_in-progress_plus_completion_never_blocking_the_composer__G2_J1_J2_assert_agent-group-switcher_and_its_dropdown_visible_although_the_journey_never_clicks_data-testid_tabs-collapse_and_never_waits_for_the_secondary_session_in_api_tmux_sessions_so_app.js_2960_headerGroupSiblings_is_empty_giving_element-not-found_for_G2_and_J1_while_app.js_2291_tabsCollapsed_useState_true_gives_the_measured_J2_div_hidden_class_terminal-header-tabs__H1_mandates_tabs-collapsed_by_default_and_H1_passed_so_H1_green_and_G2_J1_J2_green_are_mutually_exclusive_under_this_harness__F5_own_slice_spec_command-center-switcher.spec.ts_clicks_tabs-collapse_at_line_81_before_asserting_the_strip_and_asserts_it_hidden_when_collapsed_at_line_140_proving_F1_through_F6_are_plan-conformant__the_negative_control_is_unsatisfiable_as_specified_because_FENCE_STUB_is_a_fastify_preHandler_over_api_routes_only_while_contributor_F1_is_client-only_so_A0_dc38330_invented_api_agent-session_refresh_which_exists_only_inside_the_stub_block_in_src_api_server.ts_164_and_backs_the_fictional_G3_surface_meaning_fence-contract.json_expected_negative_fail_ids_G3_and_the_plan_F7_gate_clause_cannot_be_met_by_any_harness_rewrite_alone__replan_to_rebind_G1-J2_to_og-requirements_and_mint_a_D0-style_harness-correctness_row_plus_a_corrected_F7_negative_control_naming_a_server-backed_contributor
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F0b — attempts=4
- why: impl SLICE-TOO-BIG: hard-cap 1800s reached while the seat was STILL WORKING (pane moving). Not hung — the slice does not fit its budget. Split it; do not just retry it.
- gate_failed: None
- note: TILLER ALREADY TRIED TO SELF-HEAL THIS. Seat `x-tlre7cd71a78feb_impl_sonnet5` for F0b was respawned 0x and re-dispatched automatically before this RAISE. unrecognised seat condition 'SLICE-TOO-BIG: hard-cap 1800s reached while the seat was STILL WORKING (pane moving). Not hung — the slice does not fit its budget. Split it; do not just retry it.' — not auto-recovering on a guess A plain RETRY_WITH_DIRECTION will repeat exactly what already failed — fix the underlying condition (env, PATH, quota, or the slice itself) first, or answer STOP_TRUE_BLOCKED.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F0c — attempts=0
- why: seat/dispatch failure: spawn_seat: x-tlre7cd71a78feb_impl_terra launch FAILED — `codex` not on the seat PATH (env broken, e.g. an interrupted self-update). Fix the env, then resume.
- gate_failed: None
- note: a tmux seat could not be created or briefed — usually a stale/dying session reusing a stable seat name, or a CLI that failed to boot. THIS attempt was never dispatched, so no correction is owed for it — but that is NOT the same as nothing being at stake: if EARLIER attempts on this slice committed, the park below rolls their work back too, and an infrastructure event has then ended a slice that was making progress. The commits are saved to refs/tiller/<run>/<slice> first (the park log names the ref and every commit it discards), so recovery is a cherry-pick, not archaeology. RETRY_WITH_DIRECTION is normally right here; if it repeats on the same slice, check `tmux ls` for a wedged seat and the ledger at dispatch/tiller-sessions.ledger before retrying again.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED E5 — attempts=0
- why: the same seam failed twice running (fingerprint fp1:4c534f69e7dd8f2fd157) — this is a composition defect, not an implementation gap
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F0c — attempts=1
- why: impl [projcore callback] implementer F0c STATUS: BLOCKED — focused Playwright gate OOM-killed before startup (host swap exhausted)
- gate_failed: None
- note: TILLER ALREADY TRIED TO SELF-HEAL THIS. Seat `x-tlre7cd71a78feb_impl_terra` for F0c was respawned 0x and re-dispatched automatically before this RAISE. callback received A plain RETRY_WITH_DIRECTION will repeat exactly what already failed — fix the underlying condition (env, PATH, quota, or the slice itself) first, or answer STOP_TRUE_BLOCKED.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED E5 — attempts=0
- why: the same seam failed twice running (fingerprint fp1:4c534f69e7dd8f2fd157) — this is a composition defect, not an implementation gap
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F0c — attempts=1
- why: impl [projcore callback] implementer F0c STATUS: BLOCKED — required F0c changes already committed at HEAD; no in-scope diff to commit
- gate_failed: None
- note: TILLER ALREADY TRIED TO SELF-HEAL THIS. Seat `x-tlre7cd71a78feb_impl_terra` for F0c was respawned 0x and re-dispatched automatically before this RAISE. callback received A plain RETRY_WITH_DIRECTION will repeat exactly what already failed — fix the underlying condition (env, PATH, quota, or the slice itself) first, or answer STOP_TRUE_BLOCKED.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED E5 — attempts=0
- why: the same seam failed twice running (fingerprint fp1:4c534f69e7dd8f2fd157) — this is a composition defect, not an implementation gap
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F0c — attempts=1
- why: impl seat-gone
- gate_failed: None
- note: TILLER ALREADY TRIED TO SELF-HEAL THIS. Seat `x-tlre7cd71a78feb_impl_terra` for F0c was respawned 1x and re-dispatched automatically before this RAISE. the seat vanished; respawning fresh and re-dispatching (attempt 2/2) A plain RETRY_WITH_DIRECTION will repeat exactly what already failed — fix the underlying condition (env, PATH, quota, or the slice itself) first, or answer STOP_TRUE_BLOCKED.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED E5 — attempts=0
- why: integration test changed since OPEN (hash sha256:b57c5b9d6 -> sha256:055661c0c) and is not a clean assertion superset
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED E5 — attempts=0
- why: OPEN refused: nothing failed — the behaviour already exists, or the test asserts nothing
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F7 — attempts=0
- why: the negative control did not turn the journey red — the test passes whether or not the behaviour is wired, so green proves nothing
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F7 — attempts=0
- why: the negative control did not turn the journey red — the test passes whether or not the behaviour is wired, so green proves nothing
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED F7 — attempts=0
- why: the negative control did not turn the journey red — the test passes whether or not the behaviour is wired, so green proves nothing
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED E5 — attempts=0
- why: the negative control did not turn the journey red — the test passes whether or not the behaviour is wired, so green proves nothing
- gate_failed: None
- note: fault_class=plan means the implementer seat ladder is SKIPPED entirely — do not answer RETRY_WITH_DIRECTION into L2/L3. Walking the ladder on a broken plan burns three seats to rediscover the plan is broken. Re-plan the fence, or return a DIRECTION with action=PLAN_SOUND carrying `what_validator_missed`.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED G1 — attempts=1
- why: impl [projcore callback] implementer G1 STATUS: BLOCKED — focused terminal UX run failed: hidden controls at 390px
- gate_failed: None
- note: TILLER ALREADY TRIED TO SELF-HEAL THIS. Seat `x-tlre7cd71a78feb_impl_terra` for G1 was respawned 0x and re-dispatched automatically before this RAISE. callback received A plain RETRY_WITH_DIRECTION will repeat exactly what already failed — fix the underlying condition (env, PATH, quota, or the slice itself) first, or answer STOP_TRUE_BLOCKED.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.

## PARKED+RAISED G2 — attempts=1
- why: impl [projcore callback] implementer G2 STATUS: BLOCKED — required npm run build fails: unknown request.params in reminder/wakeup routes
- gate_failed: None
- note: TILLER ALREADY TRIED TO SELF-HEAL THIS. Seat `x-tlre7cd71a78feb_impl_terra` for G2 was respawned 0x and re-dispatched automatically before this RAISE. callback received A plain RETRY_WITH_DIRECTION will repeat exactly what already failed — fix the underlying condition (env, PATH, quota, or the slice itself) first, or answer STOP_TRUE_BLOCKED.
- action: BRAIN(projcore)/JROM — re-plan/split or supply a DIRECTION. Conductor will NOT re-grind it this run.
