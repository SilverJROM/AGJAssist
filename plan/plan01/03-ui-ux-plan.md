# 03 - UI/UX Plan

**Source:** `01-business-requirements.md`, `02-system-architecture.md`
**Agent:** webdesign02 (Sonnet simulation)

---

## Design Direction

Operator tool — dark theme, monospace-heavy, information-dense but organized. Think terminal meets dashboard. No decorative elements. Every pixel earns its place.

**Palette:**
- Background: `#0d1117` (GitHub dark)
- Surface: `#161b22`
- Border: `#30363d`
- Text primary: `#e6edf3`
- Text secondary: `#8b949e`
- Accent: `#58a6ff` (blue — links, active states)
- Success: `#3fb950`
- Warning: `#d29922`
- Danger: `#f85149`
- Terminal bg: `#0a0e14`

**Typography:**
- UI: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- Code/Terminal: `'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace`
- Base size: 14px, line-height: 1.5

---

## Screen Map

### 1. Login Screen
- Centered card on dark background
- "Connect with Telegram" button
- Telegram WebApp auth triggers automatically in Mini App context
- Web app shows QR code or deep link to Telegram bot for auth initiation
- Error states: invalid token, expired session, unauthorized user

### 2. Dashboard (Home)
- **Header bar**: AGJAssist logo/text, user avatar+name, settings gear, logout
- **Project grid**: cards showing each project
  - Project name (bold)
  - Active tmux sessions count (green dot if any running)
  - Open notes / active plans / pending tasks counts
  - Last activity relative time
  - Click → Project Detail view
- **Quick actions sidebar** (web only):
  - Recent tmux sessions (click to open terminal)
  - Recent notes
  - Active agent delegations
- **Mobile (Mini App)**: single-column card list, no sidebar

### 3. Project Detail View
- **Tabbed interface**:
  - **Terminal** — tmux sessions and panes for this project
  - **Notes** — note list with create/edit
  - **Plans** — plan list with steps
  - **Tasks** — task list with status filters
  - **Activity** — audit log filtered to this project

#### Terminal Tab
- Left panel: session/pane tree (collapsible)
  - Each session shows its panes
  - Status indicator (active/terminated)
  - Click pane → opens terminal view
  - "New Session" button at top
- Right panel: xterm.js terminal
  - Full terminal emulator
  - Resize with panel
  - Input goes through WebSocket
  - Safety-blocked commands show inline warning
- Web: side-by-side layout (tree 250px, terminal fills rest)
- Mini App: stacked (tap pane → full-screen terminal, back button to return)

#### Notes Tab
- List view with search/filter bar
- Each note shows: title (or first line), status badge, timestamp
- Click → inline expand or detail view
- "New Note" floating action button
- Note editor: title field, markdown body (textarea with preview toggle)
- "Promote to Plan" button on open notes

#### Plans Tab
- List with status filter (draft/active/completed)
- Each plan shows: title, step progress (3/7 steps), task count, status
- Click → plan detail with ordered steps
- Each step: description, checkbox, "Create Task" button
- Drag to reorder steps

#### Tasks Tab
- Kanban-style columns: Pending | In Progress | Completed | Failed/Blocked
- Each task card: title, assigned to (agent badge or "You"), tmux link
- Click → task detail with description, acceptance criteria, execution history
- Assign/reassign dropdown
- Start execution button

#### Activity Tab
- Chronological log entries
- Filters: action type, agent, time range
- Each entry: timestamp, actor (user/agent), action, resource, details toggle

### 4. Settings View
- **Safety Patterns**: list with toggles, add/edit/delete
- **Users**: allowlist management (add by Telegram username/ID, set role)
- **Agents**: configured agent list, default authority settings
- **System**: session timeout, output history retention, pane buffer size

### 5. Agent Delegation Panel
- Accessible from Terminal tab and as standalone view
- Shows all active delegations:
  - Agent name, session/pane, authority level, granted time
  - Change level dropdown (observe/suggest/execute)
  - Revoke button
- "New Delegation" form: select agent, select session, set level

