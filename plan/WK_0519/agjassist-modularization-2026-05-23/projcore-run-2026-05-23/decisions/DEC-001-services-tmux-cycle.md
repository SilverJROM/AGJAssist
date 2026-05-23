---
id: DEC-001
raised_by: codex (B0 audit)
decided_by: claude-supervisor (trust-defaults)
date: 2026-05-23
status: resolved
---

# DEC-001 — `services ↔ tmux` boundary cycle: defer

## The surprise

`src/tmux/tmux-service.ts` and `src/tmux/tmux-stream-manager.ts` import from `src/services/safety-service.ts`, while `src/services/overmind-watcher.ts` and `src/services/ovm-session.ts` import from `src/tmux/`. Directory-level mutual dependency.

## Decision: defer — out of scope of this refactor

Reasoning:

- **og-requirements safety posture is "strict zero behavior change."** Moving `safety-service.ts` out of `services/` would force every consumer of safety to update imports, which is bulk scope outside R2.1–R2.5.
- The cycle is **directory-level, not file-level** — no actual import cycle exists at the file graph (codex's section 3 confirms zero file-level cycles). So this is an aesthetic violation of R2's "single-direction" intent, not a build/runtime bug. Master has shipped fine with this shape for months.
- This refactor's job is to dismantle the `overmind-watcher.ts` monolith and the `database.ts` god-file. Adding a cross-tree safety relocation here triples the risk surface for zero behavioral payoff.

## Follow-up filed

A new entry will be added to `plan/WK_0519/list/2026-05-23-services-tmux-cycle.md` for a separate, future task:
> Extract `safety-service.ts` into a neutral module (proposal: `src/safety/safety-service.ts`) so `tmux/` no longer imports from `services/`. Single-direction-dependency hygiene.

## Implementation-plan delta

- B-cycle (codex's proposed insertion) → REJECTED for this run.
- Implementation plan B2–B9 unchanged.
