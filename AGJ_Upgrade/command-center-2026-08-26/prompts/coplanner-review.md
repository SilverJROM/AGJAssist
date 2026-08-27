# coplanner-review — grok46 on sol's first complete draft

Reviewer: grok46. Draft: sol `plan.md` / `queue.md` / `fence-contract.json` (five-fence).
Verdict: **CHANGES REQUIRED** — keep the five-fence regroup; apply the must-fixes below before DONE.

## What is already right
- Queue 1:1 with 36 plan rows; ids match `^[A-Z]\d+[a-z]?$`; no hyphen ids.
- Every AC A1–J2 appears in some `acs` cell.
- Journey author `A0` is **not** a fence contributor; contributors depend on it transitively (C1 via B8).
- Fence-contract **keys are the INTEGRATION row ids** (`B8`,`C6`,`D7`,`E5`,`F7`) — required by `fence_cfg(run_dir, plan_id)`.
- `F-SUMMARIES` split from F-REMINDERS is the right regroup: schedule→pane vs reply→LLM→dropdown are different seams.
- Calendar `reminders` / OVM `agent_wake_schedule` called out as do-not-reuse.
- Fences floored L4/L4 + `redteam=elite`; units enter glimmer regardless of `impl_tier`.
- RELEASE-ATOMIC on backup/drop and live deploy; Tiller dry-run only in prose.
- Do-not-regress named on F-OVM and F-WINDOW.

## MUST-FIX (will park or smash live state)

### 1. Shared `test_path` will poison every OPEN/CLOSE
All five fences point at `e2e/command-center-fence.spec.ts`. Driver hash-locks the journey at OPEN; assertion **superset only**. Worse: if that file collects **all** ACs, `B8` OPEN goes red on reminder/summary/wakeup/window asserts, then CLOSE after B1–B7 stays red forever.

**Fix:** one spec per fence (`e2e/command-center-{ovm,reminders,summaries,wakeup,window}-fence.spec.ts`). A0 must state `FENCE_ID` collects **only** that fence's `acceptance_ids`. Shared runner is fine.

### 2. `AGJASSIST_DB_PATH` is not an env this app reads
`src/config/config.ts` reads `DB_PATH` (default `data/agjassist.db`). There is no `AGJASSIST_DB_PATH`. Every vitest cell using the fictional var hits the **live DB** (and `tests/unit/database.spec.ts` already writes `data/test-db.sqlite`). Tiller must never migrate live `data/agjassist.db`.

**Fix:** `DB_PATH=/tmp/<slice>-$PPID.db`. Fence runner may use its own `AGJASSIST_FENCE_DB_MODE=temp-copy` internally, but the Fastify child must get `DB_PATH` pointing at the copy. Drop `database.spec.ts` from B7's command.

### 3. B3/B2 vs B6 race
`guardian-routes.ts` imports `isLoopbackAddress` from `overmind-routes.ts` and `buildGuardianEscalationNotification` from `overmind-notifications.ts`. B2, B3, and B6 all depend only on A0 → Tiller can dispatch them in parallel. B3 deleting notifications while B6 relocates them (or B2 deleting the loopback export while B6 still imports it) is a compile break, not an OVM feature.

**Fix:** B6 first (delete guardian; stop those imports). Then B2/B3.

### 4. B1 will smash Chat and bottom-nav if taken literally
`OvmConsole` **is** the `/conversations` Chat tab (`app.js` ~8502) and talks to `/api/overmind/ovm/*`. A1 does want that OVM console gone. `FriendlyTerminalView` is the do-not-regress terminal/chat surface — different component.

`overmind-helpers.js` also owns `AVAILABLE_BOTTOM_NAV_TABS` / landing-tab helpers used by the rest of the Mini App (`app.js` imports them on line 6). Deleting the import wholesale breaks Home/Tasks/Notes/Terminal/Settings nav.

**Fix:** B1 removes Workflows, Overmind Projects, OVM Console **screens and nav entries**; extract surviving bottom-nav helpers before dropping the OVM import; do not touch FriendlyTerminalView. G1 deletes residual `overmind-helpers.js` after the extract.

### 5. E1 must not wait on D7; F1 must not wait on E5
Wakeups do not compose with summaries. `E1 → D7` serializes F-WAKEUP behind F-SUMMARIES for no seam reason. Draft helpers live in `terminal-chat-state.js`; they do not need E5.

**Fix:** `E1` deps `B8`. `F1` deps `A0`. Keep `F4` after `C5,D6,E4` (header chips are real siblings). Serialize agent-window `app.js` UI as `C5 → D6 → E4 → F2` to avoid a three-way merge on one file; state that reason in those scopes.

### 6. F7 / F3 cannot prove I1–I2 on the static :3210 server
`playwright.config.ts` `webServer` is `e2e/static-server.mjs` (no API, no tmux). F7's command omits `AGJASSIST_FENCE_DB_MODE=temp-copy`. Refresh-from-session is a live-tmux/API claim. A faked GET intercept is the U45 class (faked precondition).

