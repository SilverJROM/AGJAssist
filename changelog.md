# Changelog

## [v8] - 2026-03-10 (Plan 05)

### Added
- Template/instance architecture: templates generate daily task instances
- Daily instance generation at 2am Manila time (UTC+8) from active daily templates
- Weekly instance generation targeting Saturday of each week from active weekly templates
- One-off tasks on Action tab (day-scoped, never appear on Setup tab)
- "Generate Tasks" button for manual instance generation
- `POST /api/personal-tasks/generate` endpoint for manual trigger
- `GET /api/personal-tasks?view=templates` for Setup tab (templates only)
- `GET /api/personal-tasks?view=daily-instances&date=YYYY-MM-DD` for daily instances
- `GET /api/personal-tasks?view=weekly-instances&date=YYYY-MM-DD` for weekly instances
- `GET /api/personal-tasks?view=oneoffs&date=YYYY-MM-DD` for one-off tasks
- Sub-items auto-copied from template to generated instances
- Old instances auto-cleaned after 3 days

### Changed
- Setup tab now shows only templates (not instances), with active/inactive sections
- Action tab now shows generated instances + one-offs (not templates directly)
- Active/inactive toggle on Setup templates flips flag only (no deletion)
- Separate delete button for permanent template removal
- Inactive templates shown dimmed in Setup tab
- Weekly templates no longer show day-of-week picker (not applicable)
- Auto-archive now targets completed instances/one-offs after 48h

### Technical
- Schema version 7 -> 8
- New columns: `personal_tasks.template_id` (INTEGER, FK to self), `personal_tasks.target_date` (TEXT)
- New indexes: `idx_pt_template`, `idx_pt_target_date`
- New service methods: listTemplates, listInstances, listDailyInstances, listWeeklyInstances, listOneOffs, generateDailyInstances, generateWeeklyInstances, cleanupOldInstances
- Template deletion cascades to all child instances

## [v6] - 2026-03-10 (Plan 04)

### Projects
- Active/inactive toggle with green/gray dot indicators
- Projects split into Active and Inactive sections
- Removed sessions count from project cards (cleaner UI)

### Tasks Restructure
- Day-of-week bitmask scheduling for daily tasks (bit0=Sun through bit6=Sat, 127=all)
- Sub-tabs within Tasks tab: Daily, Weekly, Reminders
- Sub-tabs within Setup tab: Daily, Weekly, Reminders
- DayOfWeekPicker component for selecting which days a daily task runs
- Day-filtered daily task view (shows only tasks scheduled for today)
- Archive view toggle showing inactive/completed templates
- Active/inactive toggle per task template
- Reminders integrated into Tasks view (fired alerts and passed events)
- Auto-archive scheduler: daily tasks after 24h, weekly after 48h, reminders 3h after event
- `completed_at` timestamp tracking for auto-archive eligibility

### Conversations
- Agent dropdown populated from static agent registry (15 agents)
- Select + custom fallback input for agent names

### Settings Reorganization
- Reordered sections: Account, Chat Configuration, Agent Registry, Step Templates, Safety Patterns
- New Agent Registry section displaying all available agents

### Database
- Schema version 5 -> 6
- New column: `projects.active` (INTEGER, default 1)
- Migration: `personal_tasks.day_of_week` from single-day (0-6) to bitmask encoding
- New column: `personal_tasks.completed_at` (TEXT, nullable)
- NULL day_of_week for daily tasks defaults to 127 (all days)

### Backend
- ProjectService: active toggle support in update()
- PersonalTaskService: listForDay() with bitmask filtering, listInactive(), getArchiveEligible(), autoArchive()
- ReminderService: listForTasksView(), autoArchiveReminders()
- AgentRegistryService: static agent list (15 agents)
- Auto-archive runs on existing 60s scheduler interval

### API
- `PATCH /api/projects/:id` accepts `active` field
- `GET /api/personal-tasks?day=N` for bitmask-filtered daily tasks
- `GET /api/personal-tasks?inactive=true` for archived tasks
- `POST /api/personal-tasks/auto-archive` manual trigger
- `GET /api/reminders?view=tasks` for tasks view (fired alerts + passed events)
- `GET /api/agents` returns agent registry list

### Tests
- 152 total tests (up from 137), all passing, zero regressions
- New tests: database schema v6, bitmask day filtering, auto-archive tasks, auto-archive reminders, inactive listing

## [v5] - 2026-03-09 (Plan 03)

### Tasks Section Restructure
- Split Tasks section into two tabs: **Tasks** (action view) and **Setup** (configuration view)
- Tasks tab shows today's daily tasks, current weekly tasks, and active one-time tasks
- Each task is expandable to show checkable sub-items (personal_task_items table)
- Sub-items individually completable with inline add/delete
- Quick-add bar for one-time tasks directly in Tasks tab
- Archive button on completed tasks
- Setup tab manages recurring daily/weekly task templates
- Removed one-time task creation from Setup (moved to Tasks tab quick-add)

### Reminder Overhaul
- New `reminder_alerts` table for configurable alerts (0-5 per reminder)
- Each alert: offset_value + offset_unit (hours/days) before event
- Added `recurrence` column to reminders (weekly/monthly/yearly/null)
- Added `next_event_date` for tracking recurring reminder dates
- Reminder form modal with alert configuration UI
- Recurring reminders auto-advance after event fires (reset alerts, update dates)
- Legacy reminder_1/reminder_2 columns maintained for backward compatibility
- Existing data migrated to new alert system during schema upgrade

### Conversations Section
- Cascading dropdowns: Provider (Ollama/OpenRouter) -> Model (fetched per provider)
- New endpoint `GET /api/chat/models/:provider` lists available models
- Ollama models fetched dynamically from `/api/tags`
- OpenRouter shows curated model list
- Added inline "Chat Settings" toggle for soul.md/context.md editing

### Settings Reorganization
- Grouped into collapsible sections with clear headers
- **Account**: User info display + Two-Factor Authentication
- **Chat Configuration**: soul.md/context.md editors
- **Templates**: Step templates management
- **Safety**: Command safety patterns with description

### Database
- Schema version 4 -> 5
- New table: `personal_task_items` (task sub-items)
- New table: `reminder_alerts` (configurable alert offsets)
- New columns on reminders: `recurrence`, `next_event_date`
- Migration auto-converts existing reminder_1/reminder_2 to alert rows

### Backend
- PersonalTaskService: listItems, addItem, updateItem, deleteItem, toggleItemCompletion, archiveTask
- ReminderService: createAlert, listAlerts, deleteAlert, markAlertSent, getDueAlerts, advanceRecurrence, getByIdWithAlerts, listWithAlerts
- OllamaProvider: getBaseUrl() getter
- New API routes for task items, reminder alerts, model listing

### Tests
- 137 total tests (up from 117), all passing
- New tests: task items CRUD, alert CRUD, recurrence logic, due alerts detection

## [v4] - 2026-03-08

- Added personal tasks (daily/weekly/one-time) with completion tracking
- Added reminders with scheduled Telegram notifications
- Added chat settings (soul.md/context.md)
- Added LLM conversation system (Ollama + OpenRouter)

## [v3] - Previous

- Step templates system
- Plan insert to project functionality

## [v2] - Previous

- Two-factor authentication (TOTP)
- Code-based web login

## [v1] - Initial

- Core project management, terminal access, notes, plans, tasks
- Telegram bot integration
- Safety patterns, audit logging
