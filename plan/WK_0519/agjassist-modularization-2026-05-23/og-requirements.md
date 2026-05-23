# AGJAssist Modularization — Original Requirements

**Initiator:** JROM
**Date raised:** 2026-05-23
**Verbatim ask:** _"add after this fix is done a full audit of the code, and refactor it to be very modularized so that fixes on one module does not affect anything on another. have a full audit on this use codex, and perform a refactor → modularization and implement it with codex doing bulk of the work. and self register as well to overmind"_

**Locked-with-JROM decisions (before this file):**
- **Scope:** AGJAssist repo only. No cross-repo lift-out yet.
- **Driver:** `/projcore` + codex-in-tmux. Codex does the bulk of implementation; projcore enforces verifier ≠ fixer, atomic <30min slices.
- **Safety posture:** **Strict — zero behavior change.** All currently-passing tests stay passing at every batch boundary. The pre-existing `personal-tasks-reminders.spec.ts > toggles completion for daily task` flake gets quarantined (skip with comment), not "fixed" inside this work.
- **Self-register to overmind:** projcore registers this run via `POST /api/overmind/register` on Phase 0 so the dashboard reflects the refactor as a live workflow.

---

## R1 — Full audit, by codex, written.

`R1.1` Codex runs a static analysis of `src/` (53 files, ~13,200 LOC) and produces `audit/CODEX-AUDIT.md` covering:
- Per-directory file count + LOC + outgoing cross-dir imports (data, not opinion).
- Per-file responsibility tags. Flag any file >500 LOC.
- Coupling hotspots: which symbols are imported from >3 places.
- Hidden cycles (madge-style) between `services/` ↔ `api/` ↔ `db/`.
- Dead code (exports with zero importers).
- A risk-ranked module-boundary proposal for the actual refactor batches.

`R1.2` Audit is **read-only** — no source files changed in this phase. Codex writes only under `plan/WK_0519/agjassist-modularization-2026-05-23/audit/`.

`R1.3` projcore validates the audit against this file (R-coverage); only then does it greenlight the implementation batches.

## R2 — Module boundaries with single-direction dependencies.

`R2.1` After R1, codex extracts the **`src/services/overmind-watcher.ts`** monolith (1944 LOC) into focused submodules. Target shape — **all pure / unit-testable**, no DB/tmux dependencies inside them:
- `src/services/overmind/classifier.ts` — `classifyWorkflow`, `classifyParentSession`, `classifyChildSessionStatus`, `deriveTaskStateFromText`, `allTasksComplete`.
- `src/services/overmind/pane-utils.ts` — `hashPane`, `hasActiveTurn`, `extractBody`, `isPaneChromeLine`.
- `src/services/overmind/subagent-detection.ts` — `subAgentInFlight`, `paneShowsSubagentDone`, `parseSubagentAckFromPane`, `SUBAGENT_PATTERNS`.
- `src/services/overmind/completeness.ts` — `assessRegistrationCompleteness` + its types.
- `src/services/overmind/decision-match.ts` — `extractDecisionTerms`, `selectDecisionSnippet`, prior-decision matching helpers.
- `src/services/overmind/active-session-attribution.ts` — `determineActiveSessionAttribution`.
- `src/services/overmind-watcher.ts` keeps **only** the `OvermindWatcher` runtime class + `OvermindNotify` / `OvermindUpdate` types. Targets ≤600 LOC.

`R2.2` `src/services/overmind-service.ts` (681 LOC) is split into:
- `src/services/overmind/persistence.ts` — the `OvermindService` class, register/list/get/update/setTasks/setStatus.
- `src/services/overmind/sanitize.ts` — `DuplicateRunDirError`, `isTrashTaskLabel`, `sanitizeTaskList`, `sanitizeCurrentTask` (already extracted helpers; just move them into a named file).
- `src/services/overmind/types.ts` — `OvermindWorkflow`, `OvermindTask`, `RegisterOvermindWorkflowInput`, etc.

`R2.3` `src/api/routes/` — no behavior changes; route files only re-import from the new submodule paths. **No route file gains or loses an endpoint in this refactor.**

`R2.4` `src/db/database.ts` (800 LOC) — schema/migration block split into `src/db/schema.ts` + `src/db/migrations.ts`; the `DatabaseService` class stays as the single public surface.

`R2.5` **Public surface lock.** Every named export consumed by another `src/` file or `tests/` file remains available from its old path via a barrel re-export. This is the strict-safety contract: `import { X } from "../services/overmind-watcher.js"` keeps working even if `X` physically lives in `overmind/classifier.ts`. Final cleanup pass (R6) can remove the re-exports once all call sites are updated.

## R3 — Tests preservation contract.

`R3.1` `npx vitest run` reports the **same passing test count** at every batch's end-state as at this batch's start-state. The pre-existing personal-tasks date flake is quarantined (see header) and excluded from the count.

`R3.2` `npx tsc --noEmit` is clean at every batch boundary.

`R3.3` Existing test files are moved/renamed only when the file under test is moved/renamed; no test file may be deleted in this refactor. (Adding new tests for newly-split modules is allowed and encouraged.)

## R4 — No new dependencies, no runtime config change.

`R4.1` `package.json` `dependencies` + `devDependencies` unchanged. The refactor is structural, not feature.

`R4.2` `pm2 restart agjassist` + a `GET /api/health → 200` smoke is the deploy gate at each batch.

## R5 — Codex carries the load; projcore supervises.

`R5.1` Pattern: codex-in-tmux. The implementer is `codex exec` with sonnet-cost / opus-on-escalation per projcore-routing.md.

`R5.2` 3-agent topology selectable (coordinator ≠ implementer ≠ validator). 2-agent default; auto-escalate to 3 per task per projcore §1.14.

`R5.3` Atomic slice rule (projcore §1.4c): every non-test task <30 min. Refactor batches are naturally atomic — one symbol family per batch.

## R6 — Self-register to overmind.

`R6.1` On Phase 0 of the projcore run, projcore POSTs `/api/overmind/register` with `{ label: "AGJAssist · modularization refactor", session: "<projcore-tmux-session>", run_dir: "/home/agjrom/TGBOTS/AGJAssist/plan/WK_0519/agjassist-modularization-2026-05-23/projcore-run-2026-05-23", tasks: [batch-1, batch-2, …] }` so the dashboard shows this work live.

`R6.2` Per-batch `/api/overmind/tasks` updates at every gate.

`R6.3` `/api/overmind/complete` on Phase 3 hand-back.

---

## Out of scope (named explicitly)

- Behavioral fixes (bug fixes, perf wins). If codex discovers a bug while moving code, it files a `plan/<wk>/list/<date>-<slug>.md` entry and continues; the fix lands in a separate post-refactor task.
- Dependency upgrades.
- Frontend refactor (`src/web/` is a no-build vanilla Preact/HTM tree — leave it alone).
- Schema migrations. The DB layer is reorganized but the SQL stays identical.
- Removing the chat decommission leftovers — already done in WK_0519 chat-notes run.

---

## Acceptance gate

All R rows above are `VERIFIED` on `req-matrix.md`. `npx vitest run` count matches baseline (modulo the documented quarantine). `npx tsc --noEmit` clean. `pm2 logs agjassist --lines 50` shows boot + serving traffic. Overmind dashboard's "AGJAssist · modularization refactor" workflow is `completed`.
