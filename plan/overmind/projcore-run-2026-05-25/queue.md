# Queue — Overmind Idle Detection Three-Path Refactor

**Run:** projcore-run-2026-05-25
**Status:** B1 IN-FLIGHT (codex impl already running, adopted at projcore start)

---

## B1 — Three-path idle refactor (IN-FLIGHT)

**Req#s:** R1, R2, R3, R4, R5, R6, R7, R8
**Implementer session:** agj-ovm-idle-impl
**Branch:** codex/overmind-idle-three-path-refactor
**Bucket:** SHORT (atomic, ~25min)
**dispatched_at:** 2026-05-25T (pre-projcore — impl adopted in-flight)
**estimate_min:** 25

Files: idle-detector.ts, nudge-ladder.ts, overmind-watcher.ts, app-settings-service.ts, nudge-state-service.ts, workflow-cleanup.ts + tests

Note: This batch was dispatched before projcore was invoked. Codex already branched and is implementing. Projcore adopted it at register time. Phase 0.5 handshake was performed via design conversation (Claude + GPT-5.5 joint review, JROM greenlit).

---

## B2 — Validation (pending B1 DONE)

**Req#s:** R1-R8
**Validator session:** agj-ovm-idle-val
**Bucket:** SHORT (~15min)
**Status:** PENDING (fires after B1 DONE + projcore gate PASS)
