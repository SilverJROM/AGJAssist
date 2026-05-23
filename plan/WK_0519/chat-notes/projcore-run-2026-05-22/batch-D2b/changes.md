# Batch D2b — Promote OVM to the 💬 Chat tab; remove old Conversations chat UI from routing

## Summary
Replaced the old multi-provider `Conversations` component with `OvmConsole` at the `/conversations` route in both `TgApp` and `App`. The route id, bottom-nav label (💬 Chat), and icon are unchanged — only the rendered component changed. `Conversations` remains in the file as dead code (no route renders it); the backend `/api/conversations` routes are untouched per scope.

## Changes

### src/web/public/app.js
- **TgApp** (line ~5623): `<${Conversations} />` → `<${OvmConsole} />` at `route === '/conversations'`
- **App** (line ~5682): `<${Conversations} />` → `<${OvmConsole} />` at `route === '/conversations'`
- `Conversations` function stays in file (dead code, no route renders it); backend routes/providers untouched.
- Workflows → OVM sub-tab unchanged (line 922, `workflowTab === 'ovm'` still renders `<${OvmConsole} />`).

## Decisions
None non-trivial. Route id `/conversations` reused as-is (brief criterion 3 — keeps saved nav configs working).

## Verification

### Build
- `npx tsc` — PASS (no output, exit 0)
- `npm run build` — PASS (tsc + copy to dist/, exit 0)

### Routing / UI
- `/conversations` route now renders `OvmConsole` (Telegram-style OVM chat with open/close/status controls + chat)
- Old `Conversations` UI (conversation list, provider/model pickers, multi-provider chat) is no longer rendered from any route
- Workflows → OVM sub-tab (`workflowTab === 'ovm'`) continues rendering `OvmConsole`
- All other tabs (`/`, `/projects`, `/terminals`, `/overmind`, `/tasks`, `/notes`, `/settings`) unaffected
- Bottom-nav editor (`BottomNavEditor`) and `overmind-helpers.js` tab config untouched
- No console errors expected (pure component swap, no new state/hook changes)
