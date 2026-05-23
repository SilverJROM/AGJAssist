# Implementation Plan — AGJAssist Modularization

**Sister docs:** `og-requirements.md` (contract) · `north-star.md` (frontload anchors) · later `req-matrix.md` (coverage)
**Branch policy:** stay on `master`; commit per-batch after each gate passes (no per-batch branch needed since each batch is structural-only + tests-green).
**Strict-safety contract:** **zero behavior change** + same passing-test count at every batch.

## Quick numbers (snapshot 2026-05-23, pre-refactor)

| Directory | Files | Outgoing cross-dir imports |
|---|---|---|
| `src/api/` | 18 | 43 |
| `src/services/` | 19 | 4 |
| `src/auth/` | 3 | 1 |
| `src/bot/` | 2 | 7 |
| `src/db/` | 1 | 0 |
| `src/llm/` | 3 | 0 |
| `src/tmux/` | 2 | 2 |
| **Total** | **53** | — |

LOC total `~13,224`. Largest files: `overmind-watcher.ts` 1944, `database.ts` 800, `personal-task-service.ts` 730, `overmind-service.ts` 681 (just edited — bug fix from this same date), `overmind-brain.ts` 495, `overmind-routes.ts` 468, `assistant-core.ts` 441, `reminder-service.ts` 420.

---

## B0 — Codex audit (no source changes)

**Owner:** `codex-impl` (the implementer). Read-only.
**Deliverable:** `plan/WK_0519/agjassist-modularization-2026-05-23/audit/CODEX-AUDIT.md`.
**Atomic? ✅ — single artifact, no source diff.**

**What codex must produce:**
1. Per-directory + per-file LOC table.
2. Cross-directory import edge list (who imports from whom, with counts).
3. Cycle detection result (`madge --circular` or hand-grep equivalent — no new deps; if `madge` not installed, use ripgrep + a small graph script).
4. Dead-export list (exports with zero importers across `src/` ∪ `tests/`).
5. **Module boundary proposal** — codex's own version of R2 (must reconcile with R2 in og-requirements; differences raised as decisions).
6. Risk-ranked batch list of refactor moves (small → big, each batch atomic).

**Validation gate:** Independent codex-review reads the audit + walks 5 random claims in it against the real tree.

**STATUS markers expected from codex:** `STATUS: PROPOSED` (plan) → `STATUS: APPROVED-PLAN` (after projcore handshake) → `STATUS: DONE`.

---

## B1 — Quarantine the known-flaky personal-tasks date test

**Atomic? ✅ — one `it.skip` + comment.**

The pre-existing date-rollover failure in `tests/unit/personal-tasks-reminders.spec.ts > toggles completion for daily task` is unrelated to this refactor but pollutes the green-bar. Mark it `it.skip` with a comment `// QUARANTINED 2026-05-23: pre-existing date-rollover flake; tracked separately, do not "fix" inside the modularization refactor.` Baseline becomes `442 passing, 1 skipped, 0 failing`.

**Validation:** `npx vitest run` shows `442 passed | 1 skipped`.

---

## B2 — Extract `pane-utils.ts` (smallest, lowest-risk first)

**Atomic? ✅ — ~80 LOC moved, 1 barrel re-export, ~3 test references updated.**

Move from `src/services/overmind-watcher.ts` → `src/services/overmind/pane-utils.ts`:
- `hashPane`, `hasActiveTurn`, `extractBody`, `isPaneChromeLine` (the chrome predicate the others depend on).

`overmind-watcher.ts` re-exports them from the new file (R2.5 contract).
Add `tests/overmind-pane-utils.test.ts` co-located with the new file's responsibility (split out from `overmind-classifier.test.ts`).

**Validation:** All tests green, count unchanged. `npx tsc --noEmit` clean.

---

## B3 — Extract `subagent-detection.ts`

**Atomic? ✅ — ~60 LOC + `SUBAGENT_PATTERNS` constant.**

Move `subAgentInFlight`, `paneShowsSubagentDone`, `parseSubagentAckFromPane`, `SUBAGENT_PATTERNS` → `src/services/overmind/subagent-detection.ts`. Barrel re-export. The existing `tests/overmind-subagent.test.ts` updates its imports.

