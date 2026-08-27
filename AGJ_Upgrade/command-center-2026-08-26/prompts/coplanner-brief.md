# Co-planner brief — agjassist-command-center

From: `[projcore]` on `x-01_projcore_grok46_agjassist`
To: both co-planners (grok46 + sol). You two **co-own** the plan. Do **not** implement product code.

## Mission
Author, in the run dir, the Tiller planner contract:

1. `AGJ_Upgrade/command-center-2026-08-26/plan.md` — ONE 11-col pipe table
2. `AGJ_Upgrade/command-center-2026-08-26/queue.md` — bullets, not a table
3. `AGJ_Upgrade/command-center-2026-08-26/fence-contract.json` — required (this plan will have INTEGRATION rows)

**Frozen docs (author TO these; do not rewrite og-requirements or north-star):**
- `AGJ_Upgrade/command-center-2026-08-26/north-star.md`
- `AGJ_Upgrade/command-center-2026-08-26/og-requirements.md` (ACs A1–J2 + candidate fences + do-not-regress)
- `AGJ_Upgrade/command-center-2026-08-26/topology.yaml`
- `AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html` (locked UI contract; 390px = phone)
- `AGJ_Upgrade/command-center-2026-08-26/decisions/`
- Planner contract: `/home/agjrom/websites/wflow/tokenless_coord/TILLER-USAGE.md` §1 + §1.4 + §5.3
- Sizing canon: `~/.claude/agents/projcore.md` §3.1 (clock retired)
- Budget rubric: `~/.grok/agents/loop-escalation.md` §3
- Format example in this repo: `AGJ_Upgrade/terminal-ux-2026-08-15/projcore-run-2026-08-15.bak-pre-wt/plan.md`

Repo: `/home/agjrom/TGBOTS/AGJAssist` (run dir is inside the git repo). Live app: pm2 `agjassist` on :3101 → `agjasst.silverjrom.app`. DB: `data/agjassist.db` (SCHEMA_VERSION=36).

## Convergence protocol
- **sol** writes the first complete draft of all three artifacts.
- **grok46** reviews for glimmer-reachability (named symbols, scope length, ONE layer), fence grouping, AC coverage, and RELEASE-ATOMIC tagging. Write review notes to `AGJ_Upgrade/command-center-2026-08-26/prompts/coplanner-review.md`.
- Iterate **in the files** until both emit DONE. Do not spawn more sessions. Do not edit product code.
- Append every status line to `AGJ_Upgrade/command-center-2026-08-26/callbacks.md`.

Callback shape (one line):
`[projcore callback] coplanner <sol|grok46> STATUS: WORKING|DONE|BLOCKED — <note>`

## Tiller table (exactly these columns, one parseable table)

`| id | scope | acs | tests | est_min | deps | impl_tier | val_tier | deliberation | redteam | budget |`

- `id` MUST match `^[A-Z]\d+(\.\d+)?[a-z]?$` (A1, B2, A6b). **No hyphens.** Candidate fence names `F-OVM` / `F-REMINDERS` / `F-WAKEUP` / `F-WINDOW` go in **scope** after `INTEGRATION:`, not as the id.
- `scope` imperative, self-contained, named symbols + layer. Tag `RELEASE-ATOMIC` and `GATE-ATOMIC` in scope when they apply. INTEGRATION rows start with `INTEGRATION:`.
- `acs` — og-requirements ids (`A1`, `C5`, …). Never empty. Cover **every** AC A1–J2.
- `tests` — the **literal command** the seat runs. Vitest MUST include `--minWorkers=1 --maxWorkers=4`. UI-looking slices MUST contain a real render assertion (`playwright` / `page.goto` / `toBeVisible` / `jsdom` / `testing-library`) or explicit `[no-render]`. Fence tests MUST **load the Mini App in a browser**.
- `est_min` integer (planning aid only; NOT a sizing axis).
- `deps` comma-separated real slice ids, or `—`. **Name contributing slices** on INTEGRATION rows (not `all <Phase>` unless you state why in scope).
- `impl_tier` L1|L2|L3|L4 and `val_tier` L1|L2|L3|L4 from topology. **Predicted complexity, not first-seat routing:** every non-INTEGRATION row still **enters at glimmer (L1)**; the label is where the ladder **resumes** after L1 attempts. INTEGRATION rows keep tier-based routing and are **floored at L3** (never glimmer). Use stronger val_tier on fences.
- `deliberation` yes|no. `redteam` budget|standard|elite|—. Fences: `redteam=elite`. OVM teardown / high-blast: deliberation yes if the approach is still open; otherwise no + elite redteam on the fence.
- `budget` integer attempt budget (driver clamps to BUDGET_CEILING). Also author a human `## Budgets` table with `max_fix_cycles` / `max_redteam_iterations` / `max_wallclock_min` per rubric.

