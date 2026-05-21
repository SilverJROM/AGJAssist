# 02 - System Architecture

**Source:** `01-business-requirements.md`, existing codebase
**Mode:** Upgrade
**Agent:** sysarch (Opus simulation)

---

## Architecture Overview

Single Node.js TypeScript process hosting three subsystems:
1. **Telegram Bot** (existing, extended)
2. **HTTP API Server** (new — Fastify)
3. **WebSocket Server** (new — ws library, attached to Fastify)

All subsystems share the same service layer, database connection, and configuration.

```
┌─────────────────────────────────────────────────────────────┐
│                     Node.js Process                          │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │ Telegram  │  │ Fastify HTTP │  │ WebSocket Server   │     │
│  │ Bot       │  │ API Server   │  │ (tmux streaming)   │     │
│  └─────┬─────┘  └──────┬───────┘  └────────┬───────────┘     │
│        │               │                   │                 │
│  ┌─────┴───────────────┴───────────────────┴──────────┐     │
│  │                  Service Layer                       │     │
│  │  AuthService · ProjectService · TmuxService          │     │
│  │  AgentDelegationService · NoteService · PlanService   │     │
│  │  TaskService · AuditService · SafetyService           │     │
│  └──────────────────────┬──────────────────────────────┘     │
│                         │                                    │
│  ┌──────────────────────┴──────────────────────────────┐     │
│  │                 Data Layer (SQLite)                    │     │
│  │                 better-sqlite3 + WAL mode             │     │
│  └───────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐     │
│  │              Existing Modules (preserved)              │     │
│  │  LlmProviders · ToolAgent · ToolRegistry · CliRunner   │     │
│  └───────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ARCH-001 | Fastify for HTTP API | Faster than Express, built-in TypeScript support, schema validation, plugin ecosystem |
| ARCH-002 | ws library for WebSocket | Lightweight, well-maintained, integrates with Fastify via @fastify/websocket |
| ARCH-003 | better-sqlite3 for SQLite | Synchronous API (simpler for single-process), WAL mode for concurrent reads, no async overhead |
| ARCH-004 | xterm.js for web terminal | Industry standard terminal emulator for browsers, handles escape sequences properly |
| ARCH-005 | Preact + HTM for frontend | Lightweight (~3KB), no build step needed initially, JSX-like syntax, fast enough for operator tool |
| ARCH-006 | JWT for session tokens | Stateless verification, works across all surfaces, standard library available |

---

## Data Model (SQLite Schema)

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Sessions Table
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,  -- UUID
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('bot', 'miniapp', 'web')),
  expires_at TEXT NOT NULL,
  last_activity TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

### Projects Table
```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  directory_name TEXT UNIQUE NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Tmux Sessions Table
```sql
CREATE TABLE tmux_sessions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  session_name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'terminated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  terminated_at TEXT
);
CREATE INDEX idx_tmux_project ON tmux_sessions(project_id);
```

### Tmux Output History Table
```sql
CREATE TABLE tmux_output_history (
  id INTEGER PRIMARY KEY,
  tmux_session_id INTEGER NOT NULL REFERENCES tmux_sessions(id),
  pane_target TEXT NOT NULL,
  content TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tmux_output_session ON tmux_output_history(tmux_session_id);
CREATE INDEX idx_tmux_output_time ON tmux_output_history(captured_at);
```

### Agent Delegations Table
```sql
CREATE TABLE agent_delegations (
  id INTEGER PRIMARY KEY,
  agent_name TEXT NOT NULL,
  tmux_session_id INTEGER NOT NULL REFERENCES tmux_sessions(id),
  pane_target TEXT,  -- NULL means all panes in session
  authority TEXT NOT NULL CHECK(authority IN ('observe', 'suggest', 'execute')),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX idx_delegations_agent ON agent_delegations(agent_name);
CREATE INDEX idx_delegations_session ON agent_delegations(tmux_session_id);
```

### Notes Table
```sql
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'promoted', 'archived')),
  tags TEXT,  -- JSON array of strings
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notes_project ON notes(project_id);
CREATE INDEX idx_notes_status ON notes(status);
```

### Plans Table
```sql
CREATE TABLE plans (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_plans_project ON plans(project_id);
```

### Plan Notes Junction Table
```sql
CREATE TABLE plan_notes (
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  note_id INTEGER NOT NULL REFERENCES notes(id),
  PRIMARY KEY (plan_id, note_id)
);
```

### Plan Steps Table
```sql
CREATE TABLE plan_steps (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  step_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_steps_plan ON plan_steps(plan_id);
```

