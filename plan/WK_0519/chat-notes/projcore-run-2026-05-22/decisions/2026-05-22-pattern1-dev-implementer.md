---
date: 2026-05-22
project: AGJAssist
type: autonomous-call
trigger: JROM directed "give the work to sonnet as the implementer and not codex"
source: projcore
priority: high
search_hooks: [pattern-1, sonnet implementer, dev not lead, codex override, in-process agent]
---

**Question/decision:** JROM overrode projcore's codex-in-tmux default for this run ("sonnet as the implementer and not codex and your consultation partner as well"). projcore.md §1.7 deprecates Pattern 1 and §2.4/Step 5 say dispatch `/lead`. How to realize "Sonnet implementer" in-process?

**Decision (autonomous):** Run Pattern 1 (in-process Agent dispatch) with the **`[dev]` persona on Sonnet** as the per-batch implementer (not `/lead`). Rationale: `/lead` is an autonomous-complete orchestrator that runs its own multi-batch dev→qa→reviewer pipeline, which conflicts with projcore's one-batch-at-a-time gating; `[dev]` is the atomic builder, the faithful "implementer" role. projcore (Opus) keeps verifier≠fixer — does independent validation/7-gate itself, spawns a fresh Sonnet validator where warranted. Consultation = Sonnet sub-agents as needed.

**Default projcore would have made:** codex-in-tmux `$lead`. Overridden by explicit JROM instruction.

**Promotion target:** projcore.md §1.7 / §2.4 — note a sanctioned "Pattern 1 / Sonnet-dev" lane when JROM explicitly requests Sonnet implementer.
**Generalization candidate:** When JROM says "Sonnet implements," map to in-process `[dev]`-on-Sonnet + projcore-as-validator, not nested `/lead`.
