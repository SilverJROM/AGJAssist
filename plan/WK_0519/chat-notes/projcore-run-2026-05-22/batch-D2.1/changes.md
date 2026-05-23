# Batch D2.1 — OVM web chat: true request/response chat

## Verbatim user report
"when i open the OVM chat it should be like a normal chat room where i send a message and OVM replies back like a person chatting with me and he does what he does on the background and he only sends me the replies to my queries. not a terminal view that we have right now"

## Root cause / feature
The OVM console was a live terminal viewer (WebSocket tmux stream, rolling snapshot card, line picker). The chat-relay model already existed in the Telegram path (`assistant-core.relayOvmMessage`) but was not reused by the web. No send-and-await endpoint existed. Adding it required extracting the relay core into `OvmSessionService.sendAndAwaitReply`, wiring both paths to it, and replacing the terminal view with chat bubbles.

## Per-file changes

### `src/services/ovm-session.ts`
- **Added** `capturePane` to `OvmTmuxService` interface (required for relay).
- **Added** `sendAndAwaitReply(message)` and `getReply()` to `OvmSessionManager` interface + implementations on `OvmSessionService`.
- **Implementation**: `sendAndAwaitReply` captures before, sends, starts a background `pollUntilDone` (polls 700ms, waits for pane stable + `!hasActiveTurn`), races it against a 28s sync window. If done within 28s: returns `{ pending: false, reply }`. If not: returns `{ pending: true }` and leaves `inFlight` set so `/reply` can poll.
- **Added** `getReply()`: checks `inFlight`, captures pane, returns `{ pending: true }` while `hasActiveTurn`, else extracts reply and clears `inFlight`.
- **Moved** `extractOvmReply`, `isOvmChromeLine`, `diffTerminalOutput`, `normalizeText`, `stripAnsi` helpers into `OvmSessionService` (DRY: single source of truth for cleaning).
- **Added** exported constants: `OVM_SEND_SYNC_TIMEOUT_MS`, `OVM_SEND_POLL_MS`, `OVM_SEND_STABLE_READS`, `OVM_SEND_FALLBACK`.
- **Why**: DRY the relay core; enable web endpoint + TG path to share it.

### `src/bot/assistant-core.ts`
- **Replaced** `relayOvmMessage` (which called tmux directly + 5 private helpers) with a two-liner that delegates to `ovmSessionService.sendAndAwaitReply(input)`.
- **Removed** now-unused constants: `OVM_RELAY_TIMEOUT_MS`, `OVM_RELAY_POLL_MS`, `OVM_RELAY_STABLE_READS`, `OVM_SESSION_TARGET`.
- **Why**: TG path reuses the shared service method; behavior preserved (tests pass).

### `src/api/routes/overmind-routes.ts`
- **Added** `SendBody` interface `{ message?: string }`.
- **Added** `POST /api/overmind/ovm/send` — owner/JWT-guarded, calls `sendAndAwaitReply`, returns `{ pending, reply? }`.
- **Added** `GET /api/overmind/ovm/reply` — owner/JWT-guarded, calls `getReply()`, returns `{ pending, reply? }` or 404 if no in-flight send.
- **Why**: web frontend needs a REST send→reply contract.

### `src/web/public/app.js`
- **Replaced** `OvmConsole` (terminal view) with chat bubble UI:
  - State: `messages[]`, `thinking` flag, `input`.
  - On send: appends user bubble → POST `/api/overmind/ovm/send` → on `{ pending: true }` polls GET `/api/overmind/ovm/reply` every 2s until reply arrives; on `{ pending: false, reply }` shows OVM bubble immediately.
  - "OVM is thinking…" indicator displayed while `thinking === true`.
  - **Removed**: WS terminal stream, rolling snapshot card, 25/50/100 line picker, `streamStatus`, `snapshot`, `snapshotRef`, `lineLimit`, `streamKey`, `wsRef`.
  - **Kept**: open/restart/close action buttons, status indicator, `loadStatus` polling.
