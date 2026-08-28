# C3 validator red-team a1

Commit under test: `1f87fe287aa4a783508ac69f8a402d430ebf3c84`

Scope authority: C5 text was absent from `og-requirements.md` in the driver brief, so I treated the C3 scope text as the authority: `fireDue` must resolve current group panes, skip excluded agents, pass every solicit through existing `SafetyService` plus `TmuxService`, write `AuditService`, and advance/deactivate repeats with the Mini App closed.

Focused test:

- `node scripts/cc-run-isolated.mjs --slice C3 -- npx vitest run tests/unit/agent-reminder-scheduler.spec.ts --minWorkers=1 --maxWorkers=4`
- Result: PASS, 3 tests.

Red-team lenses:

1. User isolation: FAIL. `fireDue(userId, folderGroup?)` calls `getDueReminders()` and only filters by `folder_group`, so due reminders belonging to other users can be sent and advanced under the caller's `userId`.
2. Current group pane resolution: FAIL. The scheduler reads `groupMeta.sessions` into `sessionNames` but never uses it. Any listed pane whose tmux session equals an included recipient can receive the solicit even if that session is no longer in the reminder's current folder group.
3. Include/skip: PASS for explicit excluded recipients. The implementation filters `recipient.include === 1`, and the focused test asserts the excluded recipient is not sent.
4. Safety path: PARTIAL. The scheduler calls `SafetyService.checkCommand`, and `TmuxService.sendCommand` may also block if wired with safety. This part is acceptable, but it does not rescue the user/group scoping failures because unsafe targets can be chosen before send.
5. Audit/advance: PARTIAL. Sent reminders are audited and all processed reminders are advanced/deactivated through `advanceReminder`, but the wrong reminder can be processed because user scope is missing.

Verdict: FAIL. The focused tests are green but not discriminating for user isolation or current group membership.
