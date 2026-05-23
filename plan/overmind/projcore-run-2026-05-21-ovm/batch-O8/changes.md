# Batch O8 Changes

Timestamp: 2026-05-21T13:20:06Z

## User Report

Batch O8 (IMPLEMENTER; /projcore from AGJ-51). Read plan/overmind/projcore-run-2026-05-21-ovm/prompts/batch-O8.md and follow EXACTLY. O8 = the DATA-DRIVEN proper detector: judge activity on the CONVERSATION BODY only (extractBody strips chrome/composer/status-bar/spinner/timer lines) + an active-turn check (esc to interrupt). WORKING = active-turn OR body-changed; IDLE = neither. Replaces the O7 normalize approach. ZERO LLM in the tick loop. MANDATORY handshake: STATUS: PROPOSED first, WAIT for APPROVED-PLAN. feat/overmind. Callback FIRST. Give me your PROPOSED plan now.

APPROVED-PLAN for O8. Proceed exactly as proposed (extractBody + hasActiveTurn, route ALL activity hashes through hashPane=hash(extractBody), WORKING=active-turn OR body-changed, keep everything else). Implement on feat/overmind, commit, gate (regression: chrome/timer-only drift with frozen body + no esc-to-interrupt → idle/stuck; active-turn → working; new body output → working; existing tests green; npx tsc; npm run build). Artifacts batch-O8/changes.md + test-report.md + independent-validation.md. Append callback FIRST ([projcore callback] O8 DONE <note>), THEN STATUS: DONE -- reason.

## Root Cause

The O7 activity detector normalized volatile pane chrome before hashing, but it still treated the pane as a single normalized text stream. Real samples showed pane-level changes were frequently chrome/status/timer drift rather than conversation progress. The detector needed a stricter split between conversation body and terminal chrome, plus a separate active-turn signal for in-progress work.

## Files Changed

- `src/services/overmind-watcher.ts`
  - Replaced `normalizePaneForActivity` with exported `extractBody(pane)`.
  - Added exported `hasActiveTurn(pane)` using `esc to interrupt`.
  - Routed `hashPane()` through `hash(extractBody(pane))`, so coordinator `last_pane_hash`, child hash maps, and post-nudge/post-decision/post-consult hash updates all use the body hash.
  - Updated workflow, parent, child, and active-session attribution logic so active turns count as working independently from body hash changes.
  - Kept run-dir mtime activity, stuck thresholds, nudge ladder, decision detection, waiting-human detection, completion checks, and brain calls unchanged.
- `tests/overmind-classifier.test.ts`
  - Replaced O7 normalization tests with `extractBody` and `hasActiveTurn` regressions.
  - Added active-turn-with-frozen-body coverage.
  - Updated timer-only drift regression to verify frozen body plus no active turn goes stuck.
- `tests/overmind-stream.test.ts`
  - Updated child status expectation so a child pane with `esc to interrupt` is `working` even if the body hash is unchanged.

## Autonomous Decisions

- Kept `mtimeAdvanced` as an existing non-pane workflow activity signal because the O8 change targets pane activity detection, and the brief said to keep the rest of the watcher behavior unchanged.
- Full `npm test` includes a live Ollama memory spec that failed because local model `qwek32k:latest` is unavailable. I treated that as an environment dependency and verified all non-live tests separately.