## queue.md bullets

```
- [PENDING] 1: A0 — <user-POV label ≤120 chars, leading verb, no table/file names>
```

Parser: `- [STATE] <ovmid>: <SLICE>\b` then optional ` — label`. Labels are stakeholder view (`Let the owner…`, `Show…`).

## Sizing (clock retired — §3.1)

A slice is correctly sized when BOTH hold:
1. **Testable** — ONE claim, an assertion that FAILS when the slice is wrong.
2. **glimmer could plausibly do it** — most slices should be L1-shaped.

Smell test (not a gate): ≤~3 named symbols in scope · ≤~500 chars scope · **ONE layer**. Exceed only with a stated reason in scope. Split on symbol count and layer count, not minutes. Vertical-slice floor: do not atomize below validatability. ~1–3 focused tests.

**Layers in this repo (do not mix in one slice without a stated reason):**
- SQLite schema / `src/db/{schema.ts,database.ts}` (additive-only except the authorized overmind_* drop)
- API / Fastify routes (`src/api/`)
- services (`src/services/`)
- bot commands (`src/bot/`)
- web UI (`src/web/public/{app.js,style.css,index.html,terminal-chat-state.js}`)
- tests (unit vs e2e — tests are atomic too)

## INTEGRATION fences (TILLER-USAGE §1.4 + §5.3) — planning decision, must be visible

Candidate grouping from og-requirements (you may regroup; you MUST enumerate contributors and carry the **why** in scope):

- **F-OVM** — OVM+guardian gone, app boots, suites green, migration parity (A1–A5, B1–B2)
- **F-REMINDERS** — schedule → server-side solicit into a pane → summary in dropdown (C1–C6, E1–E3, F1–F3)
- **F-WAKEUP** — schedule → pending chip → fires → chip clears + action sent (D1–D3)
- **F-WINDOW** — agent-window v2 header/collapse/theme/responsive + refresh + drafts match the mockup (G1–G3, H1–H3, I1–I2, J1–J2)

Rules:
- Scope starts with `INTEGRATION: <capability> — composes <ids> because <why these are siblings>`.
- `deps` NAME the contributing slices. Guidance: beyond ~5 contributors, ask if it is one capability or several.
- Stronger tier than the units + `redteam=elite`.
- Journey file **does not yet exist**; a checkpoint that can pass today is vacuous. OPEN is the driver's job — do **not** make a feature row whose deliverable is "leave the journey red" (the ordinary gate refuses red).
- **Journey author sits OUTSIDE every fence.** Every fence **contributor depends on the author** (directly or transitively) so the file exists before `ensure_fence_open`. Author is **not** a fence contributor.
- Assert against the **running/built** Mini App in a **browser**, not source-grep. Arrive via real constituents, not faked preconditions.
- `fence-contract.json` per fence: `integration_cmd` (must write `fence-report-v1.json` including `verdict_line` with `[FENCE-VERDICT-V1]` — stdout is discarded), `negative_control_cmd` (`FENCE_STUB=<one constituent>` then the **same** check; stub the SYSTEM, never `raise` before the body), `acceptance_ids` (must exist in og-requirements), `test_path`, `authored_by`, `contributors`, `seed_slice`.
- Non-vacuous both ways: fail if a constituent is stubbed; reach start state by exercising constituents.
- F-OVM in particular: **fence-before-deploy**. No `pm2 restart agjassist` until F-OVM is green.

Existing fence wrapper shape in this repo: `e2e/run-terminal-ux-conversation-fence.mjs` (must be improved: that report lacked `verdict_line`; new fences MUST emit it). Playwright today boots `e2e/static-server.mjs` on :3210 (static only). **F-REMINDERS / F-WAKEUP / F-OVM need a real API server** (temp DB copy — never the live `data/agjassist.db`). Plan how the fence boots that. F-WINDOW may use Playwright on the served UI; still load the Mini App in a browser.

## SAFETY MANDATES (non-negotiable — north gates the plan on these)

