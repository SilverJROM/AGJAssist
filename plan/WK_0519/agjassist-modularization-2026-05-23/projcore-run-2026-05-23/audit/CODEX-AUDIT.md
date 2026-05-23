# CODEX Audit — AGJAssist Modularization

Audit date: 2026-05-23 (UTC)  
Scope: `src/**/*.ts`, importer checks across `src/**/*.ts` + `tests/**/*.ts`  
Mode: read-only audit

## 1) Per-directory + per-file LOC table

Command basis: `find src -name "*.ts" | sort | xargs wc -l`

### Per-directory LOC summary

| Directory | Files | LOC |
|---|---:|---:|
| `(root)` | 1 | 253 |
| `api` | 18 | 2968 |
| `auth` | 3 | 442 |
| `bot` | 2 | 619 |
| `cli` | 1 | 164 |
| `config` | 1 | 116 |
| `db` | 1 | 800 |
| `llm` | 3 | 378 |
| `services` | 19 | 6758 |
| `startup` | 1 | 153 |
| `tmux` | 2 | 459 |
| `tools` | 1 | 114 |
| **Total** | **53** | **13224** |

### Per-file LOC (`>500 LOC` tagged)

| LOC | File | Tag |
|---:|---|---|
| 19 | `src/api/routes/agent-routes.ts` |  |
| 67 | `src/api/routes/app-settings-routes.ts` |  |
| 32 | `src/api/routes/audit-routes.ts` |  |
| 140 | `src/api/routes/auth-routes.ts` |  |
| 121 | `src/api/routes/delegation-routes.ts` |  |
| 246 | `src/api/routes/file-routes.ts` |  |
| 174 | `src/api/routes/note-routes.ts` |  |
| 468 | `src/api/routes/overmind-routes.ts` |  |
| 396 | `src/api/routes/personal-task-routes.ts` |  |
| 199 | `src/api/routes/plan-routes.ts` |  |
| 83 | `src/api/routes/project-routes.ts` |  |
| 176 | `src/api/routes/reminder-routes.ts` |  |
| 75 | `src/api/routes/safety-routes.ts` |  |
| 128 | `src/api/routes/task-routes.ts` |  |
| 187 | `src/api/routes/template-routes.ts` |  |
| 237 | `src/api/routes/tmux-routes.ts` |  |
| 145 | `src/api/server.ts` |  |
| 75 | `src/api/websocket/overmind-stream-manager.ts` |  |
| 43 | `src/auth/auth-middleware.ts` |  |
| 347 | `src/auth/auth-service.ts` |  |
| 52 | `src/auth/telegram-auth.ts` |  |
| 441 | `src/bot/assistant-core.ts` |  |
| 178 | `src/bot/telegram-bot.ts` |  |
| 164 | `src/cli/agent-cli-runner.ts` |  |
| 116 | `src/config/config.ts` |  |
| 800 | `src/db/database.ts` | `>500 LOC` |
| 253 | `src/index.ts` |  |
| 9 | `src/llm/base-provider.ts` |  |
| 191 | `src/llm/claude-cli-provider.ts` |  |
| 178 | `src/llm/codex-cli-provider.ts` |  |
| 28 | `src/services/agent-registry-service.ts` |  |
| 147 | `src/services/app-settings-service.ts` |  |
| 98 | `src/services/audit-service.ts` |  |
| 167 | `src/services/delegation-service.ts` |  |
| 317 | `src/services/file-service.ts` |  |
| 347 | `src/services/note-service.ts` |  |
| 97 | `src/services/nudge-state-service.ts` |  |
| 495 | `src/services/overmind-brain.ts` |  |
| 73 | `src/services/overmind-notifications.ts` |  |
| 681 | `src/services/overmind-service.ts` | `>500 LOC` |
| 1944 | `src/services/overmind-watcher.ts` | `>500 LOC` |
| 309 | `src/services/ovm-session.ts` |  |
| 730 | `src/services/personal-task-service.ts` | `>500 LOC` |
| 291 | `src/services/plan-service.ts` |  |
| 111 | `src/services/project-service.ts` |  |
| 420 | `src/services/reminder-service.ts` |  |
| 89 | `src/services/safety-service.ts` |  |
| 220 | `src/services/step-template-service.ts` |  |
| 194 | `src/services/task-service.ts` |  |
| 153 | `src/startup/telegram-resilience.ts` |  |
| 285 | `src/tmux/tmux-service.ts` |  |
| 174 | `src/tmux/tmux-stream-manager.ts` |  |
| 114 | `src/tools/tool-registry.ts` |  |

