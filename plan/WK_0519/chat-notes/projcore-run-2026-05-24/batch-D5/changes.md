# batch-D5 changes — dead Conversations component + stats refs

Commit: 41a0b45e01bd63e8ec6e9181978009cefd2f29dc
File: src/web/public/app.js only

## What was deleted

**Block 1 — Entire Conversations section (lines 4742–5820, −1079 lines)**
- `// ===================== CONVERSATIONS (LLM CHAT) =====================` section header
- `function Conversations()` and all helpers (provider/model localStorage, loadConversations, send, delete, settings)
- Reason: unrouted since D1–D4 removed all /api/conversations backend routes; /conversations now renders OvmConsole

**Block 2 — Dashboard() stats (web home, 5 removals)**
- Removed `conversations: 0` from useState initial state
- Removed `api('/api/conversations').catch(...)` from Promise.all
- Changed destructuring `[p, t, r, c, n, w]` → `[p, t, r, n, w]`
- Removed `conversations: c.conversations?.length || 0` from setStats
- Removed `{ label: 'Conversations', ... 'Chat with LLMs' }` card

**Block 3 — TgDashboard() stats (mini-app home, 5 removals)**
- Same four stat removals as Dashboard
- Removed `{ icon: '💬', label: 'Chat', ... 'LLM conversations' }` card

## What was NOT touched
- Line 450: nav `<a href="#/conversations">Chat</a>` — route still live
- Lines 4898, 4957: `route === '/conversations' → OvmConsole` routing
- Line 4864: `/conversations` in tg route list
- `terminal-chat-state.js` — still used by OvmConsole

## Validation
- `npx tsc --noEmit` → exit 0
- `npm run build` → exit 0
- `curl http://localhost:3101/` → 200