1. **DB backup before the destructive drop.** The `overmind_projects` / `overmind_workflows` / `overmind_task_history` drop is the ONE authorized destructive migration. A timestamped `data/agjassist.db` backup **precedes** it. Fresh-vs-upgrade schema parity; `SCHEMA_VERSION` bump. Tag the drop/backup row `RELEASE-ATOMIC`. Tiller is **build/test/dry-run ONLY** — tests MUST copy the DB (`AGJASSIST_DB_PATH=/tmp/<slice>-$$.db` or equivalent); Tiller must never mutate live `data/agjassist.db`. Actual live drop + `pm2 restart` = `RELEASE-ATOMIC` / `release_review` (Tiller lands code + proves on a copy; humans execute).
2. **Fence-before-deploy.** No live `pm2 restart agjassist` until the relevant fence is green — especially F-OVM.
3. **Attended teardown.** High blast radius. Rollback: `git reset --hard` + DB restore. Keep the backup path in the RELEASE-ATOMIC scope.
4. **Owner-only preserved** (account `1000000001`); every new send **safety-pattern checked + audited**; **do-not-regress** list at the tail of og-requirements.md honored (key row, send-as-command/raw-keys, image attach, ME-nav, search, font, groups, selection prompts, busy flag, themeChanged, owner-only auth, tmux send/keys REST).

## Existing code you MUST distinguish (do not smash)

- `src/services/reminder-service.ts` + `reminders` table = **calendar event reminders** (title/event_date). The new C* feature is **folder-level agent-solicit**. Additive schema; new tables/routes; do not overload the calendar table.
- `src/services/agent-wake-scheduler.ts` is **OVM-coupled** (`overmind: Scheduled wake is due`, `run_id`/`batch_id`). New D* wakeups are owner-facing one-shot pane sends with a pending chip. Do not reuse the OVM wake table as the product surface; teardown may delete the OVM one.
- OVM surface to destroy: `src/services/overmind*` + `src/services/overmind/`, `src/api/routes/overmind-routes.ts`, `src/api/websocket/overmind-stream-manager.ts`, `src/web/public/overmind-helpers.js`, bot `/overmind` `/om_*` `/ovm_*` in `src/bot/assistant-core.ts` + `telegram-bot.ts`, wiring in `src/index.ts`. Bottom-nav / screens in `src/web/public/app.js`. Many `tests/overmind-*.test.ts` become delete-or-replace; A5 requires unit+e2e green after.
- Guardian escalate: `src/api/routes/guardian-routes.ts` `POST /api/guardian/escalate`. Relocate or delete `isLoopbackAddress` / `buildGuardianEscalationNotification` without breaking non-guardian paging (B2).
- UI port target: `src/web/public/{app.js,style.css,index.html,terminal-chat-state.js}`. Match locked mockup.
- `topology.yaml` `pre_run_wiring` gpt-5.6-sol/terra in `src/config/providers.ts` is the **app spawn registry**, not Tiller. Include a slice only if this effort's product must launch those models.

## Tests / build

- Unit: `npx vitest run <files> --minWorkers=1 --maxWorkers=4`
- E2E: `npx playwright test <spec>` (current webServer is static :3210 — fences that need API must not rely on it blindly)
- Build (human deploy, not Tiller): `npm run build` then `pm2 restart agjassist`; static `no-store`.
- Do-not-regress: existing `e2e/terminal-ux-*.spec.ts` must stay green; F-OVM / A5 call that out.

## Out of scope
Rebuilding OVM. Conversational-assistant rebirth. Prod secrets. Touching other pm2 apps. Rewriting frozen north-star / og-requirements.

## Deliverable checklist
- [ ] Every AC A1–J2 appears in some row's `acs`
- [ ] Four fences (or a regroup you justify) with named contributors + why in scope + fence-contract.json
- [ ] Journey-author seed slice outside fences; contributors depend on it
- [ ] RELEASE-ATOMIC on backup+drop and on live deploy; Tiller never hits live DB or pm2
- [ ] Owner-only + safety-check + audit on every new send path
- [ ] Do-not-regress called out (A5 / F-OVM and F-WINDOW)
- [ ] Promotion cleanup (dead OVM files, `*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`) as a gated slice; `mockups/final/agent-window-v2.html` stays
- [ ] queue.md 1:1 with plan rows
- [ ] Budgets table per rubric

When both of you agree the three files are ready, each emit `STATUS: DONE`.
