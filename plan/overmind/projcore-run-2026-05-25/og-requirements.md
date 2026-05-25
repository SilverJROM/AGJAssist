# OG Requirements — Overmind Idle Detection Three-Path Refactor

**Source:** Design conversation 2026-05-25 (Claude + codex/GPT-5.5 joint recommendation, JROM-greenlit)
**Branch:** `codex/overmind-idle-three-path-refactor`
**Spec:** `plan/overmind/projcore-run-2026-05-25/../../ovm-idle-impl-spec.md` (full impl brief)
**Project:** AGJAssist (`/home/agjrom/TGBOTS/AGJAssist`)

---

## R1 — Unified shared cooldown key

All three nudge paths (stuck, all-idle, artifact fail-safe) MUST use the single cooldown key `unified_idle_nudge` in both `WatcherCooldowns` and `NudgeStateService`. The three legacy keys `idle_nudge`, `ask_update`, and `subagent_ask` are retired as independent firing paths.

## R2 — PATH 1: Stuck response (immediate)

When `classifyWorkflow` returns `status === "stuck"` (pane unchanged 90s), AND no subagent in flight, AND not terminal/paused: fire the canned nudge. Cooldown: `stuck_nudge_cooldown_minutes` (default 20min, renamed from `idle_nudge_cooldown_minutes`) via `unified_idle_nudge` key. Increment `nudge_count`. Tier-3 Brain escalation after 2 canned nudges unchanged.

## R3 — PATH 2: All sessions idle (pane-based, 10min grace)

When parentStatus !== "working" AND all child statuses idle/closed, AND no subagent in flight, AND not terminal/paused: fire unified idle message after ≥ `SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS` (10min). Cooldown: `stuck_nudge_cooldown_minutes` (20min) via `unified_idle_nudge`. Does NOT increment `nudge_count`. Old `subagent_ask` block and `SUBAGENT_REASK_GRACE_MS` retired. Unified message includes subagent ack pattern.

## R4 — PATH 3: Artifact fail-safe (30min, evidence-based, fires regardless of pane state)

When `MAX(last_parent_update_at, progress.md, callbacks.md, queue.md mtimes)` stale ≥ `unified_idle_threshold_minutes` (default 30min), fire fail-safe nudge. Cooldown: `unified_idle_threshold_minutes` via `unified_idle_nudge`. Does NOT increment `nudge_count`. Replaces `maybeAskForParentUpdate`. Respects `evidence_idle_threshold_override_minutes` per-workflow override (existing DB field).

## R5 — Settings renamed/added in app-settings-service.ts

- `idle_nudge_cooldown_minutes` → `stuck_nudge_cooldown_minutes` (default 20min, backward-compat load)
- `unified_idle_threshold_minutes` added (default 30min)
- `DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN` and `DEFAULT_STUCK_NUDGE_COOLDOWN_MIN` exported
- `evidence_read_cadence_minutes` unchanged
- `evidence_idle_threshold_minutes` deprecated alias → resolves to `unified_idle_threshold_minutes`

## R6 — NudgeStateService unified key

Add `lastUnifiedIdleNudgeAt` field, `getLastUnifiedIdleNudge`/`setLastUnifiedIdleNudge` methods. Old methods removed or aliased.

## R7 — On-deploy legacy seed (no burst on existing workflows)

When `unified_idle_nudge` key is unset, seed from `MAX(lastFired("idle_nudge"), lastFired("ask_update"), lastFired("subagent_ask"))` to prevent a burst on first deploy.

## R8 — Tests pass (npm test exits 0)

Existing tests updated for renamed settings and retired keys. New tests cover:
- PATH 2 all-idle fires after 10min grace, uses shared cooldown
- PATH 3 fires even when pane appears "working" (artifact-only staleness)
- Cross-path: PATH 1 at t=0 blocks PATH 2 within stuck_nudge_cooldown window
- Backward-compat: old JSON key `idle_nudge_cooldown_minutes` loads as `stuck_nudge_cooldown_minutes`
