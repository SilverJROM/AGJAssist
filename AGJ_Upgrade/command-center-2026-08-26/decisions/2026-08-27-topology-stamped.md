# Decision — Topology stamped + validated (command-center effort)

Date: 2026-08-27 · logged by `[north]`

**`topology.yaml` stamped from JROM's explicit roster and passes `topology-validate.sh` (exit 0, rules 1-6).**
Execution mode = **tiller** (canonical, TILLER-USAGE.md 2026-08-26).

## Roster (JROM-confirmed)
- **Requirements:** north alone, from the locked `mockups/final/agent-window-v2.html`. Req-review panel **skipped** (the mockup IS the contract; low ambiguity) — recorded here per north-planning (a skip is a logged decision).
- **Planners:** grok46 + sol.
- **Approval:** codex55 (gpt-5.5) + north.
- **Coordinator (projcore):** grok46 — own session. **Fallback = sonnet5 if grok46 runs out of tokens** (JROM: "grok46 is healthy, just have sonnet5 act as backup").
- **Implementer:** L1 glimmer (lokalAI) → L2 terra → L3 sonnet5 → L4 sol.
- **Validator:** L1/L2 grok46 (own session ≠ projcore) → L3 codex55 → L4 opus5.
- **Integration:** sonnet5 default / opus5 for complex or the OVM teardown.
- **Deliberation (derived default):** opus5 + sol + sonnet5 + grok45, strict-unanimous, settle [opus5, sol].
- **Red-team (derived default):** budget / standard / elite.

## gpt-5.6 resolved (no codex needed)
From our own recent stamps (lkAsst 06-live-voice 2026-08-25, agent-usage.sh): **`sol` = `gpt-5.6-sol`**, **`terra` = `gpt-5.6-terra`** (named gpt-5.6 variants run via the codex CLI); **`codex55` = `gpt-5.5`**. (`codex exec` was too slow to answer live and was killed; the answer was already in-repo.)

## Overrides from tiller's canonical roster (noted, JROM-chosen)
- Coordinator = grok46 (doc default = cheap sonnet tier). JROM override + sonnet5 fallback.
- Implementer/validator ladders differ slightly from the doc's defaults — JROM's roster stamped as given.
- **grok46 dependency:** coordinator + validator L1/L2 ride grok46; doc warns "xAI balance exhausted → grok46 dry." JROM confirms grok46 healthy; sonnet5 fallback covers the coordinator.

## Pre-run wiring (north handles at handoff)
1. Add `gpt-5.6-sol` / `gpt-5.6-terra` to `src/config/providers.ts` (only `gpt-5.5` today).
2. Roster into `<run-dir>/run.env` (driver reads ONLY that).
3. Never run two local glimmer seats concurrently.
4. OVM teardown = **attended** tiller (high blast radius) + regression test after.