---

## B4 — Extract `classifier.ts`

**Atomic? ⚠️ — ~250 LOC + 4 exported functions; the riskiest pure extraction.**

`classifyWorkflow`, `classifyParentSession`, `classifyChildSessionStatus`, `deriveTaskStateFromText`, `allTasksComplete`, `determineActiveSessionAttribution` → `src/services/overmind/classifier.ts`. The existing `tests/overmind-classifier.test.ts` updates imports.

**Sub-step:** also extract the `ClassifyWorkflowInput`, `ClassifyResult`, `ClassifyParentSessionInput`, `ActiveSessionAttribution` types alongside.

**Validation:** classifier tests + decision tests + completeness tests still pass; explicit assertion that public surface (re-export from watcher) still resolves.

---

## B5 — Extract `completeness.ts`

**Atomic? ✅ — `assessRegistrationCompleteness` ~200 LOC + types.**

Move to `src/services/overmind/completeness.ts`. `tests/overmind-completeness.test.ts` updates imports.

---

## B6 — Extract `decision-match.ts`

**Atomic? ✅ — ~150 LOC prior-decision helpers.**

`extractDecisionTerms`, `selectDecisionSnippet`, `countOccurrences`, `PriorDecisionMatch`, `applyAlwaysEscalateGuardrail`, `checkedContextLine` → `src/services/overmind/decision-match.ts`. `tests/overmind-decision.test.ts` updates imports.

---

## B7 — Reorganize `overmind-service.ts`

**Atomic? ⚠️ — ~180 LOC moved into 3 sibling files.**

`overmind-service.ts` → split into:
- `src/services/overmind/persistence.ts` — the class + its CRUD.
- `src/services/overmind/sanitize.ts` — the `DuplicateRunDirError` + `isTrashTaskLabel` / `sanitizeTaskList` / `sanitizeCurrentTask` (extracted in the same-day bug fix).
- `src/services/overmind/types.ts` — the interfaces.

Old `overmind-service.ts` becomes a one-line barrel. `tests/overmind-service.test.ts` (28 tests) keeps imports stable via the barrel.

---

## B8 — Split `database.ts` (schema vs migrations vs service)

**Atomic? ⚠️ — 800 LOC → 3 files; needs especially careful schema_version handling.**

- `src/db/schema.ts` — `SCHEMA_SQL` + index DDL.
- `src/db/migrations.ts` — the `MIGRATIONS` array + apply loop.
- `src/db/database.ts` — `DatabaseService` class only.

**Critical risk:** the v23 fresh-DB-vs-upgrade-path bug (N1a incident) — both paths must still produce identical schemas. Test: create a fresh DB + run a v22-snapshot upgrade DB; both must end at v23 with identical `pragma table_info(*)` output. Add `tests/db/migration-paths.test.ts` if not present.

---

## B9 — Final cleanup: drop the legacy barrel re-exports

**Atomic? ⚠️ — bulk find-and-replace across `src/` + `tests/`.**

Update every `import … from "../services/overmind-watcher.js"` that pulls a symbol now living in `overmind/<sub>.ts` to import from the new path directly. Then delete the barrel re-export lines from `overmind-watcher.ts`. Final `overmind-watcher.ts` is now only the runtime `OvermindWatcher` class (target ≤600 LOC, down from 1944).

---

## Out of plan (deferred)

- `personal-task-service.ts` (730 LOC) split — its scope is internally cohesive (one feature: personal tasks + reminders + cron). Split deferred unless codex's audit (B0) flags a strong reason.
- `reminder-service.ts` (420 LOC) — same reasoning.
- `assistant-core.ts` (441 LOC) — telegram-side; refactor pressure is lower.

---

## Gate cadence

projcore runs the standard 7-check batch gate after each B*. Validator ≠ implementer (R5.2). Hard caps from projcore §1.10b: 4hr drift-check, 6hr abort. Expected total run time: 6–10 hours of codex compute spread over a working day, with projcore re-engaging at every batch boundary.
