# Batch B1 Validation — Three-Path Idle Refactor

**Verdict: PASS**
**Gate time:** 2026-05-25
**Impl duration:** 9m 23s (SHORT bucket, well within cap)
**Tests:** 33 suites, 482 passed, 1 skipped, 0 failed
**Build:** npm run build PASS

---

## 7-Gate Results

### 1. Artifact completeness — PASS (with note)
No `batch-B1/` folder (codex ran pre-projcore adoption, without batch-artifact discipline). Source code changes in-place, tests ran and passed. Impl spec at `ovm-idle-impl-spec.md` serves as the brief record. Acceptable for adopted in-flight batch.

### 2. Diff review — PASS
Files changed:
- `idle-detector.ts`: `maybeAskForParentUpdate` → `maybeFireArtifactFailsafe` + helpers. Correct scope. ✅
- `nudge-ladder.ts`: `idle_nudge` key → `unified_idle_nudge`, setting `idle_nudge_cooldown_minutes` → `stuck_nudge_cooldown_minutes`. nudge_count still increments. Tier-3 Brain intact. ✅
- `overmind-watcher.ts`: PATH 2 wired (apparentIdle + SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS + stuck_nudge_cooldown + unified_idle_nudge). `maybeFireArtifactFailsafe` imported and called (PATH 3). Old `subagent_ask` independent block removed — confirmed no `recordFired(..., "subagent_ask")` calls remain as independent firing path. ✅
- `app-settings-service.ts`: `stuck_nudge_cooldown_minutes` (renamed, backward-compat alias), `unified_idle_threshold_minutes` (new), deprecated constants aliased. ✅
- `app-settings-routes.ts`: backward-compat for old key names in PATCH body (idle_nudge_cooldown_minutes → stuck, ask_update_cooldown_minutes → unified). ✅
- `nudge-state-service.ts`: `lastUnifiedIdleNudgeAt` field, `getLastUnifiedIdleNudge` / `setLastUnifiedIdleNudge`. Old methods aliased to new (no external callers — safe stubs). ✅
- Tests: updated for renamed settings, new PATH 2/3 tests, cross-path cooldown block test, backward-compat test. ✅

### 3. Build verification — PASS
`npm run build` passed per impl codex report.

### 4. Targeted test pass — PASS
```
npm test tests/overmind-nudge.test.ts tests/app-settings-service.spec.ts tests/nudge-state-service.spec.ts → PASS
npm test (full suite) → 33 suites, 482 passed, 1 skipped, 0 failed
```

### 5. Evidence quality (7Q) — PASS

- **Q1 Scenario coverage:** PATH 2/3 tests exercise the actual condition paths (cooldown key checks, mtime stale simulation). ✅
- **Q2 Proof level:** TypeScript unit tests for pure logic change — appropriate level. No UI. ✅
- **Q3 Screenshots:** N/A — backend service logic only. ✅
- **Q4 Consistency:** All 3 paths have test coverage. Codex explicitly confirmed targeted + full suite pass. ✅
- **Q5 Requirement closure:** Fresh-eyes review: R1-R8 all observably addressed in source. ✅
- **Q6 Outcome not attempt:** Cooldown key gating tests assert the OUTCOME (nudge fires / does not fire) not just that a function was called. ✅
- **Q7 No illegal deferral:** `@deprecated` stubs on old NudgeStateService methods have NO external callers — they actively redirect to the unified method. Not dead code; safe backward-compat layer. Borderline but PASS.

### 6. Requirement coverage — PASS
R1 ✅ R2 ✅ R3 ✅ R4 ✅ R5 ✅ R6 ✅ R7 ✅ R8 ✅

### 7. Standing rules — PASS
- 1 decision logged: `decisions/2026-05-25-session-override.md`
- No scope creep beyond spec
- No ALWAYS-ESCALATE triggers hit
- Changes to API routes (backward-compat key aliases) are in-scope per R5

---

## Notes for B2 Validator
- Changes are uncommitted. Validator should commit before running final validation.
- `@deprecated` stubs on `getLastIdleNudge`/`setLastIdleNudge`/`getLastAskUpdateNudge`/`setLastAskUpdateNudge` — no external callers. Codex chose to keep as backward-compat aliases. Acceptable.
- `SUBAGENT_REASK_GRACE_MS` constant still exported from `subagent-detection.ts` — no longer used in watcher. Check if it should be removed (minor deferral risk if left as dead export).
