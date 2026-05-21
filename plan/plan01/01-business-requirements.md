# 01 - Business Requirements

**Source:** `01-high-level-change-request.md`
**Mode:** Upgrade (extending existing Telegram-only bot into unified platform)
**Agent:** bsconsult (Opus simulation)

---

## Project Snapshot

### Current State
- Single-process Node TypeScript Telegram bot
- Single authorized user (ID-based check)
- LLM routing: Ollama (local), OpenRouter (remote), Claude CLI, Codex CLI
- Tmux: list panes, peek output, send commands (fire-and-forget)
- Tool agent loop with `<ACTION>` XML parsing for Ollama/OpenRouter
- Workspace root path restriction, command allowlist security
- No persistent storage, no API server, no web UI, no session management

### Desired State
- Unified operator platform with 3 access surfaces: Telegram bot, Telegram Mini App, web app
- Telegram-based authentication for all surfaces
- SQLite persistent storage for all entities
- Real-time interactive tmux terminal access via WebSocket
- Multi-project management (~/websites)
- Agent delegation with authority levels (observe/suggest/execute)
- Notes → Plans → Tasks → Execution pipeline per project
- Configurable command safety list
- Full audit logging

---

## Business Objectives

| ID | Objective | Success Metric |
|----|-----------|---------------|
| REQ-001 | Centralize all project operations in one authenticated platform | Operator can manage all ~/websites projects without leaving the app |
| REQ-002 | Provide real-time tmux interaction from any surface | Operator sees live terminal output and can type commands from web/Mini App |
| REQ-003 | Enable agent delegation with controlled authority | Operator can grant/revoke agent access to specific tmux sessions |
| REQ-004 | Support structured project workflow (notes→plans→tasks) | Operator can capture notes, promote to plans, track execution |
| REQ-005 | Maintain security through Telegram authentication | No access without valid Telegram identity verification |
| REQ-006 | Preserve existing Telegram bot functionality | All current bot commands continue working unchanged |

---

## Functional Architecture

### FA-01: Authentication and Session Management

#### BR-001: Telegram WebApp Authentication
- Web app and Mini App authenticate by validating Telegram `initData` hash using the bot token as HMAC key.
- On successful validation, the server issues a session token (JWT or opaque token stored in SQLite).
- The session token is used for all subsequent API and WebSocket requests.
- Session tokens expire after a configurable duration (default: 24 hours).
- The Telegram bot continues using the existing `authorizedUserId` check for direct bot messages.

#### BR-002: User Authorization
- The system maintains an allowlist of authorized Telegram user IDs in SQLite.
- The owner (primary operator) is always authorized and has full permissions.
- The owner can add/remove designated users via the web app or Telegram bot.
- Designated users have a role: `owner` or `viewer`.
  - `owner`: full access to all features.
  - `viewer`: read-only access. Can view projects, tmux output, notes/plans. Cannot send commands, create/modify notes, or delegate agents.

#### BR-003: Session Lifecycle
- Sessions are created on successful authentication.
- Sessions are invalidated on explicit logout or expiration.
- Multiple concurrent sessions are allowed (e.g., web app + Mini App + Telegram simultaneously).
- Each session tracks: user ID, creation time, last activity, access surface (bot/miniapp/web).

### FA-02: Project Management

#### BR-004: Project Registry
- Projects are derived from directories under `/home/agjrom/websites`.
- Each directory at the root level is treated as a project.
- The system auto-discovers projects by scanning the directory on startup and periodically (or on-demand refresh).
- Project metadata stored in SQLite: directory name, display name (editable), created/updated timestamps, active status.
- The operator can mark projects as archived (hidden from default views but still accessible).

#### BR-005: Project Dashboard
- The dashboard shows all active projects with:
  - Project name and path
  - Number of active tmux sessions
  - Count of open notes, active plans, pending tasks
  - Last activity timestamp
  - Quick-action buttons (open terminal, add note, view plans)
- Telegram bot: summarized text list via `/projects` command.
- Mini App/Web: card-based grid with status indicators.

### FA-03: Tmux Workspace

#### BR-006: Tmux Session Lifecycle
- Create new tmux sessions tied to a project (session name derived from project).
- Create additional windows and panes within existing sessions.
- Terminate sessions, windows, or panes (requires owner role).
- List all sessions with their panes, commands, and project associations.

#### BR-007: Real-Time Terminal Access
- WebSocket connection streams tmux pane output to the client in real time.
- The client can send keystrokes and commands back to the pane via the same WebSocket.
- Output buffer: the server maintains a rolling buffer (configurable, default 5000 lines) per active pane for initial load when a client connects.
- Multiple clients can observe the same pane simultaneously.
- Latency target: under 200ms from keystroke to visible output update.

