# 03 - UI/UX Design Plan
## AGJAssist Plan04 — Frontend Component Design & Interactions
**Version:** 1.0
**Date:** 2026-03-09
**Status:** Approved
**Author:** webdesign02 (Sonnet-tier, saver40 mode)
**Input:** 01-business-requirements.md, 02-system-architecture.md

---

## 1. Design Principles

- **Consistency:** All changes follow existing dark theme (CSS variables: --bg, --surface, --border, --accent, --text, --text-secondary)
- **No build step:** All components in `app.js` using Preact + htm from ESM CDN
- **Progressive disclosure:** Collapsed/minimized states for inactive items, expand on interaction
- **Visual hierarchy:** Green/gray dot indicators, badges, sub-tab nesting

---

## 2. Projects Section Redesign

### 2.1 Project Card Layout (Active State)

```
┌─────────────────────────────────────────────┐
│  ProjectName                    [●/○ toggle] │
│                                              │
│  ● 3 notes   ● 2 plans   ● 5 tasks          │
│  (green dots when > 0, gray when = 0)        │
└─────────────────────────────────────────────┘
```

**Changes from current:**
- Remove: `tmux_session_count` ("X sessions") display
- Add: Colored dot indicators before each count
- Add: Active/inactive toggle button (top-right of card)

### 2.2 Project Card Layout (Inactive/Collapsed State)

```
┌─────────────────────────────────────────────┐
│  ▶ ProjectName               [●/○ toggle]   │
└─────────────────────────────────────────────┘
```

- Single-line collapsed row
- Click name to navigate to detail
- Toggle to expand

### 2.3 Component: `ProjectCard`

```javascript
function ProjectCard({ project, onToggleActive }) {
  const isActive = project.active === 1;

  if (!isActive) {
    // Collapsed row
    return html`
      <div class="project-card project-card-collapsed"
           style="padding:10px 16px;display:flex;align-items:center;justify-content:space-between">
        <span style="cursor:pointer;font-weight:500" onclick=${() => navigate('/project/' + project.id)}>
          ▶ ${project.display_name || project.directory_name}
        </span>
        <button class="btn btn-sm" onclick=${(e) => { e.stopPropagation(); onToggleActive(project.id, 1); }}
                title="Set active (expand)">○</button>
      </div>
    `;
  }

  // Expanded card
  return html`
    <div class="project-card" onclick=${() => navigate('/project/' + project.id)}>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>${project.display_name || project.directory_name}</h3>
        <button class="btn btn-sm" onclick=${(e) => { e.stopPropagation(); onToggleActive(project.id, 0); }}
                title="Set inactive (collapse)" style="color:var(--success)">●</button>
      </div>
      <div class="stats">
        <span class="stat">
          <span class="dot ${project.open_notes_count > 0 ? 'dot-green' : 'dot-gray'}"></span>
          ${project.open_notes_count} notes
        </span>
        <span class="stat">
          <span class="dot ${project.active_plans_count > 0 ? 'dot-green' : 'dot-gray'}"></span>
          ${project.active_plans_count} plans
        </span>
        <span class="stat">
          <span class="dot ${project.pending_tasks_count > 0 ? 'dot-green' : 'dot-gray'}"></span>
          ${project.pending_tasks_count} tasks
        </span>
      </div>
    </div>
  `;
}
```

### 2.4 CSS Additions

```css
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
}
.dot-green { background-color: var(--success, #3fb950); }
.dot-gray { background-color: var(--text-secondary, #6e7681); opacity: 0.5; }

.project-card-collapsed {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  opacity: 0.7;
}
.project-card-collapsed:hover { opacity: 1; }
```

### 2.5 Projects List Layout

```
┌───────────────────────────────────────────┐
│  Projects                     [Refresh]    │
├───────────────────────────────────────────┤
│                                           │
│  ACTIVE PROJECTS (expanded grid)          │
│  ┌──────────┐  ┌──────────┐             │
│  │ Project A │  │ Project B │             │
│  │ ● 3 notes│  │ ○ 0 notes│             │
│  │ ...      │  │ ...      │             │
│  └──────────┘  └──────────┘             │
│                                           │
│  INACTIVE PROJECTS (collapsed list)       │
│  ▶ Project C                    [○]       │
│  ▶ Project D                    [○]       │
│                                           │
└───────────────────────────────────────────┘
```

Active projects render in the existing `project-grid`. Inactive projects render as a compact list below.

---

## 3. Tasks Section Redesign

### 3.1 Tab Architecture

```
┌───────────────────────────────────────────┐
│  Tasks                                     │
├──────────┬──────────┐                     │
│  Tasks   │  Setup   │  (top-level tabs)   │
├──────────┴──────────┤                     │
│                                           │
│  ┌────────┬─────────┬───────────┐        │
│  │ DAILY  │ WEEKLY  │ REMINDERS │        │
│  └────────┴─────────┴───────────┘        │
│  (sub-tabs within each top-level tab)     │
│                                           │
│  [Archive View toggle]                    │
│                                           │
│  Content area...                          │
└───────────────────────────────────────────┘
```

