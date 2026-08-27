# plan — agjassist-command-center

Contract sources: locked `og-requirements.md`, `north-star.md`, `topology.yaml`, and `mockups/final/agent-window-v2.html`. Lifecycle is pre-live with deferral off. Every non-INTEGRATION row enters at glimmer L1; `impl_tier` records the predicted resume tier after L1 attempts. Tiller is build/test/dry-run only: no row may mutate `data/agjassist.db`, restart pm2, or perform the live release.

The app reads `DB_PATH` (default `data/agjassist.db`). There is no `AGJASSIST_DB_PATH`. Every test/fence command that boots SQLite must go through `scripts/cc-run-isolated.mjs` or the fence runner, which set `DB_PATH` to a temp copy, never the live file.

Fence grouping is five capabilities. The candidate reminders fence was split into F-REMINDERS and F-SUMMARIES because scheduling-to-pane and reply-to-LLM-to-dropdown have different seams. F-OVM keeps seven contributors because teardown is one release-atomic rollback domain. F-WAKEUP is capability-independent of F-SUMMARIES (E1 does not wait on D7). Schema edits still serialize C1→D1→E1. F-WINDOW is one rendered surface; I1–I2 still need the Fastify+temp-DB harness, not static :3210.

Each fence has its **own** journey spec. A0 authors all five plus the runner. `FENCE_ID` collects only that fence's acceptance ids so a later capability cannot keep an earlier CLOSE red. Default Playwright `webServer` on :3210 stays for existing `e2e/terminal-ux-*.spec.ts`; command-center specs use Playwright project `cc` whose webServer is the Fastify temp-DB harness.

