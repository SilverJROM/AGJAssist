# 01 - High-Level Change Request

## Change Summary
- Extend AGJAssist from a Telegram-only operator bot into a unified operator platform accessible through the Telegram bot, a Telegram Mini App, and a web application.
- Keep the existing TypeScript Node process as the single runtime, hosting the bot and a new API server in the same process.
- Use SQLite for all persistent storage.
- Place tmux session interaction at the center of the platform. Tmux sessions are the primary workspace where projects run, agents execute, and the operator works.
- Add authenticated access to workspace projects, real-time tmux interaction, a notes-to-plan-to-execution workflow, and multi-agent delegation in one maintainable app.

## Business Intent
- Provide one authenticated surface where the operator can see all running project work, interact with it, take notes, form plans, and delegate execution to agents, without switching between Telegram, terminals, and editors.
- Make tmux sessions a first-class managed workspace that both humans and agents can operate inside with clear authority boundaries.
- Reduce friction between observing a problem, documenting it, planning a fix, and getting it done.

## In Scope

### Authentication and Access
- Telegram-based authentication is the single identity layer for the web app, Mini App, and Telegram bot.
- Only the owner and explicitly designated users may access the platform.
- Session tokens issued after Telegram identity verification, used for all API access.

### Project Workspace Access
- Controlled read and navigation of project folders under `/home/agjrom/websites`.
- Each project maps to a directory. Projects are the organizing unit for tmux sessions, notes, plans, and agent runs.

### Tmux As Primary Workspace
- Tmux sessions are the core operational environment. All project work happens inside them.
- Full lifecycle management: create sessions and panes, attach to existing ones, terminate when done.
- Real-time interactive access from web and Mini App: stream pane output, send keystrokes and commands, see results live. This is a web terminal experience, not fire-and-forget command dispatch.
- Read and search pane output history and logs.
- Both the operator and authorized agents can read from and write to tmux panes.

### Agent Delegation and Authority
- Route requests to agents: `op`, `om`, `claude`, `opus`, `sonnet`, `haiku`, `codex`, local Ollama, and OpenRouter models.
- Delegate authority to an agent over a specific tmux session or pane. A delegated agent can read output, decide next steps, and execute commands within that session until authority is revoked.
- Authority levels:
  - **observe**: agent can read pane output only.
  - **suggest**: agent can read and propose commands, operator must approve before execution.
  - **execute**: agent can read and send commands autonomously within the authorized session.
- All agent actions are logged with full audit trail regardless of authority level.
- The operator can revoke delegation or change authority level at any time from any access surface.

### Multi-Project Management
- The platform manages multiple projects simultaneously. Each project under `/home/agjrom/websites` is an independent workspace with its own tmux sessions, notes, plans, tasks, and agent assignments.
- The operator needs a clear overview of all projects and their current state at a glance.

### Notes, Plans, and Execution Pipeline
- Each project has its own notes-to-execution pipeline. This is a directional workflow, not isolated data objects:
  1. **Note**: capture an observation, bug, idea, or required change against a specific project.
  2. **Plan**: promote one or more notes into a structured plan with defined steps.
  3. **Task**: break a plan into executable tasks with clear acceptance criteria.
  4. **Execution**: assign a task to an agent or the operator. Track status, link to the tmux session where work happens, and record output.
- Notes can exist independently. Plans reference notes. Tasks reference plans. Executions reference tasks and tmux sessions. All are scoped to a project.
- The operator can create notes from any surface (Telegram message, web UI, Mini App) and progress them through the pipeline.

### Agent Conversation
- Conversational interface with any configured agent from any access surface.
- Conversation context is preserved per project and per agent.
- Agents can be given tool access (tmux interaction, file reading, command execution) scoped by the operator's policy.

## Out of Scope For Initial Delivery
- Multi-tenant user management beyond an owner plus a small allowlist.
- Filesystem write access outside tmux sessions. Direct file editing through the web UI is deferred.
- Fully autonomous destructive actions (rm -rf, drop database, kill unrelated processes) without explicit operator instruction, regardless of agent authority level.
- Mobile-native apps. The Mini App and web app are the mobile and desktop interfaces.

