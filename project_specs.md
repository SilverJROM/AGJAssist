# AGJAssist - Project Specifications

**projcore_session:** AGJ

## Overview

AGJAssist is a Telegram bot + web dashboard for development project management, terminal access, task tracking, LLM conversations, and personal productivity.

## Tech Stack

- **Backend**: TypeScript, Fastify, better-sqlite3
- **Frontend**: Preact + htm (no JSX, no build step), hash-based routing
- **Bot**: Telegram Bot API (webhook mode when `WEB_APP_URL`/`TELEGRAM_WEBHOOK_URL` is configured; polling fallback for local-only setups)
- **Port**: 3101
- **Deploy**: `npx tsc` -> copy static files -> `pm2 restart agjassist`

## Database

- **Engine**: SQLite with WAL mode
- **Schema Version**: 8
- **Tables**:
  - `users`, `sessions` - Authentication
  - `projects` - Development project tracking
  - `tmux_sessions`, `tmux_output_history` - Terminal management
  - `agent_delegations` - Agent authority management
  - `notes`, `plans`, `plan_notes`, `plan_steps` - Planning workflow
  - `tasks`, `task_executions` - Project tasks (kanban)
  - `safety_patterns` - Command safety patterns
  - `audit_log` - Activity audit trail
  - `conversations` - LLM chat history
  - `step_templates`, `step_template_items` - Plan step templates
  - `personal_tasks`, `personal_task_completions` - Daily/weekly/one-time tasks (templates + instances)
  - `personal_task_items` - Task sub-items (checkable bullet points)
  - `personal_tasks.template_id` - Links generated instances to parent template
  - `personal_tasks.target_date` - Date an instance targets (YYYY-MM-DD)
  - `reminders` - Event reminders with recurrence support
  - `reminder_alerts` - Configurable alert offsets (0-5 per reminder)
  - `chat_settings` - LLM configuration (soul.md, context.md)

## Web Dashboard Sections

1. **Dashboard** - Hub with section cards and quick stats
2. **Projects** - Project list with active/inactive toggle (green/gray dots), code editor (Monaco), notes, plans, tasks, activity
3. **Terminals** - Tmux terminal access via WebSocket + xterm.js
4. **Tasks** - Two-tab layout (template/instance architecture):
   - **Tasks tab**: Action view with sub-tabs (Daily/Weekly/Reminders), shows generated instances (not templates), one-off task quick-add, "Generate Tasks" button, archive view toggle
   - **Setup tab**: Sub-tabs (Daily/Weekly/Reminders), manages templates only, active/inactive toggle (flip flag without delete), separate delete button, inactive templates shown dimmed, DayOfWeekPicker for daily scheduling, 0-5 alert offsets for reminders, recurrence (weekly/monthly/yearly)
   - **Instance generation**: At 2am Manila time (UTC+8), daily/weekly instances auto-generated from active templates. Manual trigger via "Generate Tasks" button. Old instances cleaned up after 3 days.
5. **Conversations** - LLM chat with cascading provider/model selection, agent dropdown (registry + custom), inline chat settings
6. **Settings** - Organized in collapsible sections: Account (2FA), Chat Configuration, Agent Registry, Step Templates, Safety Patterns

## API Routes

- `/api/telegram/webhook` - Telegram Bot API webhook receiver protected by `X-Telegram-Bot-Api-Secret-Token`
- `/api/auth/*` - Authentication (Telegram, code-based, 2FA)
- `/api/projects/*` - Project CRUD and file management
- `/api/tmux/*` - Terminal session management
- `/api/personal-tasks/*` - Personal task CRUD, completion toggle, items
- `/api/personal-task-items/*` - Task sub-item CRUD and toggle
- `/api/reminders/*` - Reminder CRUD with alerts
- `/api/reminder-alerts/*` - Alert management
- `/api/chat/*` - LLM chat, model listing per provider
- `/api/chat-settings/*` - Chat configuration
- `/api/conversations/*` - Conversation management
- `/api/templates/*` - Step template management
- `/api/safety/*` - Safety pattern management
- `/api/agents` - Agent registry listing
- `/api/audit` - Audit log

## Reminder System

- Reminders have event_date, optional recurrence (weekly/monthly/yearly)
- 0-5 configurable alerts per reminder (offset_value + offset_unit: hours/days)
- Scheduler runs every 60 seconds, sends Telegram messages for due alerts
- Recurring reminders auto-advance after event fires (reset alerts, update dates)
- Auto-archive: reminders deactivated 3h after event fires
- Legacy reminder_1/reminder_2 columns maintained for backward compatibility

## Template/Instance Architecture

- **Templates**: daily/weekly tasks in Setup tab (frequency=daily|weekly, template_id=NULL)
- **Instances**: generated from templates with frequency=once, template_id pointing to parent
- **One-offs**: Action tab tasks with frequency=once, template_id=NULL, target_date=today
- Instance generation: 2am Manila time daily scheduler + manual "Generate Tasks" button
- Sub-items copied from template to each generated instance
- Old instances auto-cleaned after 3 days

## Auto-Archive System

- Runs on existing 60s scheduler interval
- Completed instances/one-offs: archived 48h after completion
- Reminders: deactivated 3h after event_date when sent_event=1

## Day-of-Week Bitmask

- Encoding: bit0=Sunday(1), bit1=Monday(2), ..., bit6=Saturday(64), all days=127
- Filter query: `(day_of_week & (1 << dayOfWeek)) != 0`
- DayOfWeekPicker UI component for toggling individual days

## Key Files

- `src/db/database.ts` - Schema, migrations
- `src/index.ts` - Main entry, service wiring, reminder scheduler
- `src/api/server.ts` - Fastify server setup
- `src/api/routes/` - All API route modules
- `src/services/` - Business logic services
- `src/web/public/app.js` - Single-file Preact frontend
- `src/web/public/index.html` - HTML entry point
- `tests/` - Vitest test suites
