# 04 - Implementation Plan

**Source:** `01-business-requirements.md`, `02-system-architecture.md`, `03-ui-ux-plan.md`
**Agent:** pmanager (Opus simulation)
**Cost Mode:** saver40 — 60% elitedev01 (Opus), 40% elitedev02 (Sonnet)

---

## Pipeline Summary

| Agent | Status | Reason |
|-------|--------|--------|
| bsconsult (Opus) | COMPLETED | New business rules, auth model, delegation, workflow pipeline |
| sysarch (Opus) | COMPLETED | New API server, database, WebSocket, full data model |
| webdesign02 (Sonnet) | COMPLETED | Entirely new web and Mini App UI surfaces |
| pmanager (Opus) | THIS DOCUMENT | Sole mandatory output |

---

## Critical Path

```
Phase 1 (Foundation) → Phase 2 (Tmux) → Phase 3 (Delegation) → Phase 4 (Pipeline) → Phase 5 (UI) → Phase 6 (Conversations)
```

Each phase builds on the previous. No phase can start before the prior phase's core is working and tested.

---

## Phase 1: Foundation

**Goal:** API server running in same process as bot, Telegram auth working, SQLite schema initialized, project registry functional.

### TASK-001: Database Service + Schema Init
**Owner:** elitedev01 (Opus) — foundational infrastructure
**Priority:** P0 — everything depends on this
**Inputs:** Schema from `02-system-architecture.md`
**Outputs:**
- `src/db/database.ts` — DatabaseService class wrapping better-sqlite3
- SQLite database created at `data/agjassist.db`
- All tables from architecture doc created on first run
- WAL mode enabled
- Schema version tracking (simple version integer in a `schema_version` table)

**Acceptance Criteria:**
- [x] Database file created in `data/` directory
- [x] All tables exist with correct columns and constraints
- [x] WAL mode is active
- [x] Schema version is tracked
- [x] Service exposes typed query methods for each table
- [x] Unit tests pass for schema creation and basic CRUD

**Estimated Complexity:** Medium

---

### TASK-002: Configuration Extensions
**Owner:** elitedev02 (Sonnet) — straightforward config additions
**Priority:** P0
**Inputs:** New env vars needed for API server, auth, database
**Outputs:** Extended `src/config/config.ts`

**New env vars:**
```
API_PORT=3100
API_HOST=0.0.0.0
JWT_SECRET=<random-secret>
DB_PATH=data/agjassist.db
SESSION_EXPIRY_HOURS=24
PROJECTS_ROOT=/home/agjrom/websites
TMUX_HISTORY_RETENTION_DAYS=7
TMUX_OUTPUT_BUFFER_LINES=5000
TMUX_STREAM_INTERVAL_MS=100
```

**Acceptance Criteria:**
- [x] New config fields added to AppConfig interface
- [x] Env vars loaded with sensible defaults
- [x] Existing config unchanged (backward compatible)
- [x] Unit test for new config loading

---

### TASK-003: Fastify API Server Setup
**Owner:** elitedev01 (Opus) — server architecture
**Priority:** P0
**Inputs:** TASK-001, TASK-002
**Outputs:**
- `src/api/server.ts` — createApiServer function
- Server starts on configured port alongside Telegram bot
- CORS configured for Telegram WebApp origins
- Static file serving from `src/web/public/`
- Health check endpoint: `GET /api/health`

**Acceptance Criteria:**
- [x] Server starts and responds to `/api/health`
- [x] CORS allows Telegram WebApp origins
- [x] Static files served at `/` path
- [x] Server integrated into `src/index.ts` startup

---

### TASK-004: Telegram Auth Service
**Owner:** elitedev01 (Opus) — security-critical
**Priority:** P0
**Inputs:** TASK-001, TASK-003
**Outputs:**
- `src/auth/telegram-auth.ts` — initData validation function
- `src/auth/auth-service.ts` — session creation, JWT issue/verify, user management
- `src/auth/auth-middleware.ts` — Fastify preHandler hook for protected routes
- `src/api/routes/auth-routes.ts` — auth endpoints

**Acceptance Criteria:**
- [x] `POST /api/auth/telegram` validates initData and returns JWT
- [x] Invalid initData returns 401
- [x] Unauthorized user (not in allowlist) returns 403
- [x] `GET /api/auth/me` returns user info with valid token
- [x] `POST /api/auth/logout` invalidates session
- [x] Auth middleware rejects requests without valid token
- [x] Owner user auto-created from AUTHORIZED_USER_ID on first run
- [x] Unit tests for initData validation with test vectors

