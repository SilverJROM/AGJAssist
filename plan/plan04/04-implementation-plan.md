# 04 - Implementation Plan
## AGJAssist Plan04 — Execution-Ready Task Packets
**Version:** 1.0
**Date:** 2026-03-09
**Status:** Approved
**Author:** pmanager (Opus-tier orchestration)
**Input:** 01-business-requirements.md, 02-system-architecture.md, 03-ui-ux-plan.md
**Mode:** saver40 (40% elitedev02/xa, 60% elitedev01)

---

## 1. Execution Strategy

### Agent Assignment (saver40 Distribution)

| Agent | Model | Task Types | % of Work |
|-------|-------|------------|-----------|
| elitedev01 | Opus | Schema migration, complex service logic, frontend restructure | 60% |
| elitedev02 | Sonnet | Simple CRUD changes, route wiring, CSS additions | 30% |
| xa | Sonnet | File creation, test scaffolding | 10% |

### Sequencing Rules
1. Backend before frontend (service changes before UI changes)
2. Schema migration first (everything depends on it)
3. Tests alongside each packet (not deferred)
4. Each packet is independently verifiable

---

## 2. Milestones

| # | Milestone | Packets | Gate |
|---|-----------|---------|------|
| M1 | Schema & Backend Foundation | P1, P2, P3 | `npm test` passes, schema v6 verified |
| M2 | Backend Features Complete | P4, P5, P6 | All API endpoints functional, existing tests pass |
| M3 | Frontend Core | P7, P8, P9 | UI renders correctly, no console errors |
| M4 | Frontend Polish & Integration | P10, P11 | Full integration works end-to-end |
| M5 | Testing & Validation | P12 | All tests pass, zero regressions |

---

## 3. Task Packets

### P1: Schema Migration v5 -> v6
**Agent:** elitedev01 (Opus)
**Estimated:** Small
**Dependencies:** None
**Files:**
- `src/db/database.ts`

**Tasks:**
1. Update `SCHEMA_VERSION` from 5 to 6
2. Add `active INTEGER NOT NULL DEFAULT 1` to `projects` CREATE TABLE statement
3. Add `completed_at TEXT` to `personal_tasks` CREATE TABLE statement
4. Add migration block `if (current && current.version < 6)`:
   - Add `active` column to projects (ALTER TABLE IF NOT EXISTS pattern)
   - Migrate `day_of_week` values: single-day (0-6) to bitmask (1 << day)
   - Set NULL `day_of_week` to 127 for daily tasks
   - Add `completed_at` column to personal_tasks
5. Update schema_version to 6

**Acceptance:**
- [ ] Fresh DB creates with schema v6
- [ ] Existing v5 DB migrates cleanly to v6
- [ ] `day_of_week` values correctly converted to bitmask
- [ ] Existing tests still pass

**Test Gate:** `npm test` — all existing tests pass

---

### P2: ProjectService Backend Updates
**Agent:** elitedev02 (Sonnet)
**Estimated:** Small
**Dependencies:** P1
**Files:**
- `src/services/project-service.ts`
- `src/api/routes/project-routes.ts`

**Tasks:**
1. Add `active: number` to `Project` interface
2. Add `active` to `ProjectWithCounts` interface
3. Update `update()` method to accept and persist `active` field
4. Ensure `list()` returns `active` column in response
5. Update PATCH route to pass `active` from request body

**Acceptance:**
- [ ] `PATCH /api/projects/:id { active: 0 }` sets project as inactive
- [ ] `GET /api/projects` returns `active` field on each project
- [ ] Existing project CRUD unchanged

---

### P3: AgentRegistryService
**Agent:** xa (Sonnet)
**Estimated:** Small
**Dependencies:** None (can run parallel to P1/P2)
**Files:**
- `src/services/agent-registry-service.ts` (CREATE)
- `src/api/routes/agent-routes.ts` (CREATE)
- `src/api/server.ts`
- `src/index.ts`

**Tasks:**
1. Create `agent-registry-service.ts` with static agent list (15 agents from REGISTRY.md)
2. Export `getAgentList()` function
3. Create `agent-routes.ts` with `GET /api/agents` endpoint
4. Register route in `server.ts`
5. No database dependency — pure static data

**Acceptance:**
- [ ] `GET /api/agents` returns array of 15 agents with id, name, model, description
- [ ] No authentication required for agent list (or owner-only — match existing pattern)

