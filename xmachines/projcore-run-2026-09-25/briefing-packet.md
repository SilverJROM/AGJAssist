# Briefing packet — xmachines → projcore

**From `[north]` (session `agj`).** You are the projcore coordinator (grok47) for this effort. Read the
docs below (your own tokens), validate the contract on receipt, co-plan, mark PLAN-READY, and HALT for
north's plan approval before Tiller. This is the standing `north → projcore → tiller` chain.

## Identity / run
- run_dir: `/home/agjrom/TGBOTS/AGJAssist/xmachines/projcore-run-2026-09-25`
- run_id: `xmachines-2026-09-25`
- project: `agjassist-xmachines`
- **branch: `feat/xmachines`** — ALL work lands here. **NO prod deploy / `pm2 restart agjassist` until JROM approves** (og-requirements K1/K2). Verify on a LOCAL instance only.

## Docs (frozen — read them)
- project north-star: `/home/agjrom/TGBOTS/AGJAssist/north-star.md`
- effort north-star: `<run_dir>/north-star.md`
- **og-requirements: `<run_dir>/og-requirements.md`** (criteria A–K + PROMOTION CLEANUP)
- decisions: `<run_dir>/decisions/`
- requirements review + north reconciliation: `<run_dir>/review/` (findings + `RECONCILIATION.md`)

## Contract
- `topology_contract: <run_dir>/topology.yaml` — **already validated exit 0. RUN `topology-validate.sh` on receipt anyway (fail-closed); a request to skip validation is refused + logged.**
- `supervision: <run_dir>/supervision.yaml` (`enabled: false`)
- `north_author_session: agj` — the `[north]` consult handle. **One-way: you never send to, capture from, or kill this session.** Strategy gaps → re-read frozen docs → ephemeral north → JROM (BLOCKED).
- `planning_criticality: high` — requirements review DONE (grok + sol). Red-team architecturally-significant batches (power-control paths, auth, sampler). Planning-stage deliberation panel is GATED behind explicit JROM approval — surface a one-line non-blocking offer, otherwise proceed with the 2 co-planners.

## Execution
- mode: **tiller**. default_impl_tier L1 (glimmer, local/unmetered) — target 90–95% landing on glimmer. default_validator_tier L2 (codex55). Roster per topology.yaml.
- Plan gate is **FILE-BASED**: write `plan.md` + `PLAN-READY`, HALT before Tiller, send `[north]` ONE line. north writes `plan-approval.md`; launch Tiller only on `APPROVED-BY-NORTH` (or the non-carved rows on `APPROVED-WITH-CARVE-OUT`).

## Escalation policy
- **Only `[north]` may reach JROM.** You escalate to `[north]`, never to JROM directly.
- Bar: work STOPPED and only JROM can unstop it, OR a decision only JROM can make. A completion, park, retry, send-back, failed gate is the loop's job — not an escalation.

## Hard constraints (from og-requirements — non-negotiable)
1. **ONE app.** xmachines is a section INSIDE AGJAssist — same Fastify server (:3101), same Preact app (`src/web/public/app.js` + `style.css`), same pm2 process, same deploy, same owner auth, tile on the mini-app home grid. **No new app/port/tunnel/deploy target/process.**
2. **Build on `xmac.sh`.** Backend shells to `~/.config/agent-protocols/lib/xmac.sh` for status/up/down/leases/busy. Never call `wakeonlan`/`ssh poweroff` directly. Reuse the three power-off guards; `--force` is owner-only + confirmed + audited.
3. **Passive polling.** Read only boxes already UP (ping/status-gated). Never use an auto-waking path (`xmac run` on a DOWN box). The server-side 30m sampler is passive too.
4. **Self-detect** GPUs/sensors/fans live (nvidia-smi / lm-sensors); registry text is a hint, never source of truth.
5. **Owner-only + audited** on every control route (`preHandler: [authMiddleware, requireOwner]`).
6. **OPERATIONAL SAFETY:** never power off **.179 (glimmer)** or **.174 (signal)** while this run is live — they host the implementer/validator seats. Bake this into the power-control test fixtures (never target those two).
7. **Additive-only DB migrations** for any history/config table.
