# 02 - System Architecture Specification
## AGJAssist Plan04 — Schema, API, Component Architecture
**Version:** 1.0
**Date:** 2026-03-09
**Status:** Approved
**Author:** sysarch (Opus-tier analysis)
**Input:** 01-business-requirements.md

---

## 1. Current Architecture Snapshot

```
┌─────────────────────────────────────────────────┐
│                  Frontend (app.js)               │
│  Preact + htm (no build step, ESM CDN imports)   │
│  Hash-based routing · Port 3101                  │
├─────────────────────────────────────────────────┤
│              Fastify API Server                  │
│  Routes: auth, projects, tmux, notes, plans,     │
│  tasks, conversations, personal-tasks, reminders │
│  chat, chat-settings, templates, safety, audit   │
├─────────────────────────────────────────────────┤
│           Service Layer (TypeScript)             │
│  ProjectService, PersonalTaskService,            │
│  ReminderService, ConversationService,           │
│  ChatSettingsService, etc.                       │
├─────────────────────────────────────────────────┤
│        better-sqlite3 (WAL mode, FK on)          │
│        Schema v5 · data/agj-assist.sqlite        │
└─────────────────────────────────────────────────┘
```

---

## 2. Schema Changes (v5 -> v6)

### 2.1 Projects Table — Add `active` Column

```sql
-- Migration v5 -> v6: Step 1
ALTER TABLE projects ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
```

**Rationale:** `active` controls UI expand/collapse state. Independent of `status` (active/archived). Default 1 = expanded.

### 2.2 Personal Tasks — Day-of-Week Bitmask Migration

```sql
-- Migration v5 -> v6: Step 2
-- Repurpose day_of_week from single-day integer (0-6) to bitmask (0-127)
-- Existing data migration:
-- NULL -> 127 (all days, for daily tasks)
-- NULL -> NULL (for weekly/once tasks, unchanged)
-- 0 (Sunday) -> 1 (bit 0)
-- 1 (Monday) -> 2 (bit 1)
-- 2 (Tuesday) -> 4 (bit 2)
-- 3 (Wednesday) -> 8 (bit 3)
-- 4 (Thursday) -> 16 (bit 4)
-- 5 (Friday) -> 32 (bit 5)
-- 6 (Saturday) -> 64 (bit 6)
```

Migration code:
```typescript
// In database.ts initSchema():
if (current && current.version < 6) {
  // Step 1: Add active column to projects
  const projCols = this.db.pragma("table_info(projects)") as { name: string }[];
  if (!projCols.some(c => c.name === "active")) {
    this.db.exec("ALTER TABLE projects ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  }

  // Step 2: Migrate day_of_week from single-day to bitmask
  // Only migrate daily tasks that have a single-day value (0-6)
  const dayToBitmask = [1, 2, 4, 8, 16, 32, 64]; // Sun=1, Mon=2, ..., Sat=64
  const dailyTasks = this.db.prepare(
    "SELECT id, day_of_week FROM personal_tasks WHERE frequency = 'daily' AND day_of_week IS NOT NULL AND day_of_week <= 6"
  ).all() as { id: number; day_of_week: number }[];

  for (const task of dailyTasks) {
    const bitmask = dayToBitmask[task.day_of_week];
    this.db.prepare("UPDATE personal_tasks SET day_of_week = ? WHERE id = ?").run(bitmask, task.id);
  }

  // Set NULL day_of_week to 127 (all days) for daily tasks
  this.db.prepare(
    "UPDATE personal_tasks SET day_of_week = 127 WHERE frequency = 'daily' AND day_of_week IS NULL"
  ).run();

  // Step 3: Add completed_at column for auto-archive tracking
  const ptCols = this.db.pragma("table_info(personal_tasks)") as { name: string }[];
  if (!ptCols.some(c => c.name === "completed_at")) {
    this.db.exec("ALTER TABLE personal_tasks ADD COLUMN completed_at TEXT");
  }
}
```

### 2.3 Personal Tasks — Add `completed_at` Column

```sql
-- Migration v5 -> v6: Step 3
ALTER TABLE personal_tasks ADD COLUMN completed_at TEXT;
```