### Access Surface Differences
- **Telegram Bot**: quick command interface. Fast status checks, quick notes, agent commands, tmux snapshots. Optimized for speed and brevity. The operator can do everything but gets summarized views.
- **Mini App (via Telegram)**: granular project management. Dashboard of all projects, visual tmux session list, note/plan/task browsing and editing, agent delegation controls. Richer UI within the Telegram context.
- **Web App**: full-featured interface. Everything the Mini App offers plus larger terminal views, side-by-side project comparison, full audit log browsing, settings management (command safety list, user allowlist, agent configuration). Designed for desktop use with more screen real estate.
- All three surfaces share the same backend API and WebSocket contracts. The difference is presentation depth, not capability.

## Target Product Behavior
- The operator opens the web app or Mini App, authenticates via Telegram, and lands on a dashboard showing all projects, their active tmux sessions, recent notes, and running agent tasks.
- The operator selects a project and sees its full context: tmux sessions, notes pipeline, active plans, running executions.
- The operator taps into a tmux session and gets a live terminal view where they can read output and type commands directly.
- The operator notices a bug in the output, creates a note against the project, promotes it to a plan with steps, and assigns an agent to execute.
- The agent receives the task, opens or attaches to a tmux session, runs commands, reads output, and progresses through the plan steps. The operator watches in real time or reviews later.
- The operator can at any point revoke the agent's authority, take over the session manually, or redirect the task to a different agent.
- From Telegram, the operator sends a quick message like "note on projectX: auth is broken on login page" and it's captured as a note on that project, ready to be promoted to a plan later from the Mini App or web.
- All actions, whether taken by the operator or by agents, are recorded in an audit log tied to the project and session.

## Architectural Direction
- Single Node TypeScript process running the Telegram bot and an HTTP API server (Express or Fastify).
- SQLite database via better-sqlite3 for sessions, users, projects, notes, plans, tasks, executions, agent runs, and audit logs.
- WebSocket connections for real-time tmux pane streaming to the web and Mini App.
- Reuse existing orchestration, tmux, and tool-policy modules. Extend the tmux service for full lifecycle and streaming.
- All tmux, filesystem, and agent operations go through policy-checked service boundaries. No direct access from API handlers.
- The web and Mini App consume the same API and WebSocket contracts.

## Security and Control Requirements
- Telegram authentication is mandatory. No anonymous or password-only access.
- Workspace access restricted to `/home/agjrom/websites` and operator-approved paths only.
- Tmux operations scoped to sessions the operator has created or explicitly approved.
- Agent authority is always explicitly granted and can be revoked instantly.
- All agent-triggered actions are auditable: who authorized, what agent, what command, what session, what output.
- Destructive or high-risk operations require explicit operator intent regardless of agent authority level.
- The system maintains a configurable command safety list. Each command pattern (e.g. `rm -rf`, `drop database`, `kill`, `reboot`) can be individually toggled on or off by the operator. When a pattern is active, any attempt to run a matching command (by an agent or through the UI) requires explicit confirmation before execution. The operator manages this list through the web/Mini App settings.

## Delivery Phases
1. **Foundation**: API server in the same Node process, Telegram WebApp auth verification, SQLite schema, session handling, project registry from `/home/agjrom/websites`.
2. **Tmux Workspace**: Full tmux lifecycle management, real-time pane streaming via WebSocket, interactive command input, output history, audit logging.
3. **Agent Delegation**: Authority model (observe/suggest/execute), agent-to-tmux-session binding, delegation controls, agent action logging.
4. **Notes-Plans-Execution Pipeline**: Note capture, plan creation, task breakdown, execution tracking linked to tmux sessions and agents.
5. **Web and Mini App UI**: Frontend consuming the API and WebSocket contracts. Dashboard, terminal view, notes/plans interface, agent conversation UI.
6. **Agent Conversation and Tooling Expansion**: Full conversational interface, per-project context, expanded tool access for agents.

## Immediate Next Step
- Convert this change request into a concrete implementation spec covering: data model and SQLite schema, API contracts, auth flow, WebSocket protocol for tmux streaming, agent authority model, and phase 1 acceptance criteria.