### 3.2 Sub-Tab Component

```javascript
function SubTabs({ tabs, active, onSelect }) {
  return html`
    <div class="sub-tabs" style="display:flex;gap:0;margin-bottom:12px;border-bottom:1px solid var(--border)">
      ${tabs.map(t => html`
        <div class="sub-tab ${active === t.key ? 'active' : ''}"
             onclick=${() => onSelect(t.key)}
             style="padding:6px 16px;font-size:12px;text-transform:uppercase;letter-spacing:1px;
                    cursor:pointer;border-bottom:2px solid ${active === t.key ? 'var(--accent)' : 'transparent'};
                    color:${active === t.key ? 'var(--accent)' : 'var(--text-secondary)'}">
          ${t.label}
        </div>
      `)}
    </div>
  `;
}
```

### 3.3 Tasks Tab — Daily Sub-Tab

Shows active daily tasks filtered by current day of week.

```
┌───────────────────────────────────────────┐
│  DAILY  │ WEEKLY │ REMINDERS   [Archive]  │
├──────────────────────────────────────────│
│                                           │
│  Today: Monday (showing MWF tasks)        │
│                                           │
│  ☐ Morning standup         [daily] [Arc]  │
│    ├─ ☐ Review PRs                       │
│    ├─ ☑ Check emails                     │
│    └─ ☐ Update board                     │
│                                           │
│  ☑ Exercise routine        [daily] [Arc]  │
│    ├─ ☑ Stretching                       │
│    └─ ☑ Running                          │
│                                           │
│  [+ Add Task]                             │
└───────────────────────────────────────────┘
```

### 3.4 Tasks Tab — Weekly Sub-Tab

Shows all active weekly tasks.

```
┌───────────────────────────────────────────┐
│  DAILY │  WEEKLY  │ REMINDERS   [Archive] │
├──────────────────────────────────────────│
│                                           │
│  ☐ Weekly review           [weekly] [Arc] │
│    ├─ ☐ Review metrics                   │
│    ├─ ☐ Plan next week                   │
│    └─ ☐ Team sync                        │
│                                           │
│  [+ Add Task]                             │
└───────────────────────────────────────────┘
```

### 3.5 Tasks Tab — Reminders Sub-Tab

Shows active reminders that have had alerts fire or event has passed.

```
┌───────────────────────────────────────────┐
│  DAILY │ WEEKLY │  REMINDERS    [Archive] │
├──────────────────────────────────────────│
│                                           │
│  Team meeting              [Pending] [Arc]│
│  Event: Mar 15, 2026 10:00 AM            │
│  Alerts: 1 hour before (sent)            │
│                                           │
│  Doctor appointment        [Completed]    │
│  Event: Mar 10, 2026 3:00 PM            │
│  Auto-archives in 2h 15m                 │
│                                           │
└───────────────────────────────────────────┘
```

### 3.6 Archive View

Toggle button: "Archive" / "Active" - switches between showing active items and archived/inactive items.

```
┌───────────────────────────────────────────┐
│  DAILY │ WEEKLY │ REMINDERS  [← Active]   │
├──────────────────────────────────────────│
│                                           │
│  ARCHIVED ITEMS              (opacity:0.6)│
│                                           │
│  ☑ Old routine    [daily] [Restore]       │
│  ☑ Grocery list   [once]  [Restore]       │
│                                           │
└───────────────────────────────────────────┘
```

### 3.7 Setup Tab — Daily Sub-Tab

```
┌───────────────────────────────────────────┐
│  DAILY  │ WEEKLY │ REMINDERS              │
├──────────────────────────────────────────│
│                                           │
│  Morning standup                [Active ●]│
│  Days: [M][ ][W][ ][F][ ][ ]            │
│  Sub-items: 3                             │
│                                      [Del]│
│                                           │
│  Exercise routine              [Active ●] │
│  Days: [M][T][W][T][F][ ][ ]            │
│  Sub-items: 2                             │
│                                      [Del]│
│                                           │
│  [+ Add Template]                         │
└───────────────────────────────────────────┘
```

### 3.8 Day-of-Week Toggle Component