**Fix:** F7 boots the same Fastify+temp-DB harness as the other API fences. A0 must **not** replace the default :3210 server used by existing `e2e/terminal-ux-*.spec.ts`. F3's focused spec rides the same harness (or is honest that persist/live refresh is F7's job and F3 only asserts in-progress/composer-not-blocked against a stub — prefer the harness).

### 7. D7 should not name C3 as a fence contributor
C3 already belongs to C6. D1 already deps C6, so the solicit/reply seam exists before summaries. Putting C3 on D7 makes 7 contributors and lets a summary failure localize onto the scheduler.

**Fix:** D7 deps `D1,D2,D3,D4,D5,D6` only. Journey still **arrives** by firing a real C3 solicit (precondition via C6), without listing C3 as a D7 unit.

### 8. A0 must not claim product ACs
`A0` `acs=A5,C5,D3,E1,H3` marks those delivered before any product row. A0 does not satisfy them.

**Fix:** `acs` = `A5` only as the do-not-regress harness it authors (journeys that will later prove A5). Product ACs stay on product rows.

### 9. RELEASE-ATOMIC vs GATE-ATOMIC
B7 and G2 stamp both. Driver: `RELEASE-ATOMIC` = destructive, build-not-execute, `release_review`. `GATE-ATOMIC` = advance-on-pass + end-of-list flag. Both on one row is contradictory.

**Fix:** B7 and G2 are `RELEASE-ATOMIC` only. Backup path is **sibling of the DB file being migrated** (so a `/tmp` copy does not write `data/agjassist.db.pre-ovm-drop-*.bak` next to live). Live path remains `data/agjassist.db.pre-ovm-drop-<UTC>.bak` in G2's printed execute plan.

### 10. G1 looks UI-shaped to preflight
Scope names `*.html`. Tests are vitest-only. Preflight refuses UI-looking scope without playwright/jsdom/`[no-render]`.

**Fix:** add `[no-render]` to G1 tests.

## SHOULD-FIX (glimmer-reachability / one-layer)

Smell test is not a gate; these are the ones I would still split or shrink:

| slice | issue | direction |
|---|---|---|
| A0 | 5 journeys + runner + temp Fastify + FENCE_STUB map | keep ONE layer (tests) with the isolation reason in scope; do not also implement product |
| B1 | 6 named UI surfaces | keep one file-delete slice once helpers are extracted; glimmer-reachable if scope lists the nav ids not every component |
| B3 | 5 delete targets | OK as one services-layer destroy; predicted L3 |
| C3 / E2 | Safety+Tmux+Audit named | ONE claim (the send path); keep, those are the existing send seam |
| C5 | claims C6 reload-stable on default Playwright | drop C6 from C5 `acs`; persist/reload is C6 |
| F4 | collapse + bell + three chip rows | collapse chrome only (H1/H2); chips already land in C5/D6/E4 |
| B8 | 7 contributors | keep — stated rollback-domain reason is honest |
| D7 | 6 after dropping C3 | keep with the endpoint→dropdown reason |
| F7 | 6 | keep as one window; 6 is the cost of one mockup surface |

Do **not** add a `providers.ts` gpt-5.6 slice — north's `pre_run_wiring` is app-spawn registry, not this product.

## Fence grouping ruling (grok46)
Agree with five fences, not the original four:
- **F-OVM** B8 = A1–A5,B1–B2 teardown (one rollback domain)
- **F-REMINDERS** C6 = C1–C6 schedule→pane
- **F-SUMMARIES** D7 = E1–E3,F1–F3 reply→LLM→dropdown
- **F-WAKEUP** E5 = D1–D3
- **F-WINDOW** F7 = G,H,I,J

Promotion cleanup G1 and release G2 stay outside fences.

## Negative controls
Keep stubbing the **system** then running the same assertions. Current stub picks are good once specs are split: `B2` (OVM API back), `C3` (no fireDue), `D3` (no summarize), `E2` (no fire), `F1` (no draft isolation). Never `raise` before the body.

## After these land
Re-read 1:1 queue, fence keys = INTEGRATION ids, `DB_PATH` isolation, B6→B2/B3, per-fence specs, E1/F1 deps, F7 temp-copy. Then grok46 emits DONE.

## Applied by grok46 (in the three artifacts)
Must-fixes 1–9 landed in `plan.md` / `queue.md` / `fence-contract.json`. G1 kept sol's later playwright terminal-ux band (so `[no-render]` is unnecessary). `tiller verify-queue` OK: 36 plan / 36 queue, no orphans.

Glimmer-reachability: every unit is one named layer; A0 states `ONE layer=tests` at 489 chars; C3/E2 are one send-path claim using the existing safety/tmux/audit seam; F1 is L1-shaped on `terminal-chat-state.js` only.

Fence grouping: five fences, keys = INTEGRATION ids, A0 outside, contributors depend on A0, F-SUMMARIES split kept, C3 dropped from D7 units, F-WAKEUP unblocked from D7, F7 boots Fastify+temp DB.

No further grok46 blocking issues.