---

### TASK-005: Project Service + Routes
**Owner:** elitedev02 (Sonnet) — straightforward CRUD
**Priority:** P1
**Inputs:** TASK-001, TASK-003, TASK-004
**Outputs:**
- `src/services/project-service.ts`
- `src/api/routes/project-routes.ts`

**Acceptance Criteria:**
- [x] `GET /api/projects` returns list of projects from ~/websites
- [x] Projects auto-discovered from directory scan
- [x] Project metadata persisted in SQLite
- [x] `PATCH /api/projects/:id` updates display name and status
- [x] `POST /api/projects/refresh` rescans directory
- [x] Archived projects hidden from default list
- [x] Auth required on all endpoints

---

### TASK-006: Safety Service
**Owner:** elitedev02 (Sonnet) — pattern matching logic
**Priority:** P1
**Inputs:** TASK-001
**Outputs:**
- `src/services/safety-service.ts`
- `src/api/routes/safety-routes.ts`
- Default safety patterns seeded on first run

**Acceptance Criteria:**
- [x] Default patterns created in database on init
- [x] `POST /api/safety/check` correctly matches commands against active patterns
- [x] Patterns can be toggled on/off
- [x] CRUD endpoints work with auth
- [x] Both prefix and regex matching supported
- [x] Unit tests for pattern matching edge cases

---

### TASK-007: Audit Service
**Owner:** elitedev02 (Sonnet) — simple logging service
**Priority:** P1
**Inputs:** TASK-001
**Outputs:**
- `src/services/audit-service.ts`
- `src/api/routes/audit-routes.ts`

**Acceptance Criteria:**
- [x] `AuditService.log()` writes to audit_log table
- [x] `GET /api/audit` returns filtered results (by type, agent, time range)
- [x] Pagination support
- [x] Auth required

---

### Phase 1 Milestone: MS-001
**Evidence required:**
- `npm run test` passes all Phase 1 tests
- Server starts and serves `/api/health`
- Auth flow works end-to-end with test initData
- Projects listed from ~/websites
- Safety patterns seeded and checkable
- Audit log records test entries

---

## Phase 2: Tmux Workspace

**Goal:** Full tmux lifecycle, real-time streaming via WebSocket, output history.

### TASK-008: TmuxService Extensions
**Owner:** elitedev01 (Opus) — core infrastructure
**Priority:** P0
**Inputs:** Existing `src/tmux/tmux-service.ts`, TASK-001, TASK-006
**Outputs:** Extended TmuxService with lifecycle management

**New methods:**
- `createSession(name, cwd)` — creates tmux session
- `createPane(sessionTarget, cwd)` — splits pane
- `terminateSession(sessionName)` — kills session
- `terminatePane(target)` — kills pane
- Safety check integration on `sendCommand`

**Acceptance Criteria:**
- [x] Create/terminate sessions and panes
- [x] Safety check before command execution
- [x] Session lifecycle tracked in SQLite
- [x] Existing listPanes/peekPane/sendCommand unchanged
- [x] All operations audited
- [x] Unit tests for new methods

---

### TASK-009: Tmux Stream Manager
**Owner:** elitedev01 (Opus) — WebSocket + real-time
**Priority:** P0
**Inputs:** TASK-008, TASK-003
**Outputs:**
- `src/tmux/tmux-stream-manager.ts`
- `src/api/websocket/tmux-stream.ts`

**Implementation:**
- Periodic capture-pane polling (100ms interval)
- Diff against previous capture, send only new content
- WebSocket endpoint: `WS /ws/tmux/:target`
- Auth via token query parameter
- Multiple clients per pane supported
- Initial snapshot on connect
- Resize handling
- Safety check on input commands

**Acceptance Criteria:**
- [x] WebSocket connects with valid token
- [x] Initial snapshot sent on connect
- [x] Live output streaming works
- [x] Input commands sent to pane
- [x] Safety-blocked commands return safety_block message
- [x] Connection cleanup on disconnect
- [x] Multiple concurrent viewers work
- [x] Integration test with real tmux (if available)

---

