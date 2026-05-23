---
date: 2026-05-23
type: refactor / hygiene
status: deferred
handler: future-batch (out of WK_0519 modularization scope)
source: codex B0 audit during modularization run
qa_verification: required if/when attempted
---

# 2026-05-23 — services ↔ tmux directory-cycle hygiene

## JROM verbatim

(internal find by codex during AGJAssist modularization audit, not raised by JROM directly)

## What

`src/tmux/tmux-service.ts` + `src/tmux/tmux-stream-manager.ts` import from `src/services/safety-service.ts`. This makes the directory dependency `services ↔ tmux` bidirectional, even though no file-level import cycle exists.

## Why defer

DEC-001 of the modularization run: strict zero-behavior-change refactor leaves this for a follow-up. The cycle is structural-aesthetic, not behavioral.

## Proposed fix (when picked up)

Extract `safety-service.ts` (89 LOC, single class `SafetyService`) into a neutral home — `src/safety/safety-service.ts`. Update all 6 importers. Verify tests stay green.

Targeted estimate: 1 atomic batch, ~20 min.