```javascript
function DayOfWeekPicker({ value, onChange }) {
  const days = [
    { label: 'Su', bit: 0 },
    { label: 'M', bit: 1 },
    { label: 'T', bit: 2 },
    { label: 'W', bit: 3 },
    { label: 'Th', bit: 4 },
    { label: 'F', bit: 5 },
    { label: 'Sa', bit: 6 },
  ];

  function toggle(bit) {
    const mask = 1 << bit;
    const newValue = (value || 0) ^ mask;
    onChange(newValue);
  }

  return html`
    <div style="display:flex;gap:4px">
      ${days.map(d => {
        const isSet = ((value || 0) & (1 << d.bit)) !== 0;
        return html`
          <button class="btn btn-sm ${isSet ? 'btn-primary' : ''}"
                  style="width:32px;height:28px;padding:0;font-size:11px;font-weight:${isSet ? '600' : '400'}"
                  onclick=${() => toggle(d.bit)}>
            ${d.label}
          </button>
        `;
      })}
    </div>
  `;
}
```

### 3.9 Setup Tab — Weekly Sub-Tab

Same as current weekly section in Setup. Templates with sub-items, active/inactive toggle.

### 3.10 Setup Tab — Reminders Sub-Tab

Moves the existing reminders management (from current Setup tab) into its own sub-tab. No layout change, just isolation.

### 3.11 Active/Inactive Toggle for Templates

```javascript
// Inline toggle on each template card
html`
  <button class="btn btn-sm ${task.active ? 'btn-primary' : ''}"
          onclick=${() => toggleActive(task.id, task.active ? 0 : 1)}
          style="font-size:10px;padding:2px 8px">
    ${task.active ? 'Active' : 'Inactive'}
  </button>
`
```

---

## 4. Conversations Section Redesign

### 4.1 New Conversation Dialog

```
┌─────────────────────────────────────────┐
│  New Conversation                        │
│                                          │
│  Agent                                   │
│  ┌─────────────────────────────────┐    │
│  │ ▼ Select an agent...            │    │
│  │   bsconsult - StratForge (Opus) │    │
│  │   sysarch - ArchForge (Opus)    │    │
│  │   elitedev01 - EliteDev (Opus)  │    │
│  │   ...                           │    │
│  │   ─────────────────────────     │    │
│  │   Custom (type agent name)      │    │
│  └─────────────────────────────────┘    │
│                                          │
│  Project (optional)                      │
│  ┌─────────────────────────────────┐    │
│  │ ▼ No project                    │    │
│  └─────────────────────────────────┘    │
│                                          │
│  [Cancel]              [Create]          │
└─────────────────────────────────────────┘
```

### 4.2 Agent Dropdown Component

```javascript
function AgentSelector({ value, onChange, agents }) {
  const [isCustom, setIsCustom] = useState(false);
  const [customValue, setCustomValue] = useState('');

  return html`
    <div>
      ${!isCustom ? html`
        <select value=${value} onChange=${(e) => {
          if (e.target.value === '__custom__') {
            setIsCustom(true);
            onChange('');
          } else {
            onChange(e.target.value);
          }
        }}>
          <option value="">Select an agent...</option>
          ${agents.map(a => html`
            <option value=${a.id}>${a.id} — ${a.name} (${a.model})</option>
          `)}
          <option disabled>──────────</option>
          <option value="__custom__">Custom (type agent name)</option>
        </select>
      ` : html`
        <div style="display:flex;gap:6px">
          <input value=${customValue} onInput=${e => { setCustomValue(e.target.value); onChange(e.target.value); }}
                 placeholder="Type agent name..." style="flex:1" autofocus />
          <button class="btn btn-sm" onclick=${() => { setIsCustom(false); onChange(''); }}>Back</button>
        </div>
      `}
    </div>
  `;
}
```

### 4.3 Conversation Sidebar Update

Show agent info more prominently:

```
┌──────────────────┐
│ CONVERSATIONS    │
│                  │
│ ● bsconsult     │  <- Active indicator
│   Mar 9, 10:30  │
│                  │
│   elitedev01    │
│   Mar 8, 15:20  │
│                  │
│   sysarch       │
│   Mar 7, 09:00  │
└──────────────────┘
```

---

## 5. Settings Section Redesign

### 5.1 Section Order and Grouping

```
┌───────────────────────────────────────────┐
│  Settings                                  │
│                                            │
│  ▼ Account & Security                      │
│    [User info card]                        │
│    [2FA Setup component]                   │
│                                            │
│  ▶ Chat Configuration                      │
│    (collapsed — soul.md, context.md)       │
│                                            │
│  ▶ Agent Registry                          │
│    (collapsed — read-only agent list)      │
│                                            │
│  ▶ Step Templates                          │
│    (collapsed — template management)       │
│                                            │
│  ▶ Safety Patterns                         │
│    (collapsed — blocked command patterns)  │
│                                            │
└───────────────────────────────────────────┘
```

### 5.2 Agent Registry Section (New)