### TASK-010: Tmux Output History
**Owner:** elitedev02 (Sonnet) — periodic capture + storage
**Priority:** P1
**Inputs:** TASK-008, TASK-001
**Outputs:** Output history capture and query

**Acceptance Criteria:**
- [x] Periodic snapshots stored in tmux_output_history table
- [x] Configurable interval (default 60s)
- [x] History queryable by session, time range, keyword search
- [x] Retention policy enforced (default 7 days)
- [x] Cleanup runs on startup and periodically

---

### TASK-011: Tmux API Routes
**Owner:** elitedev02 (Sonnet) — route wiring
**Priority:** P1
**Inputs:** TASK-008, TASK-009, TASK-010, TASK-004
**Outputs:** `src/api/routes/tmux-routes.ts`

**Acceptance Criteria:**
- [x] All tmux endpoints from architecture doc implemented
- [x] Auth required on all endpoints
- [x] Owner role required for create/terminate
- [x] Proper error responses for invalid targets
- [x] API tests pass

---

### TASK-012: Telegram Bot Tmux Extensions
**Owner:** elitedev02 (Sonnet) — bot command additions
**Priority:** P2
**Inputs:** TASK-008
**Outputs:** New bot commands in assistant-core.ts

**New commands:**
- `/tmux_create <project> [name]`
- `/tmux_kill <target>` (with confirmation)

**Acceptance Criteria:**
- [x] Commands create/terminate sessions
- [x] Safety confirmation for kill
- [x] Existing commands unchanged
- [x] Tests updated

---

### Phase 2 Milestone: MS-002
**Evidence required:**
- Tmux sessions can be created/terminated via API
- WebSocket streaming works end-to-end
- Output history captured and queryable
- Safety checks enforced on commands
- All Phase 2 tests pass

---

## Phase 3: Agent Delegation

**Goal:** Authority model working, agents can be granted/revoked access to tmux sessions.

### TASK-013: Delegation Service
**Owner:** elitedev01 (Opus) — security-critical authority model
**Priority:** P0
**Inputs:** TASK-001, TASK-007, TASK-008
**Outputs:** `src/services/delegation-service.ts`

**Methods:**
- `grant(agentName, tmuxSessionId, paneTarget, authority, grantedBy)`
- `revoke(delegationId)`
- `changeAuthority(delegationId, newAuthority)`
- `checkAuthority(agentName, paneTarget)` — returns authority level or null
- `listActive(filters?)` — list active delegations
- `revokeAll(tmuxSessionId)` — revoke all when session terminated

**Acceptance Criteria:**
- [x] Grant/revoke/change authority works
- [x] Authority check returns correct level
- [x] Revoking discards pending suggestions
- [x] All operations audited
- [x] Auto-revoke on session termination
- [x] Unit tests for all authority scenarios

---

### TASK-014: Authority Enforcement in TmuxService
**Owner:** elitedev01 (Opus) — security enforcement
**Priority:** P0
**Inputs:** TASK-013, TASK-008
**Outputs:** Authority checks in tmux operations

**Acceptance Criteria:**
- [x] Agent tmux operations check delegation authority
- [x] Observe: read allowed, write blocked
- [x] Suggest: read allowed, commands queued for approval
- [x] Execute: read and write allowed (with safety checks)
- [x] No authority: all tmux operations blocked for agent
- [x] Tests for each authority level

---

### TASK-015: Delegation API Routes
**Owner:** elitedev02 (Sonnet) — route wiring
**Priority:** P1
**Inputs:** TASK-013, TASK-004
**Outputs:** `src/api/routes/delegation-routes.ts`

**Acceptance Criteria:**
- [x] All delegation endpoints from architecture doc
- [x] Owner role required for grant/revoke
- [x] Proper validation on all inputs
- [x] API tests pass

---

### TASK-016: Delegation Telegram Commands
**Owner:** elitedev02 (Sonnet) — bot commands
**Priority:** P2
**Inputs:** TASK-013
**Outputs:** New commands in assistant-core.ts

**Commands:**
- `delegate <agent> <session> <level>`
- `revoke <agent> <session>`
- `delegations` — list active

**Acceptance Criteria:**
- [x] Commands work from Telegram
- [x] Confirmation prompts for dangerous operations
- [x] Tests updated

---