**Fence gate (plan-approval #1/#2).** An INTEGRATION row is not green unless `--gate` does BOTH: (a) the positive `FENCE_ID` run PASSES, and (b) `FENCE_STUB=<contributor>` runs the same assertions and FAILS with `kind=assert` on the named `expected_negative_fail_ids` in `fence-contract.json`. Import/env/not_found/collect_error do **not** satisfy the red path. A0 authors that into the harness.

**Promotion cleanup (plan-approval #4).** Every slice that creates a temp DB, fence-report copy, or local server tears it down as part of that slice's test command (isolated runner / fence `--gate` / Playwright `cc` webServer). Print `reclaimed_bytes=<n>` on DONE. G1 keeps dead-OVM + mockup-scratch cleanup only.

| id | scope | acs | tests | est_min | deps | impl_tier | val_tier | deliberation | redteam | budget |
|----|-------|-----|-------|---------|------|-----------|----------|--------------|---------|--------|
| A0 | HARNESS-CORRECTNESS ONLY. Validator gates this row on `--harness-smoke` exit 0, NEVER on product A5. `acs` is HARNESS-SMOKE (not A5 — A5 stays B8/G2). Recovered HEAD still uses an HTTP proxy for FENCE_STUB (`scripts/cc-run-isolated.mjs` startStubProxy); remaining work: replace that with in-process Fastify preload so FENCE_STUB=ID patches the unit before route/job registration (INTERCEPTION_GAP). Also: every spec writes fence-report-v1.json in finally; `--gate` requires named expected_negative_fail_ids kind=assert (no synthesized ids); print reclaimed_bytes. Recovered commits already on HEAD (3439337). No product OVM removal. | HARNESS-SMOKE | `FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --harness-smoke` | 30 | — | L3 | L3 | no | standard | 5 |
| B1 | Web UI layer only: remove Workflows, Overmind Projects, and OVM Console (`OvmConsole` at `/conversations`) screens, header links, and bottom-nav entries; unknown `#/overmind*` hashes redirect home. Extract surviving bottom-nav/landing helpers out of `overmind-helpers.js` before dropping the OVM import. Do not delete FriendlyTerminalView or the file wholesale (G1 deletes leftovers). | A1 | `npx playwright test e2e/command-center-ovm.spec.ts --project=cc --grep B1` | 25 | A0 | L2 | L2 | no | standard | 4 |
| B2 | API layer only: remove `registerOvermindRoutes`, `OvermindStreamManager`, and Overmind fields from `ApiServices`; `/api/overmind/*` and its WebSocket no longer register. Runs after B6 so guardian no longer imports `overmind-routes`. | A2 | `npx vitest run tests/overmind-removal-api.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0,B6 | L3 | L3 | no | standard | 4 |
| B3 | Services layer only: delete `OvermindService`, `OvermindWatcher`, `SonnetOvermindBrain`, `overmind-notifications`, and `src/services/overmind/` without replacing OVM. Runs after B6 so `buildGuardianEscalationNotification` is no longer imported. | A2 | `npx vitest run tests/overmind-removal-services.test.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,B6 | L3 | L3 | no | standard | 4 |
| B4 | Bootstrap layer only: remove Overmind imports, construction, watcher startup, and server injection from `src/index.ts`; production bootstrap starts with no OVM wiring. | A2,A5 | `npx vitest run tests/overmind-removal-bootstrap.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0,B2,B3 | L3 | L3 | no | standard | 4 |
| B5 | Bot layer only: remove `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end` from `AssistantCore` and `TelegramAssistant`; they follow the normal unknown-command path. | A3 | `npx vitest run tests/overmind-command-removal.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0 | L2 | L2 | no | standard | 4 |
| B6 | API layer: remove `registerGuardianRoutes` and `POST /api/guardian/escalate`; stop importing `isLoopbackAddress` / `buildGuardianEscalationNotification` (delete them here if unused, else leave a local copy for non-OVM loopback routes). Regression fixture: calendar-reminder Telegram paging still sends. Precedes B2/B3. | B1,B2 | `npx vitest run tests/guardian-removal.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0 | L2 | L3 | no | standard | 4 |
| B7 | RELEASE-ATOMIC schema layer: bump `SCHEMA_VERSION`, remove OVM DDL, and on upgrade copy the DB being migrated to `<that-db-path>.pre-ovm-drop-<UTC>-<PID>.bak` before dropping `overmind_projects`, `overmind_workflows`, `overmind_task_history`. Prove fresh-vs-upgrade parity only on temp copies. Live path `data/agjassist.db.pre-ovm-drop-<UTC>-<PID>.bak` is G2 execute-only. Isolated runner tears down the temp DB. | A4 | `node scripts/cc-run-isolated.mjs --slice B7 -- npx vitest run tests/unit/command-center-migration.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0 | L4 | L4 | no | standard | 5 |
| B8 | INTEGRATION: F-OVM OVM and guardian are gone while the app boots and core surfaces remain — composes B1,B2,B3,B4,B5,B6,B7 because teardown is one rollback domain and any survivor leaves OVM exposed, stale schema, or a broken bootstrap; load the built Mini App and real API on a temp `DB_PATH` copy; run unit plus terminal-ux e2e; never touch live DB or pm2. `--gate` requires the positive journey PASS and `FENCE_STUB=B2` FAIL on named A2 kind=assert. | A1,A2,A3,A4,A5,B1,B2 | `FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` | 45 | B1,B2,B3,B4,B5,B6,B7 | L4 | L4 | no | elite | 5 |
| C1 | Schema layer: additive `agent_solicit_reminders` plus recipient rows in `SCHEMA_SQL` and `DatabaseService` migrations (folder-group, cadence, repeat limit, include/skip, next-fire, fresh-vs-upgrade). Do not alter calendar `reminders`. | C1,C2,C3,C4,C6 | `node scripts/cc-run-isolated.mjs --slice C1 -- npx vitest run tests/unit/agent-reminder-schema.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | B8 | L3 | L3 | no | standard | 4 |
| C2 | Services layer: `AgentSolicitService` CRUD and due-state for preset/custom cadence, stop-after-N or unlimited, immediate include/skip, persisted active-reminder projections. | C2,C3,C4,C6 | `node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,C1 | L2 | L2 | no | standard | 4 |
| C3 | Services layer, ONE claim=`fireDue`: resolve current group panes, skip excluded agents, pass every solicit through existing `SafetyService`+`TmuxService`, write `AuditService`, advance/deactivate repeats with the Mini App closed. | C5 | `node scripts/cc-run-isolated.mjs --slice C3 -- npx vitest run tests/unit/agent-reminder-scheduler.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0,C2 | L3 | L3 | no | standard | 5 |
| C4 | API layer: owner-only `registerAgentReminderRoutes` for create/update/cancel, include/skip, and active-reminder reads; non-owner and malformed cadence/repeat fail-closed. | C1,C4,C6 | `node scripts/cc-run-isolated.mjs --slice C4 -- npx vitest run tests/agent-reminder-routes.test.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,C2 | L2 | L3 | no | standard | 4 |
| C5 | Web UI layer: port `AgentReminderSheet` + `ActiveRemindersView` (current terminal group, presets/custom cadence, stop-N/unlimited, include/skip). Reload-stable persist is C6, not this row. | C1,C2,C3,C4 | `npx playwright test e2e/command-center-reminders.spec.ts --project=cc` | 35 | A0,C4 | L2 | L3 | no | standard | 4 |
| C6 | INTEGRATION: F-REMINDERS a folder schedule persists and fires a safety-checked audited solicit into only included real temp tmux panes — composes C1,C2,C3,C4,C5 because they are the schema-to-service-to-API-to-browser-to-scheduler path for one reminder capability; boot real API on temp `DB_PATH` and load the Mini App. `--gate` requires positive PASS and `FENCE_STUB=C3` FAIL on named C5 kind=assert. | C1,C2,C3,C4,C5,C6 | `FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` | 40 | C1,C2,C3,C4,C5 | L4 | L4 | no | elite | 5 |
| D1 | Schema layer: additive `summary_llm_endpoints` and `agent_summaries` with one default, provenance, timestamps, no plaintext secret columns, fresh-vs-upgrade parity. | E1,E3,F2,F3 | `node scripts/cc-run-isolated.mjs --slice D1 -- npx vitest run tests/unit/summary-schema.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | C6 | L3 | L3 | no | standard | 4 |
| D2 | Services layer: `SummaryEndpointService` owner-scoped add/edit/remove/default; seed OpenAI-compatible endpoint labelled `140`; never log secrets. | F1,F2,F3 | `node scripts/cc-run-isolated.mjs --slice D2 -- npx vitest run tests/unit/summary-endpoint-service.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,D1 | L2 | L3 | no | standard | 4 |
| D3 | Services layer: `ReplySummaryService` captures the post-solicit pane reply, calls selected `/v1/chat/completions`, persists a short endpoint-attributed summary; LLM failure degrades without undoing the solicit. | E1,E3 | `node scripts/cc-run-isolated.mjs --slice D3 -- npx vitest run tests/unit/reply-summary-service.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0,C3,D2 | L3 | L3 | no | standard | 5 |
| D4 | API layer: owner-only `registerSummaryRoutes` for endpoint CRUD/default and per-agent summary reads (newest first); validate OpenAI-compatible base URLs; secrets stay out of responses and logs. | E2,F1,F2,F3 | `node scripts/cc-run-isolated.mjs --slice D4 -- npx vitest run tests/summary-routes.test.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,D2,D3 | L2 | L3 | no | standard | 4 |
| D5 | Web UI layer: port `SummaryEndpointSettings` (add/edit/remove, radio default, seeded `140`, owner-only errors). After C5 to avoid a dual `app.js` merge. | F1,F2,F3 | `npx playwright test e2e/command-center-endpoints.spec.ts --project=cc` | 30 | A0,D4,C5 | L2 | L3 | no | standard | 4 |
| D6 | Web UI layer: port `AgentSummariesDropdown` (per-agent newest-first cards, endpoint tags, scroll, empty state). After D5 as the other new agent-window sheet. | E2,E3 | `npx playwright test e2e/command-center-summaries.spec.ts --project=cc` | 25 | A0,D4,D5 | L1 | L2 | no | standard | 4 |
| D7 | INTEGRATION: F-SUMMARIES an answered reminder is captured, summarized by the selected local endpoint, and appears in that agent's dropdown — composes D1,D2,D3,D4,D5,D6 because they own endpoint selection through visible persistence. Explicit dep on closed C6. Fixture contract: arrive by firing the C6 solicit/reply path on a real temp pane and capturing that reply; do not INSERT `agent_summaries` or write a fake reply as a precondition. `--gate` requires positive PASS and `FENCE_STUB=D3` FAIL on named E1 kind=assert. | E1,E2,E3,F1,F2,F3 | `FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` | 45 | C6,D1,D2,D3,D4,D5,D6 | L4 | L4 | no | elite | 5 |
| E1 | Schema layer: additive `agent_one_time_wakeups` (pane, manual fire time, action, pending/fired/cancelled, fresh-vs-upgrade). Do not reuse OVM `agent_wake_schedule`. Capability-independent of summaries, but deps D1 so `SCHEMA_VERSION` / `schema.ts` edits serialize C1→D1→E1 (no parallel bump). | D1,D2,D3 | `node scripts/cc-run-isolated.mjs --slice E1 -- npx vitest run tests/unit/agent-wakeup-schema.spec.ts --minWorkers=1 --maxWorkers=4` | 25 | D1 | L3 | L3 | no | standard | 4 |
| E2 | Services layer, ONE claim=fire-once: `AgentWakeupService` create/cancel/fire; due fires pass the action through existing `SafetyService`+`TmuxService`, write `AuditService`, atomically clear pending. | D1,D2,D3 | `node scripts/cc-run-isolated.mjs --slice E2 -- npx vitest run tests/unit/agent-wakeup-service.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0,E1 | L3 | L3 | no | standard | 5 |
| E3 | API layer: owner-only `registerAgentWakeupRoutes` for schedule, pending read, and cancel; non-owner, invalid/past times, empty actions, and cross-pane access fail-closed. | D1,D2 | `node scripts/cc-run-isolated.mjs --slice E3 -- npx vitest run tests/agent-wakeup-routes.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0,E2 | L2 | L3 | no | standard | 4 |
| E4 | Web UI layer: port `WakeupSheet` plus expanded/collapsed pending indicator (manual date/time/action, pending time, clear on fire or cancel). After C5 to serialize agent-window `app.js` edits. | D1,D2,D3 | `npx playwright test e2e/command-center-wakeup.spec.ts --project=cc` | 30 | A0,E3,C5 | L2 | L3 | no | standard | 4 |
| E5 | INTEGRATION: F-WAKEUP a one-time action is scheduled in the browser, appears pending in both header states, fires once into a real temp pane through safety and audit, and clears — composes E1,E2,E3,E4 because they are the persistence-to-service-to-API-to-window path for the one-shot capability; real API, temp `DB_PATH`, Mini App in a browser. `--gate` requires positive PASS and `FENCE_STUB=E2` FAIL on named D3 kind=assert. | D1,D2,D3 | `FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` | 40 | E1,E2,E3,E4 | L4 | L4 | no | elite | 5 |
| F1 | `terminal-chat-state.js` only: `readTerminalDraft` / `writeTerminalDraft` / `clearTerminalDraft`, keyed by viewer and pane, localStorage isolation, reload persistence. Does not wait on wakeups. | G1,G2,G3 | `npx vitest run tests/unit/terminal-draft-jsdom.spec.ts --minWorkers=1 --maxWorkers=4` | 20 | A0 | L1 | L2 | no | standard | 3 |
| F2 | Web UI layer: wire per-pane drafts into `FriendlyTerminalView` and the agent switcher (restore on switch, draft-kept + switcher indicators, clear only the sent pane). After B8 so OVM chrome is gone. | G1,G2,G3 | `npx playwright test e2e/command-center-drafts.spec.ts --project=cc` | 30 | A0,F1,B8 | L2 | L3 | no | standard | 4 |
| F3 | Web UI layer: always-reachable refresh control on `FriendlyTerminalView`; re-pull pane output and session metadata together; in-progress then completion; composer stays interactive. Project `cc` supplies live API/tmux. | I1,I2 | `npx playwright test e2e/command-center-refresh.spec.ts --project=cc` | 30 | A0,F2 | L2 | L3 | no | standard | 4 |
| F4 | Web UI layer: port mockup collapse chrome only (`TerminalHeaderV2` independent tabs/util/control collapse, default tabs-collapsed + utilities-expanded, single-row bell when fully collapsed). Chip content lands in C5/D6/E4. | H1,H2 | `npx playwright test e2e/command-center-header.spec.ts --project=cc` | 35 | A0,C5,D6,E4,F3 | L2 | L3 | no | standard | 4 |
| F5 | Web UI layer: `AgentGroupSwitcher` — below 900px status/draft dropdown with no drag; at 900px+ horizontal strip plus working pointer scrubber; both paths call the same switch action. | J1,J2 | `npx playwright test e2e/command-center-switcher.spec.ts --project=cc` | 30 | A0,F2,F4 | L2 | L3 | no | standard | 4 |
| F6 | CSS layer: port locked `agent-window-v2` theme/responsive tokens in `style.css` (system/light/dark, 390px spacing, centered capped column on tablet/desktop) without regressing existing controls. | H3,J1,J2 | `npx playwright test e2e/command-center-responsive.spec.ts --project=cc` | 35 | A0,F4,F5 | L2 | L3 | no | standard | 4 |
| F7 | INTEGRATION: F-WINDOW the served agent window matches the locked mockup across 390, 768, 1024, and 1440 while drafts, refresh, collapse, theme, and both switchers work — composes F1,F2,F3,F4,F5,F6 because they are the state, behavior, structure, switching, and style siblings of one rendered window; boot Fastify+temp `DB_PATH` (refresh is live tmux, not static :3210) and run terminal-ux e2e on the built Mini App. `--gate` requires positive PASS and `FENCE_STUB=F1` FAIL on named G3 kind=assert. | G1,G2,G3,H1,H2,H3,I1,I2,J1,J2 | `FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` | 45 | F1,F2,F3,F4,F5,F6 | L4 | L4 | no | elite | 5 |
| G1 | PROMOTION CLEANUP: delete residual dead OVM source/tests/tools and `mockups/final/*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`; keep `mockups/final/agent-window-v2.html`. Targeted cleanup test plus served-browser terminal regressions so no orphan import survives. Full unit+e2e stay on B8/F7, not this row. Per-slice temp cleanup is already each row's isolated runner, not this janitor. | A1,A2,A3,A5 | `npx vitest run tests/command-center-cleanup.test.ts --minWorkers=1 --maxWorkers=4 && npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts` | 35 | B8,C6,D7,E5,F7 | L3 | L4 | no | standard | 5 |
| G2 | RELEASE-ATOMIC: add `scripts/release-command-center.mjs`. Default `--dry-run` requires green B8,C6,D7,E5,F7 markers, builds, migrates a `DB_PATH` copy, prints backup path plus rollback `git reset --hard <pre-release-sha>` and DB-restore. `--execute` is human-gated by MECHANISM: refuse unless stdin is a TTY AND the operator types the confirmation phrase AND none of `TILLER_SLICE`/`TILLER_RUN_DIR`/`TILLER_ATTEMPT`/`TILLER_SEAT` are set; any tiller/agent marker ⇒ hard refuse (non-zero, zero live DB writes, zero pm2). `tests/unit/release-command-center.spec.ts` MUST prove a tiller-env `--execute` is refused (exit non-zero, `data/agjassist.db` untouched, no `pm2` spawn). Tiller runs only dry-run + the refuse test, never `--execute`. | A4,A5 | `node scripts/cc-run-isolated.mjs --slice G2 -- npx vitest run tests/unit/release-command-center.spec.ts --minWorkers=1 --maxWorkers=4 && npm run build` | 30 | G1 | L4 | L4 | no | elite | 5 |

## Budgets

Rubric: `loop-escalation.md` §3. `token_budget: null`; `new_class_rounds_to_stall: 2`; `on_burn: pull_in_coplanner_then_north`. Wall-clock uses `max(60, 2×est_min, 15×(max_fix_cycles+max_redteam_iterations))`. Elite fences and the release gate use the topology hard cap of three red-team iterations, not consecutive-clean.

| id | max_fix_cycles | max_redteam_iterations | max_wallclock_min |
|----|----------------|------------------------|-------------------|
| A0 | 3 | 2 | 75 |
| B1 | 3 | 2 | 75 |
| B2 | 4 | 2 | 90 |
| B3 | 4 | 2 | 90 |
| B4 | 4 | 2 | 90 |
| B5 | 3 | 2 | 75 |
| B6 | 4 | 2 | 90 |
| B7 | 6 | 2 | 120 |
| B8 | 6 | 3 | 135 |
| C1 | 4 | 2 | 90 |
| C2 | 3 | 2 | 75 |
| C3 | 5 | 2 | 105 |
| C4 | 4 | 2 | 90 |
| C5 | 3 | 2 | 75 |
| C6 | 5 | 3 | 120 |
| D1 | 4 | 2 | 90 |
| D2 | 4 | 2 | 90 |
| D3 | 5 | 2 | 105 |
| D4 | 4 | 2 | 90 |
| D5 | 3 | 2 | 75 |
| D6 | 3 | 2 | 75 |
| D7 | 5 | 3 | 120 |
| E1 | 4 | 2 | 90 |
| E2 | 5 | 2 | 105 |
| E3 | 4 | 2 | 90 |
| E4 | 3 | 2 | 75 |
| E5 | 5 | 3 | 120 |
| F1 | 2 | 2 | 60 |
| F2 | 3 | 2 | 75 |
| F3 | 3 | 2 | 75 |
| F4 | 3 | 2 | 75 |
| F5 | 3 | 2 | 75 |
| F6 | 3 | 2 | 75 |
| F7 | 5 | 3 | 120 |
| G1 | 4 | 2 | 90 |
| G2 | 6 | 3 | 135 |

## Release boundary

F-OVM is fence-before-deploy: no live `pm2 restart agjassist` or live OVM-table drop before B8 is green, and G2 additionally requires every capability fence. On a live execute the pre-drop backup is `data/agjassist.db.pre-ovm-drop-<UTC>-<PID>.bak`. Tests derive the backup as a sibling of the `DB_PATH` file under test. Rollback is attended: restore that backup and reset to the recorded pre-release commit.

`--execute` is not a prose instruction. It is a guard in `scripts/release-command-center.mjs`: TTY + typed confirmation + absence of tiller/agent env. A tiller seat that passes `--execute` must be refused by that guard; G2's test proves it.

## Plan-approval rev 2 (2026-08-27)

Maps north+codex55 CHANGES-REQUESTED 1–6:
1. HIGH — each INTEGRATION `tests` cell is `--gate` (positive PASS + negative named-red).
2. HIGH — `expected_negative_fail_ids` + `kind=assert` required; A0 `--harness-smoke` proves it.
3. HIGH — G2 `--execute` mechanism + `tests/unit/release-command-center.spec.ts` refuse-under-tiller.
4. MED — `scripts/cc-run-isolated.mjs` / fence runner teardown + `reclaimed_bytes`; G1 is not the janitor.
5. MED — A0 gated by `--harness-smoke`, not `--list`.
6. MED — D7 deps include C6; fixture contract forbids faked reply/summary rows.

## Out of scope

Rebuilding OVM, reviving autonomous overseer behavior, changing prod secrets, touching another pm2 app, rewriting frozen strategy/requirements/mockup artifacts, or adding `gpt-5.6-sol`/`gpt-5.6-terra` to `src/config/providers.ts` (north `pre_run_wiring`, not this product).
