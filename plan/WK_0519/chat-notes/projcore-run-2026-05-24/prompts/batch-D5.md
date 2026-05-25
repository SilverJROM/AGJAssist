Batch-D5: Remove dead Conversations component + dead stats references from app.js

Batch ID: batch-D5
Plan: plan/WK_0519/chat-notes/projcore-run-2026-05-22/og-requirements.md (cleanup tail of D4)
Branch: work directly on current branch (no branch needed — frontend dead-code only, no server changes)
Requirements assigned: R3 (no dead chat code), R4 (no LLM-provider artefacts)
Lifecycle: pre-live — Deferral policy: OFF. No TODOs, no deferred cleanup.

Estimated duration: SHORT — ~15min
(Single file: app.js. Pure deletion of dead code + stats references.)

Context:
The 2026-05-22 projcore run (D1–D4) removed all backend chat routes and LLM providers. D4 left ~1078 lines of dead frontend code in app.js that was never cleaned up. The /conversations route now renders OvmConsole; the old Conversations component is completely orphaned.

Observed (current state in src/web/public/app.js):
- Lines 4742–5820: entire "CONVERSATIONS (LLM CHAT)" section — `function Conversations()` and all helpers. Unrouted. References `ollama` as default provider. Calls dead /api/conversations endpoints.
- Line 478: `api('/api/conversations').catch(() => ({ conversations: [] }))` in web-home stats useEffect
- Line 504: `{ label: 'Conversations', count: stats.conversations, route: '/conversations', desc: 'Chat with LLMs' }` in web-home stat cards
- Line 470: `conversations: 0` in web-home stats initial state
- Line 487: `conversations: c.conversations?.length || 0` in web-home stats reducer
- Lines 5875, 5898: mini-app Home has same dead /api/conversations fetch + 'Chat'/'LLM conversations' stat card

Expected (acceptance criteria):
1. The `Conversations()` component block (lines 4742–5820 approx) is DELETED in full — no leftover helpers, no orphaned functions.
2. Web Home stats: the /api/conversations fetch is removed; the 'conversations' key is removed from stats state; the 'Conversations / Chat with LLMs' card is removed from the stat cards array.
3. Mini-app Home stats: same — remove the dead /api/conversations fetch and the 'Chat / LLM conversations' card.
4. The /conversations route continues to render OvmConsole (DO NOT touch lines 5983–5984 or 6042–6043).
5. `npx tsc` exits 0 (no TypeScript errors — note: app.js is plain JS, tsc only checks .ts files; this is a sanity check).
6. `npm run build` exits 0.
7. App boots: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/` returns 200.

Likely files:
- src/web/public/app.js (ONLY file to change)

Scope:
- Delete the dead code. Nothing else.
- Do NOT touch OvmConsole, the /conversations routing, terminal-chat-state.js (still in use by OvmConsole), overmind code, notes code, tasks code, or any .ts files.
- Do NOT add any new stats cards. Just remove the dead ones.
- Surgical only. One file, one deletion.
- Robust validation: assert the outcome (app returns 200, tsc/build clean), not just that you deleted lines.
- If you hit anything unexpected, emit STATUS: BLOCKED with specifics. Do not spiral.

Plan handshake protocol (MANDATORY before implementation):
1. Read this brief in full. Grep app.js to confirm the line numbers.
2. Reply with PROPOSED approach: confirm exact line ranges to delete + any edge cases noticed.
3. End reply with: STATUS: PROPOSED — <one-line summary>.
4. Wait for APPROVED-PLAN before writing.

After APPROVED-PLAN:
5. Implement (delete the dead code, remove the stats references).
6. Run `npx tsc --noEmit` and `npm run build` and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/`.
7. Write [projcore callback] batch-D5 DONE to plan/WK_0519/chat-notes/projcore-run-2026-05-24/callbacks.md FIRST, then reply.
8. End reply with STATUS: DONE — <one-line summary>.

Required artifacts (minimal for 1-batch cleanup):
- batch-D5/changes.md (what was deleted and why)

Completion callback:
Write '[projcore callback] batch-D5 DONE <commit-sha>' to plan/WK_0519/chat-notes/projcore-run-2026-05-24/callbacks.md before your prose reply.

End every reply with STATUS: <PROPOSED|DONE|BLOCKED> — <short reason>.
