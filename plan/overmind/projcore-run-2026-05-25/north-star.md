# North-Star — Overmind Idle Detection Three-Path Refactor

**Locked:** 2026-05-25 (JROM greenlit after Claude + codex joint design review)
**Append-only.** Existing entries locked. Mid-run injections tagged `injected <date>`.

---

## Lifecycle
**pre-live** — deferral OFF. No TODOs, no follow-up shims, no dead code. All changes land in B1 or have an explicit queue row.

## Architecture: three paths, one cooldown key
Three nudge paths replace the old two-path overlapping system. All three share `unified_idle_nudge` cooldown key so they cannot double-fire. Codex and Claude both agreed on this design.

## PATH order + behavior
1. **PATH 1 (stuck, fast):** `status === "stuck"` → immediate nudge, cooldown = `stuck_nudge_cooldown_minutes` (20min), increments `nudge_count`, Tier-3 Brain after 2.
2. **PATH 2 (all-idle, medium):** parent not-working + all children idle/closed + 10min grace → unified nudge, cooldown = same 20min, does NOT increment `nudge_count`. Replaces old `subagent_ask`.
3. **PATH 3 (artifact fail-safe, slow):** artifacts stale ≥ 30min REGARDLESS of pane state → fail-safe nudge, cooldown = `unified_idle_threshold_minutes` (30min), does NOT increment `nudge_count`. Replaces `maybeAskForParentUpdate`.

## Settings decisions
- Rename `idle_nudge_cooldown_minutes` → `stuck_nudge_cooldown_minutes` with backward-compat load.
- Add `unified_idle_threshold_minutes` (default 30min).
- `evidence_read_cadence_minutes` untouched.
- `evidence_idle_threshold_override_minutes` on workflow DB record: keep as-is (PATH 3 per-workflow override).

## Scope guards
- No DB migration (reuse existing `evidence_idle_threshold_override_minutes` field).
- No changes to `STUCK_THRESHOLD_MS` (90s), `MAX_CANNED_NUDGES`, `SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS`.
- Tier-3 Brain logic: unchanged, just triggers from unified path.
- `applyDecisionInterception`, `RECONCILE_MS`, `evidence_read_cadence_minutes`: unchanged.

## Test strategy
Per-batch targeted: `npm test -- --testPathPattern="overmind-nudge|app-settings|nudge-state"` first, then full `npm test`. No E2E needed (pure TypeScript logic change).

## Topology
2-agent: projcore (coordinator+validator) + impl codex. Validator codex fires as B2 after B1 gate.

## Stop policy
3× FAIL on same batch → escalate to JROM. Hard cap: 90min on B1 (SHORT bucket).
