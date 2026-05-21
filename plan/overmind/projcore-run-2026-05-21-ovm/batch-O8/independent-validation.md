# Batch O8 Independent Validation

Timestamp: 2026-05-21T13:20:06Z

## Acceptance Check

1. `extractBody` and `hasActiveTurn` are exported pure helpers.
   - PASS: both helpers are exported from `src/services/overmind-watcher.ts`.
2. Activity/change uses body hash and active-turn OR body-changed semantics.
   - PASS: `hashPane()` hashes `extractBody(pane)`, and workflow/parent/child classification treats `hasActiveTurn(pane)` as working even when the body hash is unchanged.
3. Idle pane with frozen body and chrome drift becomes idle/stuck after threshold.
   - PASS: classifier regression verifies timer/monitor drift does not change body hash and classifies stuck past threshold when no active turn exists.
4. Active-turn or growing body becomes working.
   - PASS: regressions cover both `esc to interrupt` and new body output.
5. Zero LLM calls in the tick loop for activity detection.
   - PASS: activity detection remains deterministic. Existing completion/decision/Tier-3 brain paths were not expanded and are still outside the initial activity classification check.
6. TypeScript/build gate.
   - PASS: `npx tsc` and `npm run build` passed.

## Scope Review

The implementation is limited to O8 activity detection and associated tests. It does not alter stuck thresholds, nudge ladder constants, waiting-human detection, decision detection, notification plumbing, completion checks, or brain prompt behavior.

## Residual Risk

`extractBody` follows the brief's broad line-stripping rule for lines containing `Waiting for`, `Thinking`, `Compacting`, and `Working (`. That is intentionally deterministic, but it may strip a real conversation line if the line exactly resembles terminal progress chrome.