## 2) Cross-directory import edge list

Method: parsed relative `import ... from`, `export ... from`, and `import(...)` in `src/**/*.ts`, resolved to top-level `src/*` directory, counted as unique `(importer-file, import-specifier)` statements.

### Edge counts (from dir -> to dir)

| From | To | Unique import statements |
|---|---|---:|
| `api` | `auth` | 34 |
| `api` | `config` | 2 |
| `api` | `db` | 2 |
| `api` | `services` | 37 |
| `api` | `tmux` | 5 |
| `auth` | `db` | 1 |
| `bot` | `auth` | 1 |
| `bot` | `config` | 1 |
| `bot` | `services` | 4 |
| `bot` | `tmux` | 1 |
| `services` | `db` | 11 |
| `services` | `llm` | 2 |
| `services` | `tmux` | 2 |
| `tmux` | `auth` | 1 |
| `tmux` | `services` | 2 |
| `tools` | `config` | 1 |
| `tools` | `tmux` | 1 |

### Outgoing cross-dir import totals per `src/*`

| Directory | Outgoing cross-dir imports |
|---|---:|
| `api` | 80 |
| `auth` | 1 |
| `bot` | 7 |
| `cli` | 0 |
| `config` | 0 |
| `db` | 0 |
| `llm` | 0 |
| `services` | 15 |
| `startup` | 0 |
| `tmux` | 3 |
| `tools` | 2 |
| `web` | 0 |

## 3) Cycle detection

Method:
- Built a file-level directed graph from relative imports (`src/**/*.ts` only).
- Performed transitive-closure walk in awk and checked for bidirectional reachability pairs.

Result:
- No file-level cycle pairs detected from parsed edges.

Structural surprise at module-boundary level:
- There is a **directory-level mutual dependency** `services <-> tmux`:
  - `src/services/overmind-watcher.ts` imports `../tmux/tmux-service.js`
  - `src/services/ovm-session.ts` imports `../tmux/tmux-service.js`
  - `src/tmux/tmux-service.ts` imports `../services/safety-service.js`
  - `src/tmux/tmux-stream-manager.ts` imports `../services/safety-service.js`

Interpretation:
- Even without a direct file-to-file cycle, this is a boundary-cycle smell and conflicts with the single-direction dependency intent in R2.

## 4) Dead-export list

Method:
- Enumerated local `export` declarations matching `export (class|interface|type|const|function)` across `src/**/*.ts`.
- Checked named-import usage (`import { ... }`) across `src/**/*.ts` and `tests/**/*.ts`.
- Reported symbols with zero importers from other files.

Counts:
- Total exports scanned: `201`
- Zero-importer exports found: `136`

Zero-importer exports:

