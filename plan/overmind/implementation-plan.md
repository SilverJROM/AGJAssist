# Overmind — Implementation Plan

**Repo:** /home/agjrom/TGBOTS/AGJAssist (git init'd; baseline `e72bc09`). Commit per batch.
**Implementer:** codex-in-tmux, session `ovm-build` (`--dangerously-bypass-approvals-and-sandbox`).
**Build/smoke gate (every batch):** `npx tsc` (must be clean) → targeted `vitest` where touched → `pm2 restart agjassist` for manual smoke. (pm2 restart briefly drops the live bot+dashboard — acceptable per NS-6.)

## Atomic batches (vertical slices, <30min each, ~1-3 tests, tight diff)

| Batch | Title | Req# | Dep | Bucket |
|-------|-------|------|-----|--------|
| A1 | Schema v11 `overmind_workflows` + migration + CRUD | R1 | — | SHORT |
| A2 | Lifecycle + read endpoints + `OVERMIND_TOKEN` | R2,R3 | A1 | SHORT |
| A3 | OvermindService watcher loop + classifier (detection only, no nudge) | R4,R5 | A1,A2 | SHORT* |
| A4 | Telegram cmds (`/overmind`,`/om_pause`,`/om_resume`,`/om_drop`) + start loop in index.ts | R9 | A3 | SHORT |
| A5 | Nudge ladder Tier 1-2 (coordinator-only) + DONE/BLOCKED push | R6,R8 | A3,A4 | SHORT |
| A6 | Sonnet brain Tier 3 + waiting_human/pause logic | R7,R8 | A5 | SHORT |
| A7 | UI `/overmind` panel + `OvermindStreamManager` WS | R10,R11 | A2,A3 | SHORT* |
| B  | Wire projcore.md register/complete curls | R12 | A2 | SHORT |
| C  | Onboard 3 live workflows (capstone) | R13 | A7,B | SHORT (live-touch, NS-7 gated) |

`*` A3 and A7 are the meatiest — if codex's PROPOSED plan reveals >30min / sprawling diff, split at handshake (§1.4c): A3 → loop / classifier; A7 → panel / WS.

## Dependency notes
- A1→A2→A3→A4→A5→A6 largely sequential. A7 needs A1+A3. B is prompt-only (parallelizable but run after A2 so the endpoint contract is final). C is the capstone — requires the feature live (A7) and the prompt wired (B), and JROM's NS-7 go before any keystroke into a live coordinator.
- The watcher only acts on **registered** workflows; nothing is registered until Stage C, so earlier batches cannot nudge live sessions. Safe ordering.

## Key integration points (from grounding exploration)
- `src/db/database.ts`: SCHEMA_VERSION 10→11; SCHEMA_SQL CREATE TABLE; migration `if (current && current.version < 11)`.
- `src/api/server.ts` + new `src/api/routes/overmind-routes.ts`: route-module registration pattern; `createAuthMiddleware`/`requireOwner` for GET, token-check for register/complete.
- `src/services/overmind-service.ts` (new): CRUD + watcher loop + classifier + ladder + brain.
- `src/index.ts`: instantiate `OvermindService`, pass to API context, start the interval (near :165).
- `src/tmux/tmux-service.ts`: `capturePane(target, lines)`, `sendCommand(target, cmd, pressEnter, skipSafetyCheck)`.
- `src/tmux/tmux-stream-manager.ts`: clone → `OvermindStreamManager` (`Map<id,Set<WS>>`, broadcast JSON).
- `src/llm/claude-cli-provider.ts`: `new ClaudeCliProvider("sonnet").chat(messages, ...)`.
- `src/bot/assistant-core.ts handleCommand()` + `src/bot/telegram-bot.ts setMyCommands()`.
- `src/web/public/app.js`: Preact/HTM, hash routing `useRoute()`, `api(path)` helper, add nav link + component.
