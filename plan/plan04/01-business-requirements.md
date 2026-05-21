# 01 - Business Requirements Specification
## AGJAssist Plan04 — Projects, Tasks Restructure, Conversations Agents, Settings Reorg
**Version:** 1.0
**Date:** 2026-03-09
**Status:** Approved
**Author:** bsconsult (Opus-tier analysis)

---

## 1. Project Snapshot

### Current State (plan03 — Schema v5)
| Area | What Exists |
|------|-------------|
| **Projects** | Card grid with `tmux_session_count`, `open_notes_count`, `active_plans_count`, `pending_tasks_count`. Status is `active`/`archived` but only controls list filtering. No expand/collapse UI. |
| **Tasks** | Two top-level tabs: **Tasks** (daily/weekly/once with sub-items) and **Setup** (recurring templates + reminders as one flat list). Single `day_of_week` integer column — only one day per task. |
| **Conversations** | Free-text agent name input, provider/model selector (Ollama/OpenRouter), chat window. No agent registry integration. |
| **Settings** | Collapsible sections: Account/2FA, Chat Configuration, Templates, Safety. Functional but flat. |

### Desired State (plan04)
| Area | Target |
|------|--------|
| **Projects** | Remove sessions count. Green indicators for notes/plans/tasks when > 0. New `active` column: active = expanded, inactive = collapsed/minimized. Toggle per project. |
| **Tasks — Setup** | 3 sub-tabs: DAILY, WEEKLY, REMINDERS. Daily templates with day-of-week bitmask toggles (M/T/W/Th/F/S/Su). Weekly templates with sub-items. Reminders as-is from plan03. Active/inactive toggle per template. |
| **Tasks — Tasks** | 3 sub-tabs: DAILY, WEEKLY, REMINDERS. Daily shows active tasks for current day-of-week. Weekly shows active weekly tasks. Reminders show active reminders after first alert. Auto-archiving with configurable delays. Archive view. |
| **Conversations** | Agent dropdown populated from custom agent registry (bsconsult, elitedev01, etc.). Keep provider/model selector alongside. |
| **Settings** | Reorganize with logical grouping, more UI-friendly with collapsible sections. |

---

## 2. Gap Analysis

### GAP-01: Project Active/Inactive Toggle
- **Current:** `projects.status` is `active`/`archived` — binary, used for list filtering only.
- **Gap:** No concept of "active = expanded, inactive = collapsed/minimized" in UI. No `active` column separate from `status`.
- **Impact:** Need new DB column, API endpoint update, frontend card rendering logic.

### GAP-02: Sessions Count Removal from Project Cards
- **Current:** `tmux_session_count` displayed on every project card.
- **Gap:** Terminals now has its own top-level section; sessions count on project cards is redundant.
- **Impact:** Frontend-only change (remove from card rendering). Keep query column for backward compat.

### GAP-03: Green Indicators for Notes/Plans/Tasks
- **Current:** Counts displayed as plain text numbers.
- **Gap:** No visual distinction between zero and non-zero counts.
- **Impact:** Frontend CSS/rendering change — green dot when count > 0, gray when 0.

### GAP-04: Task Day-of-Week Bitmask
- **Current:** `personal_tasks.day_of_week` is a single INTEGER (0-6, nullable). One day per task.
- **Gap:** Need bitmask to support multiple days (e.g., MWF = 0b0101010 = 42). Daily tasks need to be filterable by current day.
- **Impact:** Schema migration (rename or repurpose column), service logic change, frontend day toggle UI.

### GAP-05: Tasks Sub-Tab Architecture (Setup)
- **Current:** Setup tab shows all recurring templates + reminders in a single scrollable view.
- **Gap:** Need 3 sub-tabs (DAILY, WEEKLY, REMINDERS) inside Setup.
- **Impact:** Frontend restructure. No backend change needed (already filterable by `frequency`).

### GAP-06: Tasks Sub-Tab Architecture (Tasks)
- **Current:** Tasks tab shows all active tasks grouped by frequency in one view.
- **Gap:** Need 3 sub-tabs (DAILY, WEEKLY, REMINDERS) with day-of-week filtering on Daily, auto-archive logic.
- **Impact:** Frontend restructure + new backend auto-archive endpoint/scheduler.

### GAP-07: Auto-Archive Logic
- **Current:** Manual archive only (`POST /api/personal-tasks/:id/archive`).
- **Gap:** Need automatic archiving: daily tasks 1 day after completion, weekly tasks 2 days after completion, reminders 3 hours after occurrence.
- **Impact:** New scheduler/cron logic, new columns to track archive eligibility timestamps.

### GAP-08: Agent Dropdown in Conversations
- **Current:** Free-text input for agent name.
- **Gap:** Need dropdown populated from agent registry list.
- **Impact:** New API endpoint to list available agents. Frontend dropdown component.

---

## 3. Business Objectives