---

### P4: PersonalTaskService — Bitmask & Day Filtering
**Agent:** elitedev01 (Opus)
**Estimated:** Medium
**Dependencies:** P1
**Files:**
- `src/services/personal-task-service.ts`
- `src/api/routes/personal-task-routes.ts`

**Tasks:**
1. Add `listForDay(userId, dayOfWeek)` method — filters by `(day_of_week & (1 << dayOfWeek)) != 0`
2. Update `list()` to include `completed_at` in returned objects
3. Add `completed_at` to `PersonalTask` interface
4. Update `toggleCompletion()` to set/clear `completed_at` timestamp
5. Update route `GET /api/personal-tasks` to accept `?day=` query parameter
6. When `frequency=daily` and `day` provided, use `listForDay()` instead of `list()`

**Acceptance:**
- [ ] `GET /api/personal-tasks?frequency=daily&day=1` returns only Monday tasks
- [ ] Task with bitmask 42 (MWF) appears on Monday, Wednesday, Friday
- [ ] Task with bitmask 0 appears on no day
- [ ] `completed_at` populated when task toggled complete

**Test Gate:** Add unit tests for bitmask filtering

---

### P5: Auto-Archive Backend
**Agent:** elitedev01 (Opus)
**Estimated:** Medium
**Dependencies:** P4
**Files:**
- `src/services/personal-task-service.ts`
- `src/services/reminder-service.ts`
- `src/api/routes/personal-task-routes.ts`
- `src/index.ts`

**Tasks:**
1. Add `getArchiveEligible()` to PersonalTaskService — returns tasks with `completed_at` exceeding delay
2. Add `autoArchive()` to PersonalTaskService — sets `active = 0` on eligible tasks
3. Add `listForTasksView(userId)` to ReminderService — filters for reminders with fired alerts
4. Add `autoArchiveReminders()` to ReminderService — deactivates reminders 3h after event
5. Add `POST /api/personal-tasks/auto-archive` endpoint (admin/owner only)
6. Add auto-archive calls to the 60-second scheduler in `index.ts`

**Acceptance:**
- [ ] Daily task completed 25 hours ago: auto-archived
- [ ] Weekly task completed 49 hours ago: auto-archived
- [ ] Reminder with event 4 hours ago and sent_event=1: auto-archived
- [ ] Scheduler runs without errors in the 60s interval
- [ ] Tasks not yet past their delay: NOT archived

**Test Gate:** Add unit tests for archive eligibility and auto-archive

---

### P6: Reminder Tasks View Endpoint
**Agent:** elitedev02 (Sonnet)
**Estimated:** Small
**Dependencies:** P5
**Files:**
- `src/api/routes/reminder-routes.ts`

**Tasks:**
1. Add `?view=tasks` query parameter to `GET /api/reminders`
2. When `view=tasks`, use `reminderService.listForTasksView()` instead of `listWithAlerts()`
3. Return same response format

**Acceptance:**
- [ ] `GET /api/reminders?view=tasks` returns only reminders with fired alerts or passed event_date
- [ ] Regular `GET /api/reminders` unchanged

---

### P7: Frontend — Projects Redesign
**Agent:** elitedev01 (Opus)
**Estimated:** Medium
**Dependencies:** P2
**Files:**
- `src/web/public/app.js`
- `src/web/public/style.css`

**Tasks:**
1. Add `.dot`, `.dot-green`, `.dot-gray`, `.project-card-collapsed` CSS classes
2. Create `ProjectCard` component with active/inactive rendering
3. Update `Projects` component:
   - Split projects into active (expanded grid) and inactive (collapsed list)
   - Add toggle handler calling `PATCH /api/projects/:id`
4. Remove `tmux_session_count` display from project cards
5. Add green/gray dot indicators for notes/plans/tasks counts

**Acceptance:**
- [ ] Active projects show expanded cards with green/gray dots
- [ ] Inactive projects show collapsed single-line rows
- [ ] Toggle button switches between active/inactive
- [ ] Sessions count no longer visible on cards
- [ ] Toggle persists after page reload

---

### P8: Frontend — Tasks Sub-Tab Architecture
**Agent:** elitedev01 (Opus)
**Estimated:** Large
**Dependencies:** P4, P5, P6
**Files:**
- `src/web/public/app.js`