```javascript
function AgentRegistrySection() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/agents').then(d => { setAgents(d.agents); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return html`<div class="loading">Loading...</div>`;

  return html`
    <div>
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
        Available agents for conversations. These are defined in the agent registry.
      </p>
      <div class="item-list">
        ${agents.map(a => html`
          <div class="item-card" style="padding:8px 12px;display:flex;align-items:center;gap:12px">
            <div style="flex:1">
              <span style="font-weight:500">${a.id}</span>
              <span style="color:var(--text-secondary);font-size:12px;margin-left:8px">${a.name}</span>
            </div>
            <span class="badge badge-${a.model === 'Opus' ? 'active' : 'draft'}" style="font-size:10px">${a.model}</span>
          </div>
        `)}
      </div>
    </div>
  `;
}
```

---

## 6. Responsive Considerations

### Mobile (< 768px)
- Project grid: single column
- Task sub-tabs: horizontal scroll if needed (already handled by flex)
- Day-of-week picker: buttons sized 28px minimum touch target
- Conversation panel: sidebar collapses, full-width chat

### Tablet (768-1024px)
- Project grid: 2 columns
- Sub-tabs: full width, no scroll needed
- Settings sections: full width

### Desktop (> 1024px)
- Project grid: 3-4 columns (existing behavior)
- Everything else: existing layout works

No new CSS media queries needed — existing responsive styles cover these cases.

---

## 7. Interaction Flows

### 7.1 Toggle Project Active/Inactive
1. User clicks toggle button (● / ○) on project card
2. `PATCH /api/projects/:id { active: 0|1 }`
3. Re-render project list: active projects in grid, inactive in collapsed list

### 7.2 Create Daily Task with Day Schedule
1. User clicks "+ Add Template" in Setup > Daily
2. Modal opens with title, description, frequency=daily (preset)
3. Day-of-week picker shows 7 toggle buttons (all ON by default)
4. User toggles days (e.g., clicks to turn off Sat/Sun for weekdays only)
5. Save: `POST /api/personal-tasks { title, frequency: 'daily', day_of_week: 62 }` (Mon-Fri = 0b0111110)

### 7.3 View Daily Tasks for Today
1. User navigates to Tasks > Tasks > Daily
2. Frontend computes current day: `new Date().getDay()` (0=Sun...6=Sat)
3. Fetches: `GET /api/personal-tasks?frequency=daily&day=<currentDay>`
4. Only tasks with matching bitmask appear
5. Each task expandable to show/check sub-items

### 7.4 Auto-Archive Flow
1. Scheduler runs every 60 seconds
2. Checks: daily tasks completed > 24h ago, weekly > 48h ago, reminders event > 3h ago
3. Sets `active = 0` on eligible items
4. Next time user opens Tasks view, archived items not shown (unless "Archive" view selected)

### 7.5 Start Conversation with Agent
1. User clicks "New Conversation"
2. Modal shows agent dropdown (fetched from `/api/agents`)
3. User selects agent (e.g., "bsconsult")
4. Optionally selects project
5. Creates conversation via `POST /api/conversations { agentName: 'bsconsult' }`
6. Chat interface opens with provider/model selector in header

---

## 8. Component Tree Changes

```
App
├── Header (unchanged)
├── Dashboard (unchanged)
├── Projects (MODIFIED)
│   ├── ProjectCard (NEW — replaces inline card rendering)
│   │   ├── Active state (expanded with green/gray dots)
│   │   └── Inactive state (collapsed row)
│   └── ToggleActive handler
├── Terminals (unchanged)
├── TasksSection (MODIFIED)
│   ├── Top tabs: Tasks | Setup
│   ├── TasksActionTab (MODIFIED)
│   │   ├── SubTabs (NEW): Daily | Weekly | Reminders
│   │   ├── DailyTasksView (NEW — filtered by current day)
│   │   ├── WeeklyTasksView (EXTRACTED from current grouped view)
│   │   ├── RemindersTasksView (NEW — active fired reminders)
│   │   ├── ArchiveView (NEW — all archived items)
│   │   └── TaskActionCard (MODIFIED — unchanged internal behavior)
│   └── TasksSetupTab (MODIFIED)
│       ├── SubTabs (NEW): Daily | Weekly | Reminders
│       ├── DailySetupView (EXTRACTED — daily templates + DayOfWeekPicker)
│       │   └── DayOfWeekPicker (NEW)
│       ├── WeeklySetupView (EXTRACTED — weekly templates)
│       └── RemindersSetupView (EXTRACTED — existing reminder management)
├── Conversations (MODIFIED)
│   ├── AgentSelector (NEW — dropdown with custom fallback)
│   └── Existing chat UI (unchanged)
└── Settings (MODIFIED)
    ├── SettingsSection: Account & Security (unchanged)
    ├── SettingsSection: Chat Configuration (unchanged)
    ├── SettingsSection: Agent Registry (NEW)
    │   └── AgentRegistrySection (NEW)
    ├── SettingsSection: Step Templates (unchanged)
    └── SettingsSection: Safety Patterns (unchanged)
```