### Phase 3 Milestone: MS-003
**Evidence required:**
- Delegation grant/revoke works via API and Telegram
- Authority enforcement blocks unauthorized agent operations
- Audit log captures all delegation actions
- All Phase 3 tests pass

---

## Phase 4: Notes-Plans-Execution Pipeline

**Goal:** Full workflow from note creation through task execution tracking.

### TASK-017: Note Service + Routes
**Owner:** elitedev02 (Sonnet) — CRUD service
**Priority:** P0
**Inputs:** TASK-001, TASK-004, TASK-007
**Outputs:**
- `src/services/note-service.ts`
- `src/api/routes/note-routes.ts`

**Acceptance Criteria:**
- [x] CRUD for notes scoped to projects
- [x] Promote note to plan (creates plan, links note, updates note status)
- [x] Tag support
- [x] All operations audited
- [x] API tests pass

---

### TASK-018: Plan Service + Routes
**Owner:** elitedev02 (Sonnet) — CRUD with steps
**Priority:** P0
**Inputs:** TASK-001, TASK-017
**Outputs:**
- `src/services/plan-service.ts`
- `src/api/routes/plan-routes.ts`

**Acceptance Criteria:**
- [x] CRUD for plans scoped to projects
- [x] Steps: add, update, reorder, mark complete
- [x] Plan-note linkage maintained
- [x] Status transitions (draft → active → completed)
- [x] API tests pass

---

### TASK-019: Task Service + Routes
**Owner:** elitedev01 (Opus) — execution tracking, more complex
**Priority:** P0
**Inputs:** TASK-001, TASK-018, TASK-013
**Outputs:**
- `src/services/task-service.ts`
- `src/api/routes/task-routes.ts`

**Acceptance Criteria:**
- [x] CRUD for tasks linked to plans and projects
- [x] Assignment to agent or operator
- [x] Auto-delegation on agent assignment (if tmux session set)
- [x] Execution tracking: start, complete, fail
- [x] Execution history queryable
- [x] Status transitions enforced
- [x] API tests pass

---

### TASK-020: Workflow Telegram Commands
**Owner:** elitedev02 (Sonnet) — bot commands
**Priority:** P2
**Inputs:** TASK-017, TASK-018, TASK-005
**Outputs:** New bot commands

**Commands:**
- `/projects` — list projects with counts
- `/note <project> <text>` — quick note creation
- `/notes <project>` — list recent notes

**Acceptance Criteria:**
- [x] Commands work from Telegram
- [x] Output is concise and readable
- [x] Tests updated

---

### Phase 4 Milestone: MS-004
**Evidence required:**
- Full note → plan → task workflow works via API
- Task execution tracking records start/complete/fail
- Telegram quick-note command works
- All Phase 4 tests pass

---

## Phase 5: Web & Mini App UI

**Goal:** Frontend application consuming all backend APIs.

### TASK-021: Static File Serving + HTML Shell
**Owner:** elitedev02 (Sonnet) — boilerplate setup
**Priority:** P0
**Inputs:** TASK-003, `03-ui-ux-plan.md`
**Outputs:**
- `src/web/public/index.html` — HTML shell with CDN imports
- Fastify static file serving configured
- Preact + HTM loaded and rendering

**Acceptance Criteria:**
- [x] `http://localhost:3100/` serves the app
- [x] Preact renders a test component
- [x] Dark theme applied
- [x] Works in Telegram WebApp context

---

### TASK-022: Auth Flow UI + Router
**Owner:** elitedev01 (Opus) — auth integration
**Priority:** P0
**Inputs:** TASK-021, TASK-004
**Outputs:**
- Login screen component
- Auth state management
- Client-side router (hash-based)
- API client module with auth header injection

**Acceptance Criteria:**
- [x] Login screen shown when unauthenticated
- [x] Telegram WebApp auth auto-triggers in Mini App
- [x] Web app shows connect instructions
- [x] Token stored in localStorage
- [x] All API calls include auth header
- [x] Logout works

---

### TASK-023: Dashboard + Project List
**Owner:** elitedev02 (Sonnet) — UI components
**Priority:** P0
**Inputs:** TASK-022, TASK-005
**Outputs:**
- Dashboard component with project cards
- Project detail view shell with tab navigation

**Acceptance Criteria:**
- [x] Projects load and display in card grid
- [x] Status counts shown (sessions, notes, plans, tasks)
- [x] Click navigates to project detail
- [x] Responsive: grid on desktop, list on mobile
- [x] Loading and empty states handled

