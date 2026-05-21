# Plan 03 — Implementation Plan (04)

**Date**: 2026-03-09
**Schema**: v4 -> v5
**Scope**: Tasks section restructure, Reminder overhaul, Conversations model picker, Settings reorganization

---

## Phase 1: Database Migration (v4 -> v5)

### 1A. New Tables

```sql
CREATE TABLE IF NOT EXISTS personal_task_items (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pti_task ON personal_task_items(task_id);

CREATE TABLE IF NOT EXISTS reminder_alerts (
  id INTEGER PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  offset_value INTEGER NOT NULL,
  offset_unit TEXT NOT NULL CHECK(offset_unit IN ('hours', 'days')),
  sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ra_reminder ON reminder_alerts(reminder_id);
```

### 1B. Alter Reminders Table

- Add `recurrence TEXT CHECK(recurrence IN ('weekly', 'monthly', 'yearly'))` (nullable)
- Add `next_event_date TEXT` (nullable)
- Keep old columns (reminder_1, reminder_2, sent_1, sent_2) for backward compat during migration
- Migrate any existing reminder_1/reminder_2 data to reminder_alerts rows

### 1C. Migration Code

In `database.ts`:
- `SCHEMA_VERSION = 5`
- Add migration block `if (current.version < 5)`:
  - Add new tables via CREATE IF NOT EXISTS
  - ALTER TABLE reminders ADD COLUMN recurrence TEXT
  - ALTER TABLE reminders ADD COLUMN next_event_date TEXT
  - Migrate existing reminder_1/reminder_2 data into reminder_alerts
- Update SCHEMA_SQL with new tables and columns

---

## Phase 2: Backend Services

### 2A. PersonalTaskService Enhancements

**New methods** for `personal_task_items`:
- `listItems(taskId)` — returns items sorted by sort_order
- `addItem(taskId, description, sortOrder)` — create sub-item
- `updateItem(itemId, updates)` — update description, sort_order, completed
- `deleteItem(itemId)` — remove sub-item
- `toggleItemCompletion(itemId)` — toggle completed flag
- `archiveTask(taskId, userId)` — set active=0 for completed tasks

### 2B. ReminderService Overhaul

**Updated interface** — Reminder now includes recurrence, next_event_date
**New methods**:
- `createAlert(reminderId, offsetValue, offsetUnit)` — add alert (max 5)
- `listAlerts(reminderId)` — returns alerts for a reminder
- `deleteAlert(alertId)` — remove an alert
- `getDueReminders()` — reworked: check reminder_alerts.sent=0, compute fire time from event_date - offset
- `markAlertSent(alertId)` — mark individual alert as sent
- `advanceRecurrence(reminderId)` — compute next_event_date from recurrence, reset all alert sent flags
- Updated `create()` — accepts recurrence, alerts array
- Updated `update()` — accepts recurrence, alerts

### 2C. Chat Routes Enhancement

- New endpoint `GET /api/chat/models/:provider` — returns available models
  - For Ollama: fetch `${ollamaBaseUrl}/api/tags` and return model names
  - For OpenRouter: return preconfigured list or fetch from API
- New endpoint `POST /api/chat/provider-model` — set active model for a provider

---

## Phase 3: API Routes

### 3A. Personal Task Item Routes

- `GET /api/personal-tasks/:id/items` — list sub-items
- `POST /api/personal-tasks/:id/items` — add sub-item
- `PATCH /api/personal-task-items/:id` — update sub-item
- `DELETE /api/personal-task-items/:id` — delete sub-item
- `POST /api/personal-task-items/:id/toggle` — toggle sub-item completion
- `POST /api/personal-tasks/:id/archive` — archive completed task

### 3B. Reminder Alert Routes

- `GET /api/reminders/:id/alerts` — list alerts
- `POST /api/reminders/:id/alerts` — create alert (validate max 5)
- `DELETE /api/reminder-alerts/:id` — delete alert
- Updated `POST /api/reminders` — accepts recurrence + alerts array
- Updated `PATCH /api/reminders/:id` — accepts recurrence + alerts

---

## Phase 4: Frontend (app.js)

### 4A. Tasks Section Restructure

Replace existing `TasksSection` with two-tab layout:

**TASKS tab** (action view):
- Shows today's daily tasks and current weekly tasks
- Each task is expandable: clicking reveals sub-items (checkable bullet points from personal_task_items)
- Sub-items individually completable via checkbox
- "Add item" inline input within expanded task
- One-time tasks can be added inline (quick-add bar)
- "Archive" button on fully completed tasks

**SETUP tab** (configuration view):
- Configure recurring daily/weekly task templates (create/edit/delete)
- Remove one-time task creation from here
- Reminders management:
  - Create reminder with date/time, name, description
  - Recurrence picker: weekly/monthly/yearly/none
  - Alert configuration: 0-5 alerts, each with offset_value + offset_unit (hours/days)
  - List reminders with edit/delete

### 4B. Conversations Section

- Replace single provider dropdown with cascading dropdowns:
  1. Provider: Ollama / OpenRouter
  2. Model: fetched from `/api/chat/models/:provider`
- Add inline "Chat Settings" section (collapsible) for soul.md/context.md editing
  - Reuse existing `ChatSettingsSection` component

### 4C. Settings Reorganization

Group with clear section headers:
1. **Account** — User info display, Two-Factor Authentication (2FA)
2. **Chat Configuration** — soul.md/context.md editors
3. **Templates** — Step templates management
4. **Safety** — Command safety patterns

Each section in a card with header + collapsible body.

---

## Phase 5: Reminder Scheduler Update (index.ts)

- Update the 60-second interval to use new `reminder_alerts` table:
  - For each active reminder, check each alert where sent=0
  - Compute fire_time = event_date - offset
  - If fire_time <= now, send TG message, mark alert sent
  - On event: if all alerts sent and event passed, check recurrence
  - If recurring: call `advanceRecurrence()` to set next_event_date, reset alerts

---

## Phase 6: Tests

- Update `database.spec.ts`: schema version check → 5, verify new tables exist
- Update `personal-tasks-reminders.spec.ts`:
  - Add tests for personal_task_items CRUD
  - Add tests for reminder_alerts CRUD
  - Add tests for recurrence logic
  - Add tests for getDueReminders with new alert system
  - Add tests for advanceRecurrence
- Ensure all 117+ existing tests still pass (backward compat)

---

## Phase 7: Build & Deploy

1. `npx tsc` — compile TypeScript
2. Copy `app.js` and `index.html` to `dist/web/public/`
3. `pm2 restart agjassist`
4. Update `project_specs.md` and `changelog.md`

---

## Execution Order

1. Phase 1 (DB) → Phase 2 (Services) → Phase 3 (Routes) → Phase 6 (Tests) — verify backend
2. Phase 5 (Scheduler) — update index.ts
3. Phase 4 (Frontend) — UI changes
4. Phase 7 (Deploy)

## Risk Mitigation

- Old reminder_1/reminder_2 columns kept during migration for backward compat
- All existing tests must pass before proceeding to frontend
- Frontend changes are additive (no breaking existing API contracts)