| ID | Objective | Priority |
|----|-----------|----------|
| BO-01 | Allow user to visually manage active vs inactive projects with expand/collapse | Must |
| BO-02 | Clean project card UI: remove sessions, add green indicators | Must |
| BO-03 | Restructure Tasks into sub-tabbed architecture for Setup and Tasks views | Must |
| BO-04 | Support multi-day scheduling for daily tasks via bitmask | Must |
| BO-05 | Auto-archive completed tasks and fired reminders | Should |
| BO-06 | Provide agent dropdown in Conversations from registry | Must |
| BO-07 | Reorganize Settings for better UX | Should |

---

## 4. Functional Architecture

### 4.1 Projects Module

#### FR-PROJ-01: Active/Inactive Column
- Add `active` INTEGER column (default 1) to `projects` table.
- `active = 1` means project card is expanded by default.
- `active = 0` means project card is collapsed/minimized by default.
- This is independent of `status` (active/archived). An active-status project can be inactive (collapsed).

#### FR-PROJ-02: Toggle Endpoint
- `PATCH /api/projects/:id` already accepts body fields — extend to include `active` (0 or 1).
- Response returns updated project.

#### FR-PROJ-03: Card Rendering
- Remove `tmux_session_count` display from project cards.
- For `open_notes_count`, `active_plans_count`, `pending_tasks_count`:
  - Show green dot indicator when count > 0.
  - Show gray dot indicator when count = 0.
- Active projects: full card with counts, click to navigate.
- Inactive projects: collapsed row showing just name + active toggle.

#### FR-PROJ-04: Bulk/Default Behavior
- On project list load, active projects appear expanded, inactive collapsed.
- User can toggle individual projects between active/inactive.
- Toggle persists (saved to DB).

### 4.2 Tasks Module — Setup Tab

#### FR-TASK-SETUP-01: Sub-Tab Navigation
- Setup tab contains 3 sub-tabs: **DAILY**, **WEEKLY**, **REMINDERS**.
- Default sub-tab: DAILY.
- Each sub-tab loads only its relevant data.

#### FR-TASK-SETUP-02: Daily Template Configuration
- Each daily task template has:
  - Title, description (optional)
  - Day-of-week toggles: M, T, W, Th, F, S, Su (bitmask, stored as integer)
  - Bullet sub-items (existing `personal_task_items`)
  - Active/inactive toggle
- Bitmask encoding: bit 0 = Sunday, bit 1 = Monday, ... bit 6 = Saturday.
  - Example: MWF = 0b0101010 = 42
  - All days = 0b1111111 = 127
  - Default for new daily tasks: 127 (all days)

#### FR-TASK-SETUP-03: Weekly Template Configuration
- Each weekly task template has:
  - Title, description (optional)
  - Bullet sub-items
  - Active/inactive toggle
- No day-of-week selection (applies to entire week).

#### FR-TASK-SETUP-04: Reminders Configuration
- Stays as-is from plan03 (0-5 alerts, recurrence, event date).
- No changes to reminder data model.

### 4.3 Tasks Module — Tasks Tab

#### FR-TASK-VIEW-01: Sub-Tab Navigation
- Tasks tab contains 3 sub-tabs: **DAILY**, **WEEKLY**, **REMINDERS**.
- Default sub-tab: DAILY.
- Additional toggle/link: "All/Archive" view shows archived items.

#### FR-TASK-VIEW-02: Daily Tasks View
- Shows only active daily tasks whose bitmask includes the current day of week.
- Each task shows its sub-items as checkable bullets.
- Completion toggle marks the task as done for today.
- Auto-archive: 1 day (24 hours) after completion timestamp, task moves to archive.

#### FR-TASK-VIEW-03: Weekly Tasks View
- Shows all active weekly tasks.
- Each task shows its sub-items as checkable bullets.
- Completion toggle marks task as done for this week.
- Auto-archive: 2 days (48 hours) after completion timestamp, task moves to archive.

#### FR-TASK-VIEW-04: Reminders View
- Shows active reminders that have had their first alert fire (i.e., at least one alert with `sent = 1`, or event_date has passed).
- Auto-archive: 3 hours after event occurrence, reminder is automatically deactivated.
- Manual archive button available.

#### FR-TASK-VIEW-05: Archive View
- Toggle "All/Archive" shows all items including archived/inactive ones.
- Archived items shown with reduced opacity.
- Option to restore (reactivate) archived items.

### 4.4 Conversations Module

#### FR-CONV-01: Agent Dropdown
- Replace free-text agent name input with a dropdown.
- Dropdown populated from a hardcoded agent list (matching `~/.claude/agents/REGISTRY.md`).
- Agent list:
  - bsconsult, bsconsult02
  - sysarch, sysarch02
  - webdesign, webdesign02
  - elitedev01, elitedev02
  - pmanager, pmanager02
  - tester, tester02
  - bugfix
  - migrator, migrator02
  - Custom (free text fallback)

#### FR-CONV-02: Keep Provider/Model Selector
- Existing Ollama/OpenRouter provider selector and model dropdown remain unchanged.
- Position alongside agent dropdown in the conversation header.

### 4.5 Settings Module