---

### TASK-024: Terminal View (xterm.js)
**Owner:** elitedev01 (Opus) — complex integration
**Priority:** P0
**Inputs:** TASK-023, TASK-009
**Outputs:**
- Terminal tab component
- Session/pane tree component
- xterm.js integration with WebSocket
- Safety confirmation dialog

**Acceptance Criteria:**
- [x] xterm.js renders in terminal panel
- [x] WebSocket connects and streams output
- [x] User can type commands
- [x] Safety-blocked commands show confirmation dialog
- [x] Session tree shows all panes
- [x] New session creation from UI
- [x] Resize works
- [x] Mobile: full-screen terminal mode

---

### TASK-025: Notes UI
**Owner:** elitedev02 (Sonnet) — CRUD UI
**Priority:** P1
**Inputs:** TASK-023, TASK-017
**Outputs:**
- Notes tab component
- Note list, note editor, promote button

**Acceptance Criteria:**
- [x] Notes list with search/filter
- [x] Create/edit/delete notes
- [x] Markdown preview
- [x] Promote to plan action
- [x] Responsive layout

---

### TASK-026: Plans + Tasks UI
**Owner:** elitedev02 (Sonnet) — CRUD UI with kanban
**Priority:** P1
**Inputs:** TASK-023, TASK-018, TASK-019
**Outputs:**
- Plans tab with step management
- Tasks tab with kanban board
- Task detail with execution history

**Acceptance Criteria:**
- [x] Plans list with status filters
- [x] Plan detail with ordered steps
- [x] Step completion toggling
- [x] Task kanban board (drag optional, click to change status)
- [x] Task assignment and execution tracking
- [x] Responsive layout

---

### TASK-027: Settings + Delegation + Activity UI
**Owner:** elitedev02 (Sonnet) — remaining UI
**Priority:** P2
**Inputs:** TASK-023, TASK-006, TASK-015, TASK-007
**Outputs:**
- Settings view (safety patterns, users)
- Delegation panel
- Activity/audit log view

**Acceptance Criteria:**
- [x] Safety patterns CRUD with toggles
- [x] User allowlist management
- [x] Delegation controls (grant/revoke/change)
- [x] Audit log with filters and pagination
- [x] All views responsive

---

### Phase 5 Milestone: MS-005
**Evidence required:**
- Full web app functional at localhost:3100
- Auth flow works in browser
- Terminal view streams live tmux output
- Notes/plans/tasks CRUD works in UI
- Settings and delegation controls work
- All Phase 5 tests pass (API + manual UI verification)

---

## Phase 6: Agent Conversation & Tooling

**Goal:** Chat interface with agents, conversation persistence, project context.

### TASK-028: Conversation Service + Routes
**Owner:** elitedev02 (Sonnet) — CRUD service
**Priority:** P1
**Inputs:** TASK-001, TASK-004
**Outputs:**
- `src/services/conversation-service.ts`
- `src/api/routes/conversation-routes.ts`

**Acceptance Criteria:**
- [x] CRUD for conversations per project per agent
- [x] Message history stored as JSON in SQLite
- [x] Agent routing uses existing LLM providers and CLI runner
- [x] Project context injected into agent system prompt
- [x] API tests pass

---

### TASK-029: Conversation UI
**Owner:** elitedev02 (Sonnet) — chat interface
**Priority:** P1
**Inputs:** TASK-028, TASK-023
**Outputs:**
- Conversation view component
- Chat panel with message bubbles
- Agent selector, project selector

**Acceptance Criteria:**
- [x] Chat-style interface works
- [x] Messages sent to agent and response displayed
- [x] Conversation history persisted and loadable
- [x] Agent tool usage shown as collapsible blocks
- [x] Responsive layout

---

### Phase 6 Milestone: MS-006 (Final)
**Evidence required:**
- Agent conversations work from web UI
- Conversation history persists across sessions
- Project context visible in agent responses
- All tests pass
- Full platform functional end-to-end

---

## Task Distribution Summary

### elitedev01 (Opus) — 60% (11 tasks)
TASK-001, TASK-003, TASK-004, TASK-008, TASK-009, TASK-013, TASK-014, TASK-019, TASK-022, TASK-024