- `src/api/routes/overmind-routes.ts`: `isLoopbackAddress`
- `src/api/server.ts`: `ApiServices`
- `src/auth/auth-service.ts`: `AuthResult`
- `src/cli/agent-cli-runner.ts`: `AgentCliRunner`, `DefaultAgentCliRunner`
- `src/llm/codex-cli-provider.ts`: `CodexCliProvider`
- `src/services/agent-registry-service.ts`: `AgentInfo`
- `src/services/app-settings-service.ts`: `DEFAULT_IDLE_NUDGE_COOLDOWN_MIN`, `DEFAULT_TASK_STALE_ASK_COOLDOWN_MIN`, `DEFAULT_TASK_STALE_RECENT_UPDATE_GRACE_MIN`
- `src/services/audit-service.ts`: `AuditEntry`, `AuditLogParams`, `AuditQueryFilters`
- `src/services/delegation-service.ts`: `AuthorityLevel`, `Delegation`
- `src/services/file-service.ts`: `BinaryFileError`, `FileContent`, `FileEntry`, `FileExistsError`, `FileNotFoundError`, `FileTooLargeError`, `PathTraversalError`
- `src/services/note-service.ts`: `Note`, `NoteFolder`
- `src/services/overmind-brain.ts`: `ALWAYS_ESCALATE_KEYWORDS`, `BrainVerdict`, `BrainVerdictAction`, `CompletionInput`, `CompletionVerdict`, `CompletionVerdictAction`, `DEFAULT_COMPLETION_CONSULT_TEXT`, `DecisionInput`, `DecisionVerdict`, `DecisionVerdictAction`, `OvermindBrain`, `RegistrationReviewAction`, `RegistrationReviewInput`, `RegistrationReviewVerdict`, `StuckInput`, `hasAlwaysEscalateKeyword`
- `src/services/overmind-notifications.ts`: `OVERMIND_AGENT`, `OVERMIND_PROJECT`, `OvermindNotificationWorkflow`, `UnresolvedNotificationInput`, `buildBlockedNotification`, `buildNeedsInputNotification`
- `src/services/overmind-service.ts`: `OvermindChildSessionStatus`, `OvermindChildStatus`, `OvermindParentStatus`, `OvermindTask`, `OvermindTaskHistoryEntry`, `OvermindTaskLogEntry`, `OvermindTaskState`, `RegisterOvermindWorkflowInput`, `RunSummary`, `UpdateOvermindWorkflowInput`
- `src/services/overmind-watcher.ts`: `ALL_DONE_CONFIRM_NUDGE`, `ActiveSessionAttribution`, `BRAIN_COORDINATOR_TAIL_LINES`, `BRAIN_RUN_FILE_TAIL_LINES`, `CANNED_NUDGE`, `CANNED_NUDGE_NO_CHILD`, `CAPTURE_LINES`, `ClassifyParentSessionInput`, `ClassifyResult`, `ClassifyWorkflowInput`, `CompletenessInput`, `CompletenessResult`, `DECISION_HANDLED_TIER`, `EMPTY_TASKLIST_GRACE_MS`, `FRONTLOAD_CORRECTION_NOTE`, `MAX_CANNED_NUDGES`, `OvermindUpdate`, `PRIOR_DECISION_CONTEXT_CHAR_LIMIT`, `PRIOR_DECISION_FILE_CHAR_LIMIT`, `PRIOR_DECISION_MAX_FILES`, `SONNET_TASK_CMD`, `SPARK_TASK_CMD`, `SPARK_TASK_FALLBACK_PER_HOUR`, `STALE_THRESHOLD_MS`, `STUCK_THRESHOLD_MS`, `SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS`, `SUBAGENT_DURATION_GRACE_MS`, `SUBAGENT_PATTERNS`, `SUBAGENT_REASK_GRACE_MS`, `TASK_RECENT_UPDATE_GRACE_MS`, `TASK_STALE_CHECK_MS`, `TASK_STALE_NAG_COOLDOWN_MS`, `allTasksComplete`, `assessRegistrationCompleteness`, `classifyChildSessionStatus`, `classifyParentSession`, `classifyWorkflow`, `collectPriorDecisions`, `deriveTaskStateFromText`, `determineActiveSessionAttribution`, `extractBody`, `invokeJudgeWithFallback`, `paneShowsSubagentDone`, `parseSubagentAckFromPane`, `subAgentInFlight`
- `src/services/ovm-session.ts`: `OVM_SEND_FALLBACK`, `OVM_SEND_POLL_MS`, `OVM_SEND_STABLE_READS`, `OVM_SEND_SYNC_TIMEOUT_MS`, `OvmOpenResult`, `OvmReplyDone`, `OvmReplyPending`, `OvmSendResult`, `OvmSessionStatus`
- `src/services/personal-task-service.ts`: `PersonalTask`, `PersonalTaskItem`, `PersonalTaskWithStatus`
- `src/services/plan-service.ts`: `Plan`, `PlanStep`, `PlanWithSteps`
- `src/services/project-service.ts`: `Project`, `ProjectWithCounts`
- `src/services/reminder-service.ts`: `Reminder`, `ReminderAlert`, `ReminderWithAlerts`
- `src/services/safety-service.ts`: `SafetyPattern`
- `src/services/step-template-service.ts`: `StepTemplate`, `StepTemplateItem`, `StepTemplateWithItems`
- `src/services/task-service.ts`: `Task`, `TaskExecution`
- `src/startup/telegram-resilience.ts`: `TelegramStarter`, `formatError`, `installTelegramProcessGuards`, `isTelegramNetworkError`, `startTelegramNonFatal`
- `src/tmux/tmux-service.ts`: `SendCommandResult`, `TmuxPane`
- `src/tools/tool-registry.ts`: `ToolAction`, `ToolRegistry`