**Tasks:**
1. Create `SubTabs` component
2. Create `DayOfWeekPicker` component (bitmask toggle buttons)
3. Restructure `TasksSection`:
   - Top tabs: Tasks | Setup (unchanged)
   - Sub-tabs under each: DAILY | WEEKLY | REMINDERS
4. Restructure `TasksActionTab`:
   - Add sub-tab state (daily/weekly/reminders)
   - Daily: fetch with `?frequency=daily&day=<today>`, show filtered tasks
   - Weekly: fetch with `?frequency=weekly`, show all
   - Reminders: fetch with `GET /api/reminders?view=tasks`, show active reminders
   - Archive toggle: fetch inactive tasks/reminders when toggled
5. Restructure `TasksSetupTab`:
   - Add sub-tab state (daily/weekly/reminders)
   - Daily: show only daily templates with DayOfWeekPicker
   - Weekly: show only weekly templates
   - Reminders: move existing reminder management here
6. Update "New Task" modal in Setup > Daily to include DayOfWeekPicker
7. Add active/inactive toggle button on each template card
8. Add "Archive" view toggle

**Acceptance:**
- [ ] Tasks tab shows 3 sub-tabs (Daily, Weekly, Reminders)
- [ ] Setup tab shows 3 sub-tabs (Daily, Weekly, Reminders)
- [ ] Daily tasks filtered by current day of week
- [ ] Day-of-week picker works with bitmask (multiple days selectable)
- [ ] Archive view shows inactive/archived items
- [ ] Reminders sub-tab under Tasks shows fired reminders
- [ ] Active/inactive toggle on templates works

**This is the largest packet — consider splitting if needed.**

---

### P9: Frontend — Conversations Agent Dropdown
**Agent:** elitedev02 (Sonnet)
**Estimated:** Small
**Dependencies:** P3
**Files:**
- `src/web/public/app.js`

**Tasks:**
1. Create `AgentSelector` component (dropdown with custom fallback)
2. Update `Conversations` component:
   - Fetch agents from `GET /api/agents` on mount
   - Replace free-text agent input in "New Conversation" modal with AgentSelector
   - Keep provider/model selectors unchanged
3. Show agent name more prominently in conversation sidebar

**Acceptance:**
- [ ] New Conversation modal shows agent dropdown
- [ ] Dropdown lists all 15 agents with name and model
- [ ] "Custom" option allows free-text input
- [ ] Creating conversation with selected agent works
- [ ] Provider/model selectors still functional

---

### P10: Frontend — Settings Reorganization
**Agent:** elitedev02 (Sonnet)
**Estimated:** Small
**Dependencies:** P3
**Files:**
- `src/web/public/app.js`

**Tasks:**
1. Create `AgentRegistrySection` component
2. Add "Agent Registry" SettingsSection between Chat Configuration and Templates
3. Reorder sections: Account & Security, Chat Configuration, Agent Registry, Step Templates, Safety Patterns
4. Verify all existing sections still work

**Acceptance:**
- [ ] Settings shows 5 collapsible sections in correct order
- [ ] Agent Registry section displays agent list
- [ ] All existing settings functionality preserved

---

### P11: Integration Testing & Edge Cases
**Agent:** elitedev01 (Opus)
**Estimated:** Medium
**Dependencies:** P7, P8, P9, P10
**Files:**
- `src/web/public/app.js`
- Various service files (bug fixes if needed)

**Tasks:**
1. End-to-end verification of all flows
2. Test edge cases from business requirements (EC-01 through EC-13)
3. Verify auto-archive scheduler works in running system
4. Test bitmask migration with real data scenarios
5. Fix any integration issues discovered
6. Ensure no console errors in frontend

**Acceptance:**
- [ ] All edge cases verified
- [ ] No console errors
- [ ] Auto-archive working in real-time
- [ ] Data migration verified with test database

---

### P12: Test Suite Updates
**Agent:** elitedev01 (Opus)
**Estimated:** Medium
**Dependencies:** P4, P5
**Files:**
- `tests/unit/personal-tasks-reminders.spec.ts`
- `tests/unit/database.spec.ts`

**Tasks:**
1. Add bitmask-related tests:
   - Create daily task with bitmask 42 (MWF), verify appears on Monday
   - Create daily task with bitmask 0, verify appears on no day
   - Verify bitmask 127 returns task on all days