**Purpose:** Tracks when a task was last completed, enabling auto-archive calculation.

### 2.4 Schema Version Update

```sql
UPDATE schema_version SET version = 6;
```

### 2.5 Complete Updated Schema (relevant tables only)

```sql
-- Projects (modified)
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  directory_name TEXT UNIQUE NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  active INTEGER NOT NULL DEFAULT 1,  -- NEW: UI expand/collapse state
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personal Tasks (modified)
CREATE TABLE IF NOT EXISTS personal_tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL CHECK(frequency IN ('once', 'daily', 'weekly')),
  day_of_week INTEGER,      -- CHANGED: now bitmask 0-127 (bit0=Sun..bit6=Sat)
  due_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,         -- NEW: last completion timestamp for auto-archive
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 3. API Changes

### 3.1 Projects API

#### `PATCH /api/projects/:id` — Extend Body
```typescript
// Existing: { display_name?: string; status?: "active" | "archived" }
// Updated:  { display_name?: string; status?: "active" | "archived"; active?: number }
```

No new endpoint needed. Existing PATCH route already supports arbitrary body fields; just add `active` to the `ProjectService.update()` method.

#### `GET /api/projects` — Updated Response
```typescript
// ProjectWithCounts interface updated:
interface ProjectWithCounts extends Project {
  // tmux_session_count: number;  -- KEEP in query but don't use in UI
  open_notes_count: number;
  active_plans_count: number;
  pending_tasks_count: number;
  active: number;  // NEW field in response
}
```

### 3.2 Personal Tasks API

#### `GET /api/personal-tasks` — Add Day Filter
```
GET /api/personal-tasks?frequency=daily&day=1  // Monday (bitmask bit position)
```

New optional query parameter `day` (0-6, matching JS Date.getDay()):
- When provided with `frequency=daily`, filters tasks where `(day_of_week & (1 << day)) !== 0`
- Default: no day filter (returns all tasks of that frequency)

#### `POST /api/personal-tasks` — Updated Body
```typescript
// day_of_week now accepts bitmask (0-127) instead of single day (0-6)
{
  title: string;
  description?: string;
  frequency: string;
  day_of_week?: number; // bitmask: 127 = all days, 42 = MWF, etc.
  due_date?: string;
}
```

#### `POST /api/personal-tasks/:id/toggle` — Update completed_at
When toggling completion ON, also set `completed_at = datetime('now')` on the task.
When toggling completion OFF, clear `completed_at = NULL`.

#### `GET /api/personal-tasks/archive-eligible` — NEW Endpoint
Returns tasks eligible for auto-archiving:
```typescript
// Response:
{
  tasks: Array<{
    id: number;
    title: string;
    frequency: string;
    completed_at: string;
    archive_after: string; // computed: completed_at + delay
  }>
}
```

Rules:
- Daily: `completed_at` + 24 hours < now
- Weekly: `completed_at` + 48 hours < now

#### `POST /api/personal-tasks/auto-archive` — NEW Endpoint
Archives all eligible tasks. Called by the scheduler.

### 3.3 Reminders API

#### `GET /api/reminders?view=tasks` — NEW Query Parameter
Returns reminders filtered for the Tasks view:
- Active reminders where at least one alert has `sent = 1`, OR `event_date <= now`
- Excludes reminders that should be auto-archived (event_date + 3 hours < now AND active = 1)

#### Auto-archive logic for reminders:
- When `event_date + 3 hours < now` and `sent_event = 1`, automatically set `active = 0`.

### 3.4 Conversations API

#### `GET /api/agents` — NEW Endpoint
Returns the list of available agents for the dropdown.
```typescript
// Response:
{
  agents: Array<{
    id: string;       // e.g., "bsconsult"
    name: string;     // e.g., "StratForge Consultant"
    model: string;    // e.g., "Opus"
    description: string;
  }>
}
```

Hardcoded list derived from REGISTRY.md. No DB table needed — this is a static configuration endpoint.

---

## 4. Service Layer Changes

### 4.1 ProjectService Updates

```typescript
// src/services/project-service.ts

// Update Project interface:
export interface Project {
  id: number;
  directory_name: string;
  display_name: string | null;
  status: string;
  active: number;     // NEW
  created_at: string;
  updated_at: string;
}