Caveat:
- This dead-export pass is syntactic and conservative toward named imports; namespace/default/dynamic patterns may hide some real usage. Treat this as candidate cleanup list, not deletion-ready list.

## 5) Module boundary proposal (R2 reconciliation)

### Proposed boundaries (aligned with R2)

1. `src/services/overmind-watcher.ts` split into pure helper modules:
- `src/services/overmind/classifier.ts`
- `src/services/overmind/pane-utils.ts`
- `src/services/overmind/subagent-detection.ts`
- `src/services/overmind/completeness.ts`
- `src/services/overmind/decision-match.ts`
- `src/services/overmind/active-session-attribution.ts`

2. `src/services/overmind-service.ts` split into:
- `src/services/overmind/persistence.ts`
- `src/services/overmind/sanitize.ts`
- `src/services/overmind/types.ts`

3. `src/db/database.ts` split into:
- `src/db/schema.ts`
- `src/db/migrations.ts`
- `src/db/database.ts` retaining `DatabaseService` as public surface

4. Route stability lock (`src/api/routes/*`): endpoints unchanged; import-path rewiring only.

5. Public surface lock: keep backward-compatible re-exports at old paths until final cleanup.

### Differences vs current implementation-plan.md (B2–B9) and decision candidates

- `DEC-001 (new)` — Break `services <-> tmux` boundary cycle early.  
  Proposal: extract safety-check contract from `services/safety-service.ts` into a neutral module (`src/safety/` or `src/utils/safety/`) and inject into tmux layer, so `tmux` no longer imports from `services`.

- `DEC-002 (alignment)` — Keep `determineActiveSessionAttribution` in `active-session-attribution.ts` (per R2), not bundled into `classifier.ts` (as currently stated in B4).

## 6) Risk-ranked batch list (smallest/lowest-risk first, reconciled with B2–B9)

1. **B2** `pane-utils.ts` extraction (low risk, pure functions, small surface).
2. **B3** `subagent-detection.ts` extraction (low risk, pure helpers/constants).
3. **B5** `completeness.ts` extraction (low-medium risk, pure logic + types).
4. **B6** `decision-match.ts` extraction (low-medium risk, pure logic).
5. **B4a (inserted by DEC-002)** `active-session-attribution.ts` extraction (small pure slice).
6. **B4** `classifier.ts` extraction (medium risk due broad call-site impact).
7. **B7** `overmind-service.ts` split into persistence/sanitize/types (medium-high risk because state and persistence APIs).
8. **B8** `database.ts` split (high risk; migration-path integrity risk).
9. **B9** remove legacy re-export compatibility shims (medium-high risk bulk import rewiring).
10. **B-cycle (inserted by DEC-001)** eliminate `services <-> tmux` boundary cycle before or alongside B7/B8 to enforce single-direction dependency rule.

### Reconciliation notes to B2–B9

- B2/B3/B5/B6 ordering remains compatible and lowest risk.
- B4 should be split into `B4a + B4` to align exactly with R2 (`active-session-attribution.ts` separate).
- B7/B8/B9 remain valid but should include explicit cycle-break gating from `DEC-001`.

## Structural surprise requiring decision

Detected module-boundary mutual dependency: `services <-> tmux`.

This is a real architectural coupling risk against R2 single-direction dependency intent and should be explicitly resolved in the batch plan before final cleanup.

STATUS: NEEDS-DECISION