### elitedev02 (Sonnet) — 40% (19 tasks)
TASK-002, TASK-005, TASK-006, TASK-007, TASK-010, TASK-011, TASK-012, TASK-015, TASK-016, TASK-017, TASK-018, TASK-020, TASK-021, TASK-023, TASK-025, TASK-026, TASK-027, TASK-028, TASK-029

---

## Execution Protocol

### One-Shot Contract
Each task has exactly two outcomes:
1. **Completed** — all acceptance criteria met, tests green
2. **Escalated** — blocker documented, handed to next agent or user

### Implementation Loop
- 2 iterations max per task
- If iteration 1 fails: document why, pivot approach, try iteration 2
- If iteration 2 fails: escalate

### Testing Loop
- 3 iterations max per test fix
- If tests still fail after 3 attempts: escalate

### Escalation Protocol
1. Try alternative approach (1 attempt)
2. Escalate to Opus if running as Sonnet
3. Escalate to user with full context packet

### Telegram Notifications
Send notification at each milestone completion:
```bash
curl -X POST http://127.0.0.1:8701/notify \
  -H "Content-Type: application/json" \
  -d '{"name":"pmanager","project":"AGJAssist","model":"Opus","message":"..."}'
```

---

## Dependencies Graph

```
TASK-001 (DB) ─────┬──> TASK-003 (API Server) ──> TASK-004 (Auth) ──┐
                   │                                                 │
TASK-002 (Config) ─┘                                                 │
                                                                     │
TASK-006 (Safety) <── TASK-001                                       │
TASK-007 (Audit) <── TASK-001                                        │
                                                                     │
TASK-005 (Projects) <── TASK-003 + TASK-004 ─────────────────────────┘
                                                                     │
TASK-008 (Tmux Ext) <── TASK-001 + TASK-006                          │
TASK-009 (Stream) <── TASK-008 + TASK-003                            │
TASK-010 (History) <── TASK-008                                      │
TASK-011 (Tmux API) <── TASK-008 + TASK-009 + TASK-004               │
TASK-012 (Bot Tmux) <── TASK-008                                     │
                                                                     │
TASK-013 (Delegation) <── TASK-001 + TASK-007 + TASK-008             │
TASK-014 (Authority) <── TASK-013                                    │
TASK-015 (Deleg API) <── TASK-013 + TASK-004                         │
TASK-016 (Deleg Bot) <── TASK-013                                    │
                                                                     │
TASK-017 (Notes) <── TASK-001 + TASK-004                             │
TASK-018 (Plans) <── TASK-017                                        │
TASK-019 (Tasks) <── TASK-018 + TASK-013                             │
TASK-020 (Bot Wkfl) <── TASK-017 + TASK-005                          │
                                                                     │
TASK-021 (HTML Shell) <── TASK-003                                   │
TASK-022 (Auth UI) <── TASK-021 + TASK-004                           │
TASK-023 (Dashboard) <── TASK-022 + TASK-005                         │
TASK-024 (Terminal) <── TASK-023 + TASK-009                          │
TASK-025 (Notes UI) <── TASK-023 + TASK-017                          │
TASK-026 (Plans UI) <── TASK-023 + TASK-018 + TASK-019               │
TASK-027 (Settings) <── TASK-023 + TASK-006 + TASK-015               │
                                                                     │
TASK-028 (Conv Svc) <── TASK-001 + TASK-004                          │
TASK-029 (Conv UI) <── TASK-028 + TASK-023                           │
```

---

## New Dependencies (npm packages)

```
Production:
  fastify
  @fastify/websocket
  @fastify/static
  @fastify/cors
  better-sqlite3
  jsonwebtoken

Dev:
  @types/better-sqlite3
  @types/jsonwebtoken
```

---

## Definition of Done (Full Project)

1. All 29 tasks completed with acceptance criteria met
2. All 6 milestone evidence verified
3. `npm run test` passes all tests
4. Platform accessible at localhost:3100
5. Telegram bot continues working with existing commands
6. New commands functional (/projects, /note, /delegate, etc.)
7. Auth flow works end-to-end (Telegram → token → API access)
8. Terminal streaming works with < 200ms latency
9. Notes → Plans → Tasks workflow functional
10. Agent delegation with all 3 authority levels working
11. Safety patterns enforced on all command execution paths
12. Audit log captures all actions
13. UI responsive at 375px+ viewports