// Update update() method to handle active field:
update(id: number, updates: {
  display_name?: string | null;
  status?: "active" | "archived";
  active?: number;    // NEW
}): Project | null {
  // ... existing logic ...
  const active = updates.active !== undefined ? updates.active : existing.active;
  // Include active in UPDATE statement
}
```

### 4.2 PersonalTaskService Updates

```typescript
// src/services/personal-task-service.ts

// New method: listForDay
listForDay(userId: number, dayOfWeek: number): PersonalTaskWithStatus[] {
  // dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat
  const bitmask = 1 << dayOfWeek;
  const sql = `SELECT * FROM personal_tasks
    WHERE created_by = ? AND active = 1 AND frequency = 'daily'
    AND (day_of_week & ?) != 0
    ORDER BY created_at DESC`;
  // ... compute completion status ...
}

// New method: getArchiveEligible
getArchiveEligible(): PersonalTask[] {
  const now = new Date();
  const daily24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekly48h = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  return this.db.prepare(`
    SELECT * FROM personal_tasks
    WHERE active = 1 AND completed_at IS NOT NULL
    AND (
      (frequency = 'daily' AND completed_at < ?)
      OR (frequency = 'weekly' AND completed_at < ?)
    )
  `).all(daily24h, weekly48h) as PersonalTask[];
}