#### BR-008: Tmux Output History
- Pane output is captured and stored in SQLite for historical review.
- Snapshots are taken periodically (configurable interval, default every 60 seconds) while a session is active.
- The operator can search output history by keyword, project, or time range.
- History retention: configurable, default 7 days.

#### BR-009: Tmux from Telegram Bot
- Existing `/jobs`, `/peek`, `/tmux_send` commands continue to work.
- New: `/tmux_create <project> [name]` — create a new session for a project.
- New: `/tmux_kill <target>` — terminate a session/pane (owner only, confirmation required).

### FA-04: Agent Delegation and Authority

#### BR-010: Agent Authority Model
- Authority is granted per agent per tmux session/pane.
- Three levels:
  - **observe**: Agent can read pane output. No command execution.
  - **suggest**: Agent can read output and propose commands. Commands are queued for operator approval before execution.
  - **execute**: Agent can read output and send commands autonomously within the session.
- Authority is explicitly granted by the operator and persists until explicitly revoked or the session is terminated.
- Default: no authority. Agents have no tmux access unless granted.

#### BR-011: Delegation Controls
- The operator grants/revokes authority from any surface:
  - Telegram: `delegate <agent> <session> <level>`, `revoke <agent> <session>`
  - Web/Mini App: UI controls on the session view
- The operator can change authority level at any time without revoking first.
- When authority is revoked, any pending suggested commands are discarded.
- The operator can view all active delegations in a single view.

#### BR-012: Agent Action Logging
- Every agent action is logged to an audit table in SQLite:
  - Timestamp, agent name, action type (read/suggest/execute), tmux target, command text (if applicable), output snippet, authority level at time of action, who authorized.
- Logs are queryable by project, agent, session, time range.
- Logs are retained for configurable duration (default: 30 days).

#### BR-013: Delegated Agent Execution Loop
- When an agent has `execute` authority:
  1. Agent reads pane output via the API.
  2. Agent decides on next command.
  3. Agent sends command to pane.
  4. Agent reads output to verify result.
  5. Agent repeats or reports completion.
- The system enforces the command safety list on agent-executed commands regardless of authority level.
- If a command matches an active safety pattern, execution is paused and the operator is notified for approval.

### FA-05: Command Safety List

#### BR-014: Configurable Command Safety Patterns
- The system maintains a list of command patterns (regex or prefix match) in SQLite.
- Each pattern has: pattern text, description, active/inactive toggle, created timestamp.
- Default patterns (shipped with initial setup):
  - `rm -rf` — recursive force delete
  - `rm -r` — recursive delete
  - `drop table` / `drop database` — database destruction
  - `kill -9` — force kill process
  - `reboot` / `shutdown` — system restart
  - `mkfs` — filesystem format
  - `dd if=` — disk write
  - `chmod 777` — overly permissive permissions
  - `> /dev/` — device writes
- The operator can add, remove, edit, and toggle patterns from the web/Mini App settings.
- When a command (from any source: operator, agent, tool) matches an active pattern, execution requires explicit confirmation.
- The Telegram bot sends a confirmation prompt; web/Mini App shows a modal dialog.

### FA-06: Notes, Plans, and Execution Pipeline

#### BR-015: Notes
- A note is a text observation tied to a specific project.
- Fields: ID, project ID, title (optional), body (markdown), created timestamp, updated timestamp, status (open/promoted/archived).
- Notes can be created from:
  - Telegram: `note <project> <text>` or quick-note format
  - Web/Mini App: note creation form
- Notes can be tagged for categorization.
- Notes can be promoted to plans (status changes to `promoted`, reference to plan is stored).

#### BR-016: Plans
- A plan is a structured document with defined steps, created from one or more notes.
- Fields: ID, project ID, title, description (markdown), status (draft/active/completed/archived), created/updated timestamps.
- A plan references the notes it was created from.
- A plan contains ordered steps, each with a description and completion status.

#### BR-017: Tasks
- A task is an executable unit of work derived from a plan step.
- Fields: ID, plan ID, project ID, title, description, acceptance criteria (markdown), status (pending/in_progress/completed/failed/blocked), assigned to (agent name or "operator"), tmux session reference (optional), created/updated timestamps.
- Tasks can be assigned to an agent or the operator.
- When assigned to an agent, the agent is automatically granted the configured authority level on the associated tmux session.

#### BR-018: Execution Tracking
- Each task execution is tracked:
  - Start time, end time, executor (agent name or operator), tmux session used, status, output summary.
- The operator can view execution history per task, per project, or globally.
- Failed executions include error details and can be reassigned.

### FA-07: Agent Conversation

#### BR-019: Conversational Interface
- The existing agent routing (op, om, claude, opus, sonnet, haiku, codex) continues to work from Telegram.
- Web/Mini App add a chat-style interface for each agent.
- Conversation history is stored per project per agent in SQLite.
- Conversations can be started, continued, or reset.
- Agents have access to project context (current notes, active plans, tmux session state) when conversing.