- **Why**: user wants chat bubbles, not a terminal.

### `src/web/public/style.css`
- **Added** chat bubble styles: `.ovm-chat-messages`, `.ovm-chat-row`, `.ovm-chat-bubble-user` (right, accent blue), `.ovm-chat-bubble-ovm` (left, surface dark), `.ovm-chat-bubble-system` (error/red tint), `.ovm-chat-thinking` (italic/dimmed), `.ovm-chat-ts`, `.ovm-chat-empty`.
- **Why**: new chat layout requires styles not present for terminal view.

### `tests/ovm-session.test.ts`
- **Updated** `mockTmux` to accept `captureResults[]` and add `capturePane` to the interface (now required).
- **Updated** `restart` inline mock to include `capturePane`.
- **Added** describe block `OvmSessionService.sendAndAwaitReply — reply extraction` with 3 tests:
  1. Returns cleaned reply (ANSI + chrome stripped) when pane stabilises before sync timeout.
  2. Returns `{ pending: true }` while `hasActiveTurn`; `getReply()` returns reply when turn finishes.
  3. `getReply()` returns `null` with no in-flight send.

### `tests/overmind-commands.test.ts`
- **Updated** 4 OVM chat mode tests: added `sendAndAwaitReply` + `getReply` mocks to `OvmSessionManager` satisfies objects.
- **Updated** relay test: now asserts `ovm.sendAndAwaitReply` called with message; no longer tests `tmux.sendCommand` directly (that's an impl detail inside the service).
- **Updated** fallback test: `sendAndAwaitReply` returns `{ pending: true }` → fallback text.

### `tests/overmind-routes.test.ts`
- **Updated** `ovmSession` mock object to include `sendAndAwaitReply` and `getReply` (required by updated interface).

## Verification

### tsc
```
npx tsc  → clean (no output)
```

### vitest
```
Test Files  26 passed, 1 failed (27)
Tests       297 passed, 1 failed (298)
```
The 1 failing test (`conversation-memory.spec.ts > remembers context across turns`) is a pre-existing live Ollama test that requires model `qwek32k:latest` which is not installed in this environment. Not introduced by this batch (confirmed: same failure before this batch).

Our new tests: 7/7 in `ovm-session.test.ts`, 7/7 in `overmind-commands.test.ts`, 10/10 in `overmind-routes.test.ts`.

### Chat flow verified (design-time)
- POST `/api/overmind/ovm/send` `{ message: "hello" }` → `ovmSession.sendAndAwaitReply("hello")` → returns `{ pending: false, reply: "..." }` or `{ pending: true }`.
- When `{ pending: true }`, GET `/api/overmind/ovm/reply` polls `getReply()` which captures latest pane vs pre-send snapshot, checks `hasActiveTurn`, extracts and cleans reply.

## Decisions
- **Sync cap = 28s** (not 12s): the old TG timeout was 12s. The brief says 25-30s; 28s chosen as a round number within that range. At the 28s mark the response returns `{ pending: true }` and the client polls `/reply` every 2s. The `pollUntilDone` background promise keeps running past 28s until OVM is actually done, so no reply is ever lost.
- **Infinite background poll**: `pollUntilDone` has no hard cap — it runs until OVM stabilises. The TG path previously hard-cut at 12s; now TG also benefits from the longer `sendAndAwaitReply` window (28s sync, then fallback). Long tasks never lose their reply to the web client.
- **No sessionStorage**: brief says "optional"; skipped to keep the component simple.

## Caveats
- Only one in-flight send tracked at a time (`inFlight` on the service). Concurrent sends from multiple browser tabs would race. Acceptable for a single-owner dashboard.
- The `pollUntilDone` background promise outlives the HTTP request if it goes pending. It holds a reference to the `OvmSessionService` instance (no leak beyond the service's lifetime).