### Tasks Table
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  plan_step_id INTEGER REFERENCES plan_steps(id),
  title TEXT NOT NULL,
  description TEXT,
  acceptance_criteria TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'blocked')),
  assigned_to TEXT,  -- agent name or 'operator'
  tmux_session_id INTEGER REFERENCES tmux_sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_plan ON tasks(plan_id);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
```

### Task Executions Table
```sql
CREATE TABLE task_executions (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  executor TEXT NOT NULL,  -- agent name or 'operator'
  tmux_session_id INTEGER REFERENCES tmux_sessions(id),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  output_summary TEXT,
  error_details TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX idx_executions_task ON task_executions(task_id);
```

### Command Safety Patterns Table
```sql
CREATE TABLE safety_patterns (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,
  description TEXT,
  is_regex INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Audit Log Table
```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id),
  agent_name TEXT,
  action_type TEXT NOT NULL,  -- 'command_execute', 'delegation_grant', 'note_create', etc.
  resource_type TEXT,  -- 'tmux', 'note', 'plan', 'task', 'delegation', 'safety'
  resource_id TEXT,
  details TEXT,  -- JSON with action-specific data
  tmux_target TEXT,
  surface TEXT CHECK(surface IN ('bot', 'miniapp', 'web', 'agent'))
);
CREATE INDEX idx_audit_time ON audit_log(timestamp);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_agent ON audit_log(agent_name);
CREATE INDEX idx_audit_type ON audit_log(action_type);
```

### Conversations Table
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  agent_name TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  messages TEXT NOT NULL DEFAULT '[]',  -- JSON array of {role, content, timestamp}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversations_agent ON conversations(agent_name);
```

---

## API Design

### Authentication Endpoints

```
POST /api/auth/telegram     — Validate Telegram initData, issue session token
POST /api/auth/logout        — Invalidate session
GET  /api/auth/me            — Get current user info
```

### Project Endpoints

```
GET    /api/projects              — List all projects (with status counts)
GET    /api/projects/:id          — Get project detail
PATCH  /api/projects/:id          — Update project (display name, status)
POST   /api/projects/refresh      — Rescan ~/websites directory
```

### Tmux Endpoints

```
GET    /api/tmux/sessions                    — List all tmux sessions with pane info
POST   /api/tmux/sessions                    — Create new session for a project
DELETE /api/tmux/sessions/:id                — Terminate a session
GET    /api/tmux/sessions/:id/panes          — List panes in a session
POST   /api/tmux/sessions/:id/panes          — Create a new pane/window
GET    /api/tmux/panes/:target/output        — Get recent pane output (snapshot)
GET    /api/tmux/panes/:target/history       — Get historical output with search
POST   /api/tmux/panes/:target/send          — Send command to pane (with safety check)
WS     /ws/tmux/:target                      — Real-time pane streaming (bidirectional)
```

### Agent Delegation Endpoints

```
GET    /api/delegations                              — List all active delegations
POST   /api/delegations                              — Grant authority
PATCH  /api/delegations/:id                          — Change authority level
DELETE /api/delegations/:id                          — Revoke delegation
GET    /api/delegations/agent/:agentName             — Get delegations for an agent
```

### Notes Endpoints

```
GET    /api/projects/:projectId/notes        — List notes for project
POST   /api/projects/:projectId/notes        — Create note
GET    /api/notes/:id                        — Get note detail
PATCH  /api/notes/:id                        — Update note
DELETE /api/notes/:id                        — Delete note
POST   /api/notes/:id/promote               — Promote note to plan
```

### Plans Endpoints

```
GET    /api/projects/:projectId/plans        — List plans for project
POST   /api/projects/:projectId/plans        — Create plan
GET    /api/plans/:id                        — Get plan with steps
PATCH  /api/plans/:id                        — Update plan
POST   /api/plans/:id/steps                  — Add step to plan
PATCH  /api/plans/:id/steps/:stepId          — Update step
```

### Tasks Endpoints

```
GET    /api/projects/:projectId/tasks        — List tasks for project
GET    /api/plans/:planId/tasks              — List tasks for plan
POST   /api/plans/:planId/tasks              — Create task from plan step
PATCH  /api/tasks/:id                        — Update task (status, assignment)
POST   /api/tasks/:id/execute                — Start task execution
GET    /api/tasks/:id/executions             — Get execution history
```

### Safety Endpoints

```
GET    /api/safety/patterns                  — List all patterns
POST   /api/safety/patterns                  — Add pattern
PATCH  /api/safety/patterns/:id              — Update pattern (toggle, edit)
DELETE /api/safety/patterns/:id              — Delete pattern
POST   /api/safety/check                     — Check a command against patterns
```

### Conversation Endpoints

```
GET    /api/conversations                    — List conversations
POST   /api/conversations                    — Start new conversation
GET    /api/conversations/:id                — Get conversation with messages
POST   /api/conversations/:id/messages       — Send message to agent
DELETE /api/conversations/:id                — Delete conversation
```

### Audit Endpoints

```
GET    /api/audit                            — Query audit log (with filters)
```

---

## WebSocket Protocol for Tmux Streaming

### Connection

```
WS /ws/tmux/:target?token=<session_token>
```

Target format: `session:window.pane`

### Client → Server Messages

```json
{ "type": "input", "data": "ls -la\n" }           // Keystroke/command input
{ "type": "resize", "cols": 120, "rows": 40 }      // Terminal resize
{ "type": "ping" }                                   // Keepalive
```

### Server → Client Messages

```json
{ "type": "output", "data": "..." }                 // Pane output chunk
{ "type": "snapshot", "data": "...", "lines": 200 } // Initial output snapshot on connect
{ "type": "error", "message": "..." }               // Error message
{ "type": "closed", "reason": "..." }               // Pane was terminated
{ "type": "pong" }                                   // Keepalive response
{ "type": "safety_block", "command": "...", "pattern": "...", "id": "..." }  // Command blocked by safety
```

### Streaming Implementation

The server uses `tmux pipe-pane` or periodic `capture-pane` polling to capture output:

**Approach: Periodic capture-pane (simpler, reliable)**
- Every 100ms, capture new output from the pane using `tmux capture-pane`.
- Diff against the previous capture.
- Send only new content to connected WebSocket clients.
- Trade-off: slightly higher latency (~100ms) but simpler, no pipe management.

**Fallback: pipe-pane (if lower latency needed)**
- `tmux pipe-pane -t <target> "cat >> /tmp/agjassist-pane-<target>.fifo"`
- Server reads from the FIFO and broadcasts to WebSocket clients.
- Lower latency but requires cleanup of pipes.

Start with periodic capture-pane. Upgrade to pipe-pane if latency is insufficient.

---

## Authentication Flow

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ TG Client │     │ Mini/Web App │     │ AGJAssist │
└─────┬─────┘     └──────┬───────┘     └────┬──────┘
      │                  │                   │
      │  Open Mini App   │                   │
      │ ─────────────── >│                   │
      │                  │                   │
      │                  │ POST /api/auth/telegram
      │                  │  { initData }     │
      │                  │ ─────────────── > │
      │                  │                   │
      │                  │   Validate HMAC   │
      │                  │   Check allowlist  │
      │                  │   Create session   │
      │                  │   Issue JWT        │
      │                  │                   │
      │                  │ { token, user }   │
      │                  │ < ─────────────── │
      │                  │                   │
      │                  │ All subsequent    │
      │                  │ requests use      │
      │                  │ Authorization:    │
      │                  │ Bearer <token>    │
      │                  │ ─────────────── > │
```

### Telegram initData Validation

```typescript
function validateTelegramAuth(initData: string, botToken: string): TelegramUser | null {
  // 1. Parse initData as URLSearchParams
  // 2. Extract hash parameter
  // 3. Create data-check-string (sorted key=value pairs, excluding hash)
  // 4. Create secret key: HMAC-SHA256(botToken, "WebAppData")
  // 5. Create hash: HMAC-SHA256(secret_key, data_check_string)
  // 6. Compare computed hash with provided hash
  // 7. Check auth_date is recent (within 24 hours)
  // 8. Return parsed user object if valid
}
```

---

## Component Boundaries

### Service Layer Contracts

Each service is a class instantiated once at startup and injected where needed.

| Service | Responsibility | Dependencies |
|---------|---------------|-------------|
| `DatabaseService` | SQLite connection, schema init, migrations | better-sqlite3 |
| `AuthService` | Telegram auth validation, session management, JWT | DatabaseService |
| `ProjectService` | Project registry, directory scanning | DatabaseService |
| `TmuxService` (extended) | Full tmux lifecycle, pane streaming, output capture | DatabaseService, SafetyService |
| `TmuxStreamManager` | WebSocket connection management, output broadcasting | TmuxService |
| `AgentDelegationService` | Authority grants/revokes, permission checks | DatabaseService, AuditService |
| `NoteService` | CRUD for notes | DatabaseService, AuditService |
| `PlanService` | CRUD for plans and steps | DatabaseService, AuditService |
| `TaskService` | CRUD for tasks, execution tracking | DatabaseService, AuditService |
| `SafetyService` | Command pattern matching, safety checks | DatabaseService |
| `AuditService` | Action logging | DatabaseService |
| `ConversationService` | Agent conversation persistence | DatabaseService |

### File Structure (Target)

```
src/
├── index.ts                        # Entry point (extended)
├── config/
│   └── config.ts                   # Configuration (extended)
├── db/
│   ├── database.ts                 # SQLite connection + schema init
│   └── migrations.ts               # Schema versioning
├── auth/
│   ├── auth-service.ts             # Telegram auth + session management
│   ├── auth-middleware.ts          # Fastify auth hook
│   └── telegram-auth.ts           # initData validation
├── api/
│   ├── server.ts                   # Fastify server setup
│   ├── routes/
│   │   ├── auth-routes.ts
│   │   ├── project-routes.ts
│   │   ├── tmux-routes.ts
│   │   ├── delegation-routes.ts
│   │   ├── note-routes.ts
│   │   ├── plan-routes.ts
│   │   ├── task-routes.ts
│   │   ├── safety-routes.ts
│   │   ├── conversation-routes.ts
│   │   └── audit-routes.ts
│   └── websocket/
│       └── tmux-stream.ts          # WebSocket handler for tmux
├── services/
│   ├── project-service.ts
│   ├── delegation-service.ts
│   ├── note-service.ts
│   ├── plan-service.ts
│   ├── task-service.ts
│   ├── safety-service.ts
│   ├── audit-service.ts
│   └── conversation-service.ts
├── tmux/
│   ├── tmux-service.ts             # Extended with lifecycle + streaming
│   └── tmux-stream-manager.ts      # WebSocket connection manager
├── bot/
│   ├── assistant-core.ts           # Extended with new commands
│   └── telegram-bot.ts             # Extended with Mini App button
├── llm/
│   ├── base-provider.ts            # Unchanged
│   ├── ollama-provider.ts          # Unchanged
│   └── openrouter-provider.ts      # Unchanged
├── orchestration/
│   └── tool-agent.ts               # Unchanged (tools extended)
├── tools/
│   └── tool-registry.ts            # Extended with new tools
├── cli/
│   └── agent-cli-runner.ts         # Unchanged
└── web/
    └── public/                     # Static frontend files
        ├── index.html
        ├── app.js                  # Preact + HTM app
        ├── terminal.js             # xterm.js integration
        └── style.css
```

---

## Risks, Trade-offs, and Mitigations

| ID | Trade-off | Decision | Rationale |
|----|-----------|----------|-----------|
| ARCH-T01 | Periodic capture vs pipe-pane for streaming | Start with capture-pane (100ms poll) | Simpler implementation, reliable cleanup, acceptable latency |
| ARCH-T02 | JWT vs opaque session tokens | JWT with SQLite session record | JWT for fast verification, SQLite record for revocation support |
| ARCH-T03 | Preact vs React vs vanilla for frontend | Preact + HTM | Minimal bundle size, no build step initially, sufficient for operator tool |
| ARCH-T04 | Single SQLite file vs separate per-project | Single database | Simpler backup/migration, sufficient for single-operator scale |
| ARCH-T05 | better-sqlite3 (sync) vs sqlite3 (async) | better-sqlite3 | Simpler code, faster for single-process, WAL handles concurrent reads |

---

## Phased Implementation Strategy

### Phase 1: Foundation
- DatabaseService + schema initialization
- AuthService + Telegram initData validation
- Fastify server setup + auth middleware
- ProjectService + directory scanning
- Basic API routes: auth, projects
- Config extensions for new env vars

### Phase 2: Tmux Workspace
- TmuxService extensions: create/terminate sessions and panes
- TmuxStreamManager: WebSocket output streaming
- Tmux API routes and WebSocket endpoint
- Output history capture and storage
- Safety checks on tmux commands

### Phase 3: Agent Delegation
- AgentDelegationService
- Authority enforcement in TmuxService
- Delegation API routes
- AuditService for action logging
- Integration with existing ToolAgent

### Phase 4: Notes-Plans-Execution
- NoteService, PlanService, TaskService
- All CRUD API routes
- Note promotion to plan workflow
- Task execution tracking
- Telegram bot new commands (/note, /projects)

### Phase 5: Web & Mini App UI
- Static file serving from Fastify
- Preact + HTM frontend app
- xterm.js terminal integration
- Dashboard, project view, terminal view
- Notes/plans management UI
- Agent delegation controls

### Phase 6: Agent Conversation & Tooling
- ConversationService
- Conversation API routes
- Chat UI in web/Mini App
- Extended tool access for agents
- Project context injection for conversations
