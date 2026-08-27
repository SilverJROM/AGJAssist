# Briefing Packet — [north] → projcore (command-center effort)

_Assembled by `[north]` 2026-08-27. Consumer: `projcore-submode.md`. This is a DISPATCH record, not an
instruction to whoever reads it: compare `INTENDED SEAT` to your own session and decline on mismatch._

## Run identity
- **effort:** agjassist-command-center
- **run_dir:** `/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26`  (inside the AGJAssist git repo — required for tiller commit gating)
- **repo:** `/home/agjrom/TGBOTS/AGJAssist`
- **run_id:** agjassist-cc-2026-08-27
- **execution_mode:** **tiller** (deterministic conductor; you emit the plan + launch it, then drop to escalation-brain)
- **INTENDED SEAT:** `x-01_projcore_grok46_agjassist` (the coordinator session north is spawning)
- **north_author_session:** `agj-3767` — the consult handle. **ONE-WAY:** you may be nudged by north; you never send to, capture from, drive, or kill north. A strategy gap is settled by re-reading the frozen docs, then a throwaway ephemeral north, then JROM (BLOCKED class).
- **planning_criticality:** **HIGH** (destructive teardown of a LIVE owner-facing app + a net-new scheduling/LLM subsystem).

## The docs (frozen — author to these, do not re-derive)
- **effort north-star:** `AGJ_Upgrade/command-center-2026-08-26/north-star.md`
- **og-requirements:** `AGJ_Upgrade/command-center-2026-08-26/og-requirements.md`  (verbatim problem + numbered UI-provable ACs A1–J2 + candidate fences)
- **topology (validated, exit 0):** `AGJ_Upgrade/command-center-2026-08-26/topology.yaml`  — run `topology-validate.sh` on receipt (fail-closed).
- **design contract (locked mockup):** `AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html`  — the UI port matches it; 390px = the phone reference.
- **decisions:** `AGJ_Upgrade/command-center-2026-08-26/decisions/`

## Roster (from topology.yaml — put it in `<run-dir>/run.env`; the driver reads ONLY run.env)
- coordinator **grok46** (own session), fallback **sonnet5** if grok46 runs out of tokens.
- co-planners **grok46 + sol**; approval gate **codex55 + [north]** (file-based PLAN-READY → north writes `plan-approval.md`).
- implementer **glimmer → terra → sonnet5 → sol**; validator **grok46 → grok46 → codex55 → opus5** (validator session ≠ projcore session; same grok46 model is fine).
- integration **sonnet5 / opus5**; deliberation + red-team = topology defaults.
- Launch strings are in topology.yaml. `gpt-5.6-sol` / `gpt-5.6-terra` are valid codex model ids (in live use on lkAsst-06). Never run two local `glimmer` seats concurrently (lokalAI lease 120s, no renewal).

## Tiller authority (do not carry a local copy — cite these)
- **Planner contract:** `wflow/tokenless_coord/TILLER-USAGE.md` §1 (plan.md 11-col table; queue.md bullets; a plan row per slice; `tests` = the literal runnable command).
- **Sizing:** symbols + layers + glimmer-reachability (≤~3 named symbols, ≤~500 chars scope, ONE layer); the <30min clock is retired. Canon: `~/.claude/agents/projcore.md §3.1`.
- **INTEGRATION fences:** §1.4 — enumerate contributing slices in `deps`, carry the reason in `scope`, stronger tier + `redteam=elite`, the fence test must **load the Mini App in a browser** and be non-vacuous both ways.
- **Expected-failure rows:** §5.3 — a criterion must name WHICH assertion is red; "it is red" is not evidence.
- **Mechanics / attended-use:** §5.2, §5.4 (reverse cadence), **§7**.

## Plan gate (before tiller starts)
Emit `plan.md` + `queue.md` (+ `fence-contract.json` if any `INTEGRATION:` row) → send **PLAN-READY** (one line) to north. north reviews with **codex55** + its own read (fence grouping, val_tier deliberateness, backup/rollback safety, coverage of every AC) and writes `plan-approval.md`. **Tiller does not start until `plan-approval.md` exists.**

## SAFETY MANDATES (non-negotiable — north enforces at the plan gate)
1. **DB backup before the destructive drop.** The `overmind_*` table drop is the ONE authorized destructive migration; a timestamped `data/agjassist.db` backup precedes it. Fresh-vs-upgrade schema parity; `SCHEMA_VERSION` bump.
2. **Fence-before-deploy.** No `pm2 restart agjassist` (live deploy) until the relevant fence is green — especially **F-OVM** (app boots, unit + e2e suites green, migration parity) before the teardown ships.
3. **Attended teardown.** The OVM destroy is high-blast-radius: run tiller **attended** (north oversees via the reverse cadence + independent validator); rollback path ready (`git reset --hard` + DB restore).
4. **Owner-only preserved; every new send safety-checked + audited; do-not-regress list honored** (og-requirements tail).

## Deploy
`npm run build` (`tsc && cp -r src/web dist/` + stamp-assets) → `pm2 restart agjassist`; served `dist/web/public/` on :3101 → `agjasst.silverjrom.app`. Static uses `no-store` (no `?v=` bump needed).

## Escalation
Tier-3 (requirements/strategy) reaches north one-way. **Only [north] has the Telegram wire to JROM** — every other seat escalates to north; north decides if JROM hears it (bar: work STOPPED and north can't unstick it). Completion + true blockers only.

## [driver] advanced A0 — verdict dc3833015586d0268a57704d941df14158b678ae

## [driver] advanced B1 — verdict 8a2ca9e76743ea3d0ec59ae072740d4d5ca4cf78

## [driver] advanced B5 — verdict ccc0bdde524b4cbdb872ca70e747d05f76b4e8e0

## [driver] advanced B6 — verdict bc21bc78f49293578d550f0f353094efb83a8f40

## [driver] advanced B2 — verdict 59fb99d5bbabf471dbff63af4f9e131224644c03