2. Add auto-archive tests:
   - Complete daily task, advance time 25h, verify eligible
   - Complete weekly task, advance time 49h, verify eligible
   - Complete daily task, advance time 23h, verify NOT eligible
3. Add migration tests:
   - Create v5 database, run migration, verify v6 schema
   - Verify day_of_week migration (0->1, 1->2, ..., 6->64, NULL->127)
4. Add reminder tasks-view tests:
   - Reminder with sent alert appears in tasks view
   - Reminder with no sent alerts doesn't appear
   - Auto-archive reminder 3h after event
5. Verify all existing tests still pass

**Acceptance:**
- [ ] All new tests pass
- [ ] All existing tests pass (zero regressions)
- [ ] `npm test` exits with code 0

---

## 4. Execution Order (Gantt-Style)

```
Phase 1: Backend Foundation (Packets P1, P2, P3 — can parallelize P2+P3)
  ├─ P1: Schema Migration          [elitedev01]  ████
  ├─ P2: ProjectService Updates    [elitedev02]  ──████
  └─ P3: AgentRegistryService      [xa]          ████

Phase 2: Backend Features (Packets P4, P5, P6 — sequential)
  ├─ P4: Bitmask & Day Filtering   [elitedev01]  ──────████████
  ├─ P5: Auto-Archive Backend      [elitedev01]  ──────────────████████
  └─ P6: Reminder Tasks View       [elitedev02]  ──────────────────────████

Phase 3: Frontend (Packets P7, P8, P9, P10 — P7 can start with P5, P8 needs P5+P6)
  ├─ P7: Projects Redesign         [elitedev01]  ──────────────████████
  ├─ P8: Tasks Sub-Tabs            [elitedev01]  ──────────────────────████████████
  ├─ P9: Conversations Dropdown    [elitedev02]  ──────████
  └─ P10: Settings Reorg           [elitedev02]  ──────────████

Phase 4: Polish (Packets P11, P12)
  ├─ P11: Integration & Edge Cases [elitedev01]  ──────────────────────────────────████████
  └─ P12: Test Suite Updates       [elitedev01]  ──────────────────────────────────────────████████
```

---

## 5. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| P8 (Tasks Sub-Tabs) is too large | Can split into P8a (Setup sub-tabs) and P8b (Tasks sub-tabs) if needed |
| Bitmask migration corrupts data | Guard: only convert values 0-6, skip values > 6 (already migrated) |
| Auto-archive too aggressive | Conservative defaults, 60s check interval, only archive with completed_at set |
| Frontend regression | Keep all existing component code, modify incrementally |
| Test failures | Run tests after each packet, fix before proceeding |

---

## 6. Completion Criteria

### Plan04 is COMPLETE when:
1. All 12 packets are implemented and verified
2. `npm test` passes with zero failures
3. `npx tsc --noEmit` passes with zero errors
4. Schema v6 migration works on fresh and existing databases
5. All acceptance criteria from 01-business-requirements.md met
6. No console errors in browser
7. Manual verification of all 5 interaction flows from 03-ui-ux-plan.md

### Definition of Done per Packet:
- Code changes committed
- Acceptance criteria met
- Tests pass
- No TypeScript errors
- Notification sent via Telegram

---

## 7. Token Budget Estimate (saver40)

| Packet | Agent | Est. Tokens |
|--------|-------|-------------|
| P1 | elitedev01 (Opus) | ~3K |
| P2 | elitedev02 (Sonnet) | ~2K |
| P3 | xa (Sonnet) | ~2K |
| P4 | elitedev01 (Opus) | ~5K |
| P5 | elitedev01 (Opus) | ~5K |
| P6 | elitedev02 (Sonnet) | ~1K |
| P7 | elitedev01 (Opus) | ~5K |
| P8 | elitedev01 (Opus) | ~10K |
| P9 | elitedev02 (Sonnet) | ~3K |
| P10 | elitedev02 (Sonnet) | ~2K |
| P11 | elitedev01 (Opus) | ~5K |
| P12 | elitedev01 (Opus) | ~5K |
| **Total** | | **~48K** |

**Distribution:**
- elitedev01 (Opus): P1+P4+P5+P7+P8+P11+P12 = ~38K tokens (60%)
- elitedev02 (Sonnet): P2+P6+P9+P10 = ~8K tokens (30%)
- xa (Sonnet): P3 = ~2K tokens (10%)

This meets the saver40 target: 60% Opus, 40% Sonnet.
