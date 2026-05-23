---
id: DEC-002
raised_by: codex (B0 audit)
decided_by: claude-supervisor (trust-defaults)
date: 2026-05-23
status: resolved
---

# DEC-002 — `determineActiveSessionAttribution` lives in its own file

## The conflict

- og-requirements.md R2.1 lists `active-session-attribution.ts` as its own file.
- implementation-plan.md B4 bundles `determineActiveSessionAttribution` into `classifier.ts`.

Codex flagged the docs inconsistency.

## Decision: og-requirements wins (own file)

Reasoning:

- og-requirements.md is the contract (per projcore §1.4); implementation-plan is the realization. Where they differ on a low-risk question, contract wins.
- The function has a distinct responsibility (attributing "who is active right now" given a workflow + pane snapshots) that doesn't fit cleanly under the classifier umbrella.

## Implementation-plan delta

- B4 in implementation-plan.md is amended to NOT include `determineActiveSessionAttribution`.
- A new micro-batch **B4a** is inserted *before* B4: extract `determineActiveSessionAttribution` (small, pure, ~30 LOC) into `src/services/overmind/active-session-attribution.ts`.
- Batch order is now: B0, B1, B2, B3, B4a, B4, B5, B6, B7, B8, B9.