### 6. Conversation View (Phase 6)
- Chat-style interface per agent
- Project selector in header
- Message bubbles: user (right), agent (left)
- Agent tool usage shown as collapsible blocks
- "New Conversation" button
- Conversation list in sidebar

---

## Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile (Mini App) | 375px - 767px | Single column, stacked panels, full-screen terminal |
| Tablet | 768px - 1023px | Two-column where useful, collapsible sidebar |
| Desktop (Web) | 1024px+ | Full layout, side-by-side panels, persistent sidebar |

---

## Component Hierarchy

```
App
├── AuthGate
│   └── Login
├── Layout
│   ├── Header (logo, user, settings, logout)
│   ├── Sidebar (desktop: quick actions, nav)
│   └── Main
│       ├── Dashboard
│       │   └── ProjectCard[]
│       ├── ProjectDetail
│       │   ├── TabBar
│       │   ├── TerminalTab
│       │   │   ├── SessionTree
│       │   │   ├── TerminalView (xterm.js)
│       │   │   └── DelegationPanel
│       │   ├── NotesTab
│       │   │   ├── NoteList
│       │   │   └── NoteEditor
│       │   ├── PlansTab
│       │   │   ├── PlanList
│       │   │   └── PlanDetail (with steps)
│       │   ├── TasksTab
│       │   │   ├── TaskBoard (kanban)
│       │   │   └── TaskDetail
│       │   └── ActivityTab
│       │       └── AuditLog
│       ├── Settings
│       │   ├── SafetyPatterns
│       │   ├── UserManagement
│       │   └── SystemConfig
│       └── ConversationView (Phase 6)
│           ├── ConversationList
│           └── ChatPanel
└── Toast/Notification overlay
```

---

## Interaction Patterns

### Terminal Interaction
1. User clicks a pane in the session tree
2. xterm.js instance connects to `WS /ws/tmux/:target`
3. Server sends initial snapshot (last N lines)
4. Bidirectional streaming: user types → server sends to tmux → tmux output → server → client
5. Safety check: if command matches active pattern, server sends `safety_block` message
6. Client shows inline confirmation dialog: "This command matches safety pattern 'rm -rf'. Execute anyway? [Yes/No]"
7. On confirm, client sends `{ "type": "safety_confirm", "id": "..." }`

### Note to Plan to Task Flow
1. User creates note: quick text entry (title optional, body required)
2. User clicks "Promote to Plan" on a note
3. System creates a new plan linked to the note, note status → promoted
4. User adds steps to the plan (text entries, ordered)
5. User clicks "Create Task" on a step
6. System creates a task linked to the step, user assigns to agent or self
7. Task card appears in kanban board
8. When agent is assigned, delegation dialog appears to set authority level

### Delegation Flow
1. From terminal tab or delegation panel, user clicks "Delegate"
2. Select agent from dropdown (configured agents list)
3. Select authority level (observe/suggest/execute)
4. Confirm → delegation created, agent indicator appears on session
5. If suggest mode: queued commands appear in a review panel
6. User approves/rejects suggested commands one by one

---

## Accessibility

- WCAG AA contrast ratios for all text on dark backgrounds
- Keyboard navigation: Tab through UI, Enter to activate, Escape to close modals
- Screen reader labels on all interactive elements
- Focus indicators visible on all focusable elements
- Terminal view: standard terminal keyboard shortcuts passed through

---

## Static File Delivery

Preact + HTM loaded from CDN (unpkg/esm.sh) or bundled locally.
xterm.js loaded from CDN or local.
Single `index.html` that bootstraps the app.
No build step initially — ESM modules loaded directly.
Can add a build step later if bundle size becomes a concern.

---

## Incremental UI Delivery

| Phase | What Ships |
|-------|-----------|
| Phase 5a | Login + Dashboard + Project list (read-only) |
| Phase 5b | Terminal tab with xterm.js + WebSocket streaming |
| Phase 5c | Notes tab (CRUD) |
| Phase 5d | Plans tab (CRUD + steps) + Tasks tab (kanban + assignment) |
| Phase 5e | Settings + Delegation panel + Activity tab |
| Phase 6 | Conversation view |