// New method: autoArchive
autoArchive(): number {
  const eligible = this.getArchiveEligible();
  let count = 0;
  for (const task of eligible) {
    this.db.prepare(
      "UPDATE personal_tasks SET active = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(task.id);
    count++;
  }
  return count;
}

// Update toggleCompletion to track completed_at
toggleCompletion(taskId: number, date: string): boolean {
  // ... existing toggle logic ...
  // After toggling ON: update completed_at
  if (nowCompleted) {
    this.db.prepare(
      "UPDATE personal_tasks SET completed_at = datetime('now') WHERE id = ?"
    ).run(taskId);
  } else {
    this.db.prepare(
      "UPDATE personal_tasks SET completed_at = NULL WHERE id = ?"
    ).run(taskId);
  }
}
```

### 4.3 ReminderService Updates

```typescript
// src/services/reminder-service.ts

// New method: listForTasksView
listForTasksView(userId: number): ReminderWithAlerts[] {
  // Return active reminders where first alert has fired or event_date has passed
  const now = new Date().toISOString();
  const reminders = this.db.prepare(
    "SELECT * FROM reminders WHERE created_by = ? AND active = 1 ORDER BY event_date"
  ).all(userId) as Reminder[];

  return reminders
    .filter(r => {
      // Include if event_date <= now
      if (r.event_date <= now) return true;
      // Include if any alert has been sent
      const alerts = this.listAlerts(r.id);
      return alerts.some(a => a.sent === 1);
    })
    .map(r => ({ ...r, alerts: this.listAlerts(r.id) }));
}

// New method: autoArchiveReminders
autoArchiveReminders(): number {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const result = this.db.prepare(
    "UPDATE reminders SET active = 0, updated_at = datetime('now') WHERE active = 1 AND sent_event = 1 AND event_date < ?"
  ).run(threeHoursAgo);
  return result.changes;
}
```

### 4.4 New AgentRegistryService

```typescript
// src/services/agent-registry-service.ts

export interface AgentInfo {
  id: string;
  name: string;
  model: string;
  description: string;
}

// Static list — no DB needed
const AGENTS: AgentInfo[] = [
  { id: "bsconsult", name: "StratForge Consultant", model: "Opus", description: "Business requirements & functional specs" },
  { id: "bsconsult02", name: "StratForge Lite", model: "Sonnet", description: "Business requirements (cost-optimized)" },
  { id: "sysarch", name: "ArchForge", model: "Opus", description: "Systems architecture design" },
  { id: "sysarch02", name: "ArchForge Lite", model: "Sonnet", description: "Systems architecture (cost-optimized)" },
  { id: "webdesign", name: "WebForge", model: "Opus", description: "UI/UX design" },
  { id: "webdesign02", name: "WebForge Lite", model: "Sonnet", description: "UI/UX design (cost-optimized)" },
  { id: "elitedev01", name: "EliteDev", model: "Opus", description: "Full-stack engineer" },
  { id: "elitedev02", name: "EliteDev Lite", model: "Sonnet", description: "Full-stack engineer (cost-optimized)" },
  { id: "pmanager", name: "Project Manager", model: "Opus", description: "Project management & orchestration" },
  { id: "pmanager02", name: "Project Manager Lite", model: "Sonnet", description: "Project management (cost-optimized)" },
  { id: "tester", name: "QA Tester", model: "Opus", description: "Playwright testing" },
  { id: "tester02", name: "QA Tester Lite", model: "Sonnet", description: "Playwright testing (cost-optimized)" },
  { id: "bugfix", name: "Bug Fix Pipeline", model: "Sonnet", description: "Bug diagnosis & fix" },
  { id: "migrator", name: "CF Deployer", model: "Opus", description: "Cloudflare deployment" },
  { id: "migrator02", name: "CF Deployer Lite", model: "Sonnet", description: "Cloudflare deployment (cost-optimized)" },
];

export function getAgentList(): AgentInfo[] {
  return AGENTS;
}
```

---

## 5. Scheduler Updates

### 5.1 Auto-Archive Scheduler (in src/index.ts)

Add to the existing `setInterval` block (60-second interval):

```typescript
// Auto-archive tasks and reminders
try {
  const tasksArchived = personalTaskService.autoArchive();
  const remindersArchived = reminderService.autoArchiveReminders();
  if (tasksArchived > 0 || remindersArchived > 0) {
    console.log(`Auto-archived: ${tasksArchived} tasks, ${remindersArchived} reminders`);
  }
} catch {}
```

This piggybacks on the existing 60-second reminder check interval. No new timer needed.

---

## 6. Component Boundaries

```
┌───────────────────────────────────────────────────────┐
│                    FRONTEND (app.js)                   │
│                                                        │
│  ┌──────────┐  ┌──────────────────────────────────┐   │
│  │ Projects  │  │         Tasks Section             │   │
│  │  - Cards  │  │  ┌──────────┐  ┌──────────────┐  │   │
│  │  - Toggle │  │  │ Tasks Tab│  │  Setup Tab    │  │   │
│  │  - Green  │  │  │ - Daily  │  │  - Daily      │  │   │
│  │    dots   │  │  │ - Weekly │  │  - Weekly     │  │   │
│  └──────────┘  │  │ - Remind │  │  - Reminders  │  │   │
│                 │  │ - Archive│  └──────────────┘  │   │
│  ┌──────────┐  │  └──────────┘                     │   │
│  │ Converse │  └──────────────────────────────────┘   │
│  │  - Agent │                                          │
│  │  dropdown│  ┌──────────────────────────────────┐   │
│  │  - Model │  │         Settings                  │   │
│  │  selector│  │  - Account & Security             │   │
│  └──────────┘  │  - Chat Configuration             │   │
│                 │  - Agent Registry                 │   │
│                 │  - Step Templates                 │   │
│                 │  - Safety Patterns                │   │
│                 └──────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
          │
          │ HTTP/WS (port 3101)
          ▼
┌───────────────────────────────────────────────────────┐
│                  BACKEND (Fastify)                      │
│                                                        │
│  Routes:                                               │
│  - /api/projects/:id (PATCH: +active field)            │
│  - /api/personal-tasks (?frequency=&day=)              │
│  - /api/personal-tasks/auto-archive (POST)             │
│  - /api/reminders (?view=tasks)                        │
│  - /api/agents (GET — new)                             │
│                                                        │
│  Services:                                             │
│  - ProjectService (updated: active field)              │
│  - PersonalTaskService (updated: bitmask, auto-archive)│
│  - ReminderService (updated: tasks view, auto-archive) │
│  - AgentRegistryService (new: static agent list)       │
│                                                        │
│  Scheduler (60s interval):                             │
│  - Reminder alerts (existing)                          │
│  - Auto-archive tasks (new)                            │
│  - Auto-archive reminders (new)                        │
└───────────────────────────────────────────────────────┘
          │
          ▼
┌───────────────────────────────────────────────────────┐
│              better-sqlite3 (Schema v6)                │
│                                                        │
│  Modified tables:                                      │
│  - projects (+active column)                           │
│  - personal_tasks (day_of_week -> bitmask,             │
│                    +completed_at column)               │
└───────────────────────────────────────────────────────┘
```

---

## 7. Migration Strategy

### 7.1 Migration Steps (Automatic on Startup)

1. **Detect version:** Read `schema_version` table. If version < 6, proceed.
2. **Add `projects.active` column:** `ALTER TABLE projects ADD COLUMN active INTEGER NOT NULL DEFAULT 1`
3. **Migrate `day_of_week` data:**
   - For daily tasks with `day_of_week` 0-6: convert to bitmask (`1 << day_of_week`)
   - For daily tasks with `day_of_week IS NULL`: set to 127 (all days)
   - Weekly/once tasks: leave `day_of_week` as-is (NULL)
4. **Add `personal_tasks.completed_at` column:** `ALTER TABLE personal_tasks ADD COLUMN completed_at TEXT`
5. **Update schema_version** to 6.

### 7.2 Rollback Plan

Not needed — all changes are additive (new columns, data transformation). Existing code paths that don't use new columns will continue to work. The bitmask migration is one-way but safe since `day_of_week` was only used for weekly tasks (where it remains NULL).

### 7.3 Data Integrity Checks

- After migration, verify: `SELECT COUNT(*) FROM personal_tasks WHERE frequency = 'daily' AND day_of_week IS NULL` should be 0.
- All projects should have `active = 1` after migration (default).

---

## 8. Trade-off Analysis

| Decision | Option A | Option B | Chosen | Rationale |
|----------|----------|----------|--------|-----------|
| Day-of-week storage | Bitmask integer | Separate junction table | Bitmask | Simpler queries, no JOIN needed, 7 bits fits in INTEGER |
| Agent list source | DB table | Static code list | Static code | Agents change rarely, no CRUD needed, simpler |
| Auto-archive trigger | Scheduler (60s) | On-demand at query time | Scheduler | Consistent behavior, archive happens even if no UI is open |
| Project active column | New `active` column | Reuse `status` column | New column | `status` has different semantics (active/archived), need independent toggle |
| completed_at tracking | On personal_tasks table | On personal_task_completions | personal_tasks | Single column, simpler query for auto-archive eligibility |

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bitmask migration corrupts day_of_week data | Low | Medium | Guard: only migrate values 0-6, skip already-migrated values > 6 |
| Auto-archive runs too aggressively | Low | Low | Only archive tasks with non-null completed_at, check elapsed time |
| Frontend sub-tab state lost on navigation | Medium | Low | Use local state within component, reset on tab change |
| Agent list gets stale | Low | Low | Easy to update static list, not tied to DB |

---

## 10. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/db/database.ts` | MODIFY | Add v6 migration: projects.active, day_of_week bitmask, completed_at |
| `src/services/project-service.ts` | MODIFY | Add `active` to interface, update() method, list() response |
| `src/services/personal-task-service.ts` | MODIFY | Add listForDay(), getArchiveEligible(), autoArchive(), update toggleCompletion() |
| `src/services/reminder-service.ts` | MODIFY | Add listForTasksView(), autoArchiveReminders() |
| `src/services/agent-registry-service.ts` | CREATE | Static agent list, getAgentList() |
| `src/api/routes/project-routes.ts` | MODIFY | Pass `active` in PATCH handler |
| `src/api/routes/personal-task-routes.ts` | MODIFY | Add day query param, auto-archive endpoints |
| `src/api/routes/reminder-routes.ts` | MODIFY | Add view=tasks query param |
| `src/api/routes/agent-routes.ts` | CREATE | GET /api/agents endpoint |
| `src/api/server.ts` | MODIFY | Register agent routes, wire AgentRegistryService |
| `src/index.ts` | MODIFY | Add auto-archive to scheduler |
| `src/web/public/app.js` | MODIFY | Major frontend changes (all 4 areas) |
| `tests/unit/personal-tasks-reminders.spec.ts` | MODIFY | Add bitmask tests, auto-archive tests |
| `tests/unit/database.spec.ts` | MODIFY | Add v6 migration test |
