# 04 - Implementation Plan (Plan 05)

**Date**: 2026-03-10
**Cost Mode**: saver40 (40% elitedev02/sonnet, 60% elitedev01/opus)
**Pipeline**: Standalone invocation (no upstream agents)
**Schema**: v7 -> v8

## Requirements Traceability

| ID | Requirement | Summary |
|----|-------------|---------|
| REQ-1 | Action Tab One-Off Tasks | One-off tasks from Action tab are day-scoped, never appear on Setup |
| REQ-2 | Daily Instance Generation | At 2am Manila (UTC+8), generate daily instances from active templates |
| REQ-3 | Weekly Instance Generation | Same for weekly templates, targeting Saturday of that week |
| REQ-4 | Active/Inactive Toggle | Setup tab: toggle active/inactive flag (no delete), separate delete button, inactive shown dimmed |

## DB Schema Changes (v7 -> v8)

Add 2 columns to `personal_tasks`:
- `template_id INTEGER` - NULL for templates & one-offs, references parent template for generated instances
- `target_date TEXT` - the date this instance targets (YYYY-MM-DD)

Task type matrix:
| Type | frequency | template_id | target_date |
|------|-----------|-------------|-------------|
| Daily template | daily | NULL | NULL |
| Weekly template | weekly | NULL | NULL |
| Generated daily instance | once | -> template.id | 2026-03-10 |
| Generated weekly instance | once | -> template.id | 2026-03-08 (Sat) |
| One-off task (Action tab) | once | NULL | 2026-03-10 |

## Task Distribution Matrix

Total Tasks: 5
- elitedev01 (Opus): 3 tasks (60%) - TASK-1 (DB migration), TASK-3 (instance generation service), TASK-5 (frontend)
- elitedev02 (Sonnet): 2 tasks (40%) - TASK-2 (service layer queries), TASK-4 (API routes)

## Tasks

### TASK-1: Database Migration v7 -> v8 [elitedev01]
**Req**: REQ-1, REQ-2, REQ-3
**Files**: `src/db/database.ts`
**Changes**:
1. Bump SCHEMA_VERSION to 8
2. Add `template_id INTEGER` and `target_date TEXT` to personal_tasks CREATE TABLE
3. Add migration block for v7->v8: ALTER TABLE ADD COLUMN for both
4. Add index on template_id and target_date

### TASK-2: Service Layer Updates [elitedev02]
**Req**: REQ-1, REQ-2, REQ-3, REQ-4
**Files**: `src/services/personal-task-service.ts`
**Changes**:
1. Update `create()` to accept `template_id` and `target_date`
2. Add `listTemplates(userId, frequency?)` - returns only templates (template_id IS NULL AND frequency != 'once')
3. Add `listInstances(userId, targetDate, frequency?)` - returns instances for a target date
4. Add `listInstancesForWeek(userId, saturdayDate)` - weekly instances for a week
5. Add `generateDailyInstances(userId, targetDate)` - creates instances from active daily templates
6. Add `generateWeeklyInstances(userId, saturdayDate)` - creates instances from active weekly templates
7. Update `list()` for Action tab to return instances + one-offs only (not templates)
8. Update `listForDay()` to return instances for today, not templates
9. Add `cleanupOldInstances(daysOld)` for lapsing old instances

### TASK-3: Instance Generation Scheduler [elitedev01]
**Req**: REQ-2, REQ-3
**Files**: `src/index.ts`
**Changes**:
1. Add a scheduler that runs every 60 seconds
2. At 2am Manila time (UTC+8 = 18:00 UTC previous day), generate daily instances
3. Generate weekly instances (targeting Saturday of current week)
4. Idempotent: skip if instances for that target_date already exist
5. Cleanup: mark instances older than 3 days as inactive

### TASK-4: API Route Updates [elitedev02]
**Req**: REQ-1, REQ-2, REQ-3, REQ-4
**Files**: `src/api/routes/personal-task-routes.ts`
**Changes**:
1. Add `GET /api/personal-tasks?view=templates` for Setup tab
2. Add `GET /api/personal-tasks?view=instances&date=YYYY-MM-DD` for Action tab
3. Add `POST /api/personal-tasks/generate` manual trigger for instance generation
4. Update POST to accept template_id and target_date
5. Ensure existing endpoints still work (backward compat)

### TASK-5: Frontend Updates [elitedev01]
**Req**: REQ-1, REQ-2, REQ-3, REQ-4
**Files**: `src/web/public/app.js`
**Changes**:
1. **TasksActionTab**: Fetch instances (not templates), add one-off task form, show one-offs for today only
2. **TasksSetupTab**: Fetch templates only, show active/inactive toggle that doesn't delete, separate Del button, show inactive templates dimmed
3. **SetupTemplateCard**: Already has active toggle + delete - verify behavior is correct (toggle = flip flag only, delete = permanent)
4. **TaskActionCard**: Show one-off badge for tasks with no template_id and frequency=once
5. Add quick-add one-off task form on Action tab

## Execution Order

1. TASK-1 (DB) -> 2. TASK-2 (Service) -> 3. TASK-3 (Scheduler) + TASK-4 (Routes) -> 4. TASK-5 (Frontend)

## Post-Implementation

Update `project_specs.md` and `changelog.md`.

## Deployment

```bash
npx tsc && cp src/web/public/{app.js,index.html,style.css} dist/web/public/ && pm2 restart agjassist
```