#### BR-020: Agent Tool Access in Conversations
- During conversation, agents can use tools (tmux, file reading, command execution) if the operator has granted tool access.
- Tool access follows the same authority model as tmux delegation.
- The operator can enable/disable tool access per conversation or globally per agent.

### FA-08: Access Surface Differences

#### BR-021: Telegram Bot Surface
- Quick command interface optimized for speed.
- All existing commands preserved.
- New commands: `/projects`, `/note`, `/delegate`, `/revoke`, `/safety`.
- Summarized views (text-based, concise).
- Can do everything but shows less detail than web/Mini App.

#### BR-022: Mini App Surface
- Opened from within Telegram via bot menu button.
- Authenticated via Telegram WebApp `initData`.
- Granular project management: dashboard, session list, notes/plans browsing and editing.
- Interactive tmux terminal view (smaller viewport, mobile-optimized).
- Agent delegation controls with visual indicators.

#### BR-023: Web App Surface
- Full-featured desktop interface.
- Same authentication mechanism as Mini App (Telegram-initiated).
- Larger terminal views, side-by-side layouts.
- Full audit log browsing.
- Settings management: command safety list, user allowlist, agent configuration.
- Session and history views with search and filtering.

---

## Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|------------|--------|
| NFR-001 | Performance | WebSocket tmux streaming latency | < 200ms keystroke to display |
| NFR-002 | Performance | API response time for CRUD operations | < 100ms p95 |
| NFR-003 | Performance | Dashboard load time | < 1s with 20 projects |
| NFR-004 | Reliability | Single-process stability | No memory leaks over 7-day uptime |
| NFR-005 | Storage | SQLite database size for 30-day retention | < 500MB |
| NFR-006 | Security | All API endpoints require valid session token | Zero anonymous access |
| NFR-007 | Security | Command safety list enforced on all execution paths | No bypass possible |
| NFR-008 | Security | Path traversal prevention | Workspace root restriction enforced |
| NFR-009 | Usability | Mobile-responsive Mini App | Usable on 375px+ viewports |
| NFR-010 | Usability | Keyboard-navigable web terminal | Standard terminal shortcuts work |

---

## Risks and Dependencies

| ID | Risk | Impact | Mitigation |
|----|------|--------|------------|
| RISK-001 | WebSocket tmux streaming may have high CPU usage with many active panes | Performance degradation | Cap concurrent streaming panes (default 5), lazy-connect on view |
| RISK-002 | SQLite write contention under concurrent agent operations | Data loss or slowness | Use WAL mode, serialize writes through service layer |
| RISK-003 | Telegram WebApp auth token expiry during long sessions | Unexpected logout | Implement token refresh flow, notify user before expiry |
| RISK-004 | Agent with execute authority runs destructive command not in safety list | Data loss | Ship comprehensive default safety list, audit log all commands |
| RISK-005 | Large tmux output history bloats SQLite | Storage exhaustion | Enforce retention policy, compress old snapshots, configurable limits |

---

## Gap Analysis: Current → Desired

| Area | Current | Desired | Gap |
|------|---------|---------|-----|
| Auth | Single user ID check | Telegram WebApp auth + allowlist + sessions | New auth layer, session management, JWT/token system |
| Storage | None (stateless) | SQLite for all entities | New database layer, schema, migrations |
| API | None | REST + WebSocket API | New HTTP server, route handlers, middleware |
| Tmux | Read/send only | Full lifecycle + real-time streaming | Extend TmuxService, add WebSocket streaming |
| Projects | Workspace root only | Multi-project registry with metadata | New project service, directory scanning |
| Agents | Direct routing | Delegation model with authority levels | New delegation service, authority enforcement |
| Workflow | None | Notes → Plans → Tasks → Execution | New entity layer, state machine |
| UI | Telegram only | Telegram + Mini App + Web App | New frontend application |
| Audit | None | Full action logging | New audit service and storage |
| Safety | Command allowlist | Configurable safety patterns with toggles | New safety service, pattern matching |

---

## Acceptance Criteria Summary

1. Operator authenticates via Telegram on web/Mini App and accesses the platform.
2. Operator sees all ~/websites projects on the dashboard with status indicators.
3. Operator opens a tmux session from the web and interacts with it in real time.
4. Operator creates a note from Telegram, sees it on the web, promotes it to a plan.
5. Operator delegates an agent to a tmux session with execute authority; agent runs commands autonomously.
6. Operator revokes agent authority; agent immediately loses access.
7. All agent actions appear in the audit log with full detail.
8. A command matching an active safety pattern triggers a confirmation prompt before execution.
9. All existing Telegram bot commands continue to work identically.
10. Viewer-role users can see projects and output but cannot execute commands or modify data.