#### FR-SETTINGS-01: Reorganized Sections
- Group settings into logical collapsible sections:
  1. **Account & Security** — User info, 2FA setup
  2. **Chat Configuration** — soul.md, context.md
  3. **Agent Registry** — View available agents (read-only list from registry)
  4. **Step Templates** — Manage step templates
  5. **Safety Patterns** — Manage blocked command patterns
- Each section uses existing `SettingsSection` component (already collapsible).
- Default: Account & Security open, rest collapsed.

---

## 5. Acceptance Criteria

### AC-01: Projects
- [ ] Project cards show green dot for counts > 0, gray for 0
- [ ] Sessions count no longer appears on project cards
- [ ] Each project has an active/inactive toggle button
- [ ] Active projects show full expanded card; inactive show minimized row
- [ ] Toggle persists across page reloads (stored in DB)

### AC-02: Tasks — Setup
- [ ] Setup tab shows 3 sub-tabs: DAILY, WEEKLY, REMINDERS
- [ ] Daily sub-tab shows only daily templates with day-of-week toggle buttons
- [ ] Day-of-week toggles work as bitmask (multiple days selectable)
- [ ] Weekly sub-tab shows only weekly templates
- [ ] Reminders sub-tab shows reminder management (unchanged from plan03)
- [ ] Active/inactive toggle visible on each template

### AC-03: Tasks — Tasks
- [ ] Tasks tab shows 3 sub-tabs: DAILY, WEEKLY, REMINDERS
- [ ] Daily sub-tab filters tasks by current day of week
- [ ] Weekly sub-tab shows all active weekly tasks
- [ ] Reminders sub-tab shows reminders after first alert fired
- [ ] Auto-archive fires on schedule (daily: 24h, weekly: 48h, reminders: 3h)
- [ ] "All/Archive" view accessible and shows archived items

### AC-04: Conversations
- [ ] Agent name input replaced with dropdown
- [ ] Dropdown contains all registered agents
- [ ] "Custom" option allows free-text entry
- [ ] Provider/model selectors remain functional

### AC-05: Settings
- [ ] Settings page has 5 collapsible sections
- [ ] Agent Registry section shows available agents
- [ ] All existing functionality preserved (2FA, chat settings, templates, safety)

### AC-06: Zero Regressions
- [ ] All existing tests pass (`npm test`)
- [ ] No TypeScript compilation errors
- [ ] No breaking changes to existing API endpoints
- [ ] Existing data migrated cleanly (schema v5 -> v6)

---

## 6. Edge Cases

### Projects
- **EC-01:** Project with no notes/plans/tasks should show all gray indicators.
- **EC-02:** Toggling active/inactive should not affect project status (active/archived).
- **EC-03:** Archived projects (status = 'archived') should not appear regardless of active column.

### Tasks
- **EC-04:** Daily task with bitmask = 0 (no days selected) should not appear in any daily view.
- **EC-05:** Task completed at 23:59 should auto-archive based on completion timestamp, not midnight rollover.
- **EC-06:** If a daily task's bitmask is changed while it's completed for today, the completion record stays.
- **EC-07:** Weekly task completed on Sunday should auto-archive by Tuesday (2 days later).
- **EC-08:** Reminder with no alerts that reaches event_date should still appear in Reminders Tasks view.
- **EC-09:** Recurring reminder after auto-archive should create new active instance via recurrence advance.

### Conversations
- **EC-10:** Agent dropdown should gracefully handle if registry file is unavailable (fallback to free text).
- **EC-11:** Creating conversation with an agent not in dropdown (via Custom option) should work identically.

### Migration
- **EC-12:** Existing `day_of_week` single integer values must be migrated to bitmask equivalents (e.g., `1` (Monday) becomes `0b0000010` = `2`).
- **EC-13:** Tasks with `day_of_week = NULL` should default to bitmask `127` (all days).

---

## 7. Data Model Changes Summary

| Table | Change | Details |
|-------|--------|---------|
| `projects` | ADD COLUMN | `active INTEGER NOT NULL DEFAULT 1` |
| `personal_tasks` | MODIFY COLUMN | `day_of_week` repurposed as bitmask (was 0-6 single day, now 0-127 bitmask) |
| `personal_tasks` | ADD COLUMN | `completed_at TEXT` (timestamp of last completion, for auto-archive calculation) |
| `schema_version` | UPDATE | `5` -> `6` |

---

## 8. Non-Functional Requirements

| NFR | Requirement |
|-----|-------------|
| NFR-01 | Schema migration must be backward-compatible and non-destructive |
| NFR-02 | Auto-archive scheduler must not block the main event loop |
| NFR-03 | Frontend changes must maintain no-build-step architecture (Preact + htm from ESM CDN) |
| NFR-04 | API response times must not regress (< 100ms for list endpoints) |
| NFR-05 | All changes must pass existing test suite with zero regressions |

---

## 9. Out of Scope
- No changes to Telegram bot integration
- No changes to terminal/tmux functionality
- No changes to project detail tabs (code, notes, plans, tasks, activity)
- No changes to authentication flow
- No new LLM provider integrations
