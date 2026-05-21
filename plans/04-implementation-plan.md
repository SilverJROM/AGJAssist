# Implementation Plan — AGJAssist Chat Conversation Memory Fix
**Date**: 2026-03-13
**Mode**: upgrade
**Cost Mode**: sonnet-only
**Repo**: `/home/agjrom/TGBOTS/AGJAssist`
**Output folder**: `/home/agjrom/TGBOTS/AGJAssist/plans/`

---

## Pipeline Summary

| Agent | Status | Reason |
|-------|--------|--------|
| `bsconsult02` | SKIPPED | No new business rules, roles, or entities. Pure bug fix + config data addition. |
| `sysarch02` | SKIPPED | No new endpoints, data models, or infrastructure changes. All changes within existing component boundaries. |
| `webdesign02` | SKIPPED | Codex model list is returned by existing API endpoint; frontend model selector renders it dynamically. No new screens or flows. |
| `pmanager02` | RAN | Sole mandatory output. Implementation plan built directly from requirements + codebase analysis. |

---

## Current vs Desired Gap Analysis

### GAP-01 — Claude CLI history ignored
- **Current**: `ClaudeCliProvider.chatWithSession()` builds prompt from `system + lastUserMsg` only (lines 98-101). All `assistant`/prior `user` messages passed in the messages array are discarded.
- **Desired**: Serialize full conversation history (all prior user/assistant turns) into the prompt text so Claude CLI receives full context in every call.

### GAP-02 — Codex CLI history ignored
- **Current**: `CodexCliProvider.chatWithSession()` has identical bug — builds prompt from `system + lastUserMsg` only (lines 78-80).
- **Desired**: Same fix as GAP-01, applied to Codex CLI provider.

### GAP-03 — Codex model dropdown has only 1 option
- **Current**: `/api/chat/models/codex` returns a single model `{ id: "codex-default", name: "Codex (Default Model)" }`.
- **Desired**: 3 options — default + top 2 named Codex models (`codex-mini-latest`, `o4-mini`).

### GAP-04 — No E2E test for conversation memory
- **Current**: No test validates that multi-turn conversation memory works for any provider.
- **Desired**: A Vitest integration test that creates a conversation, sends two messages via the Ollama provider, and asserts that the second response reflects context from the first.

---

## Traceability

All tasks trace directly to the original requirements (no upstream spec docs):

| ID | Requirement Reference |
|----|----------------------|
| TASK-01 | REQ: "Claude — currently only passes the last user message to `claude -p`. Must include full conversation history." |
| TASK-02 | REQ: "Codex — same issue as Claude. Must include full conversation history in the prompt." |
| TASK-03 | REQ: "Codex model list — add the top 2 Codex models alongside the default (3 total in dropdown)." |
| TASK-04 | REQ: "Create a test that validates conversation memory... Test at minimum with Ollama." |

---

## Critical Path

```
TASK-01 (fix Claude CLI history)
TASK-02 (fix Codex CLI history)
TASK-03 (add Codex models)
    ↓
TASK-04 (conversation memory E2E test — validates TASK-01/02 via Ollama)
    ↓
MS-01: All tests green → DONE
```

TASK-01, TASK-02, TASK-03 can execute in parallel. TASK-04 runs after all three.

---

## Task Contracts

---

### TASK-01 — Fix ClaudeCliProvider: serialize full conversation history
**Owner**: `elitedev02` (Sonnet — routine bug fix with clear scope)
**File**: `/home/agjrom/TGBOTS/AGJAssist/src/llm/claude-cli-provider.ts`

**Goal**: Modify `chatWithSession()` (and `chat()`) so that ALL conversation history messages (prior user + assistant turns) are serialized into the prompt string passed to `claude -p`.

**Pre-execution checklist**:
- [ ] Read the current `chatWithSession()` implementation (lines 94–140)
- [ ] Identify where `prompt` is built and what messages are excluded
- [ ] Confirm the `messages` parameter includes the full history when called from `chat-routes.ts`

**Inputs**:
- File: `src/llm/claude-cli-provider.ts`
- Context: Messages array format: `[system?, ...history_user_assistant_pairs, user]`
- The system message is already extracted; the gap is that history pairs are ignored

**Required change**:
In `chatWithSession()` (and `chat()`), after appending the system message, iterate over all non-system, non-last-user messages in order and append them as formatted conversation history before the final user message. Use this serialization format:

```
<prior conversation history>
Human: <prior user message>
Assistant: <prior assistant message>
...
</prior conversation history>

<current user message>
```

Or use a simpler flat format that Claude CLI handles well:

```
[System instructions if any]

Previous conversation:
Human: ...
Assistant: ...
Human: ...
Assistant: ...

Current message: <last user msg>
```

**Acceptance criteria**:
- [ ] `chatWithSession()` serializes all history messages (role = user/assistant, excluding last user) into the prompt
- [ ] `chat()` gets the same fix (keep both methods consistent)
- [ ] If messages array has only system + one user msg (first message in conversation), behavior is unchanged
- [ ] No regression: TypeScript compiles without errors (`npm run build`)
- [ ] Unit test: `tests/unit/conversation-service.spec.ts` still passes

**Stop conditions**:
- If Claude CLI rejects the prompt format or produces empty output, try alternative history serialization format before escalating
- Do NOT modify `chat-routes.ts` — it already passes the correct messages array

**Completion summary required**: List exact lines changed, before/after for prompt-build logic.

---

### TASK-02 — Fix CodexCliProvider: serialize full conversation history
**Owner**: `elitedev02` (Sonnet — routine bug fix, same pattern as TASK-01)
**File**: `/home/agjrom/TGBOTS/AGJAssist/src/llm/codex-cli-provider.ts`

**Goal**: Same fix as TASK-01, applied to `CodexCliProvider.chatWithSession()` and `chat()`.

**Pre-execution checklist**:
- [ ] Read `chatWithSession()` and `chat()` in `codex-cli-provider.ts` (lines 19–104)
- [ ] Note: Codex session resumption via `codex exec resume <sessionId>` still applies — the history serialization is a fallback when no sessionId exists, and a supplement when one does

**Required change**:
In both `chat()` and `chatWithSession()`, serialize history messages (all non-system, non-last-user messages) into the prompt string using the same format pattern as TASK-01.

Note: Codex uses `codex exec --skip-git-repo-check <prompt>` — the full prompt is a single string argument. Keep history serialization compact to avoid overly long CLI args.

**Acceptance criteria**:
- [ ] `chatWithSession()` and `chat()` serialize full history into prompt
- [ ] TypeScript compiles without errors
- [ ] No changes to CLI invocation args pattern (still `codex exec --skip-git-repo-check <prompt>`)
- [ ] Existing tests still pass

**Stop conditions**:
- If Codex CLI truncates long prompts, apply a character budget (e.g., last 3000 chars of history) and document the limit in a comment

---

### TASK-03 — Add Codex model options to `/api/chat/models/codex`
**Owner**: `elitedev02` (Sonnet — simple config data addition)
**File**: `/home/agjrom/TGBOTS/AGJAssist/src/api/routes/chat-routes.ts`

**Goal**: Return 3 model options for the Codex provider instead of 1.

**Pre-execution checklist**:
- [ ] Read the `codex` branch of `/api/chat/models/:provider` endpoint (lines 216–223)
- [ ] Confirm current structure: returns single model `codex-default`

**Required change** (lines 216–223 in `chat-routes.ts`):

```typescript
if (provider === "codex") {
  return {
    models: [
      { id: "codex-default", name: "Codex (Default)", active: true },
      { id: "codex-mini-latest", name: "Codex Mini (Latest)", active: false },
      { id: "o4-mini", name: "o4-mini", active: false },
    ],
    activeModel: "codex-default"
  };
}
```

Also update `CodexCliProvider` to accept and use a `model` parameter (similar to how `ClaudeCliProvider` has `setModel()`/`getModel()`):
- Add `private model: string = "codex-default"` property
- Add `getModel(): string` and `setModel(model: string): void` methods
- In `chat()` and `chatWithSession()`, pass `--model <model>` to the `codex exec` args if model is not `codex-default`

Also update the `/api/chat/provider-model` endpoint in `chat-routes.ts` to handle `provider === "codex"` (currently only handles `ollama` and `claude`, line 296+).

**Acceptance criteria**:
- [ ] `GET /api/chat/models/codex` returns 3 model entries
- [ ] `POST /api/chat/provider-model` with `{ provider: "codex", model: "codex-mini-latest" }` succeeds (returns `{ ok: true, model }`)
- [ ] TypeScript compiles without errors
- [ ] Existing tests pass

**Stop conditions**:
- If `codex exec --model` flag does not exist in the installed version, use model as metadata only (display name) and log a warning — do NOT break the invocation

---

### TASK-04 — Create conversation memory E2E test (Ollama)
**Owner**: `elitedev02` (Sonnet — new test with clear acceptance criteria)
**File**: `/home/agjrom/TGBOTS/AGJAssist/tests/unit/conversation-memory.spec.ts` (new file)

**Goal**: Create a Vitest integration test that validates conversation memory works end-to-end via the chat API using the Ollama provider.

**Pre-execution checklist**:
- [ ] Read `tests/unit/conversation-service.spec.ts` for DB/service setup patterns
- [ ] Read `src/api/routes/chat-routes.ts` to understand the `/api/chat/send` endpoint
- [ ] Read `src/api/routes/conversation-routes.ts` to understand conversation create/delete endpoints
- [ ] Confirm Vitest test runner config: `vitest.config.ts` includes `tests/**/*.spec.ts`
- [ ] Note: This is a unit/integration test (not E2E via HTTP) — instantiate providers and services directly to avoid needing a running server

**Test strategy**:
The test should exercise the full memory path: conversation creation → message 1 → provider call → message 2 → assert context carried over. Since Ollama is an external service that may not be available in CI, use the following approach:

1. Test the **conversation service + history-building logic** in isolation (always runs, no external deps):
   - Create a conversation, add messages, verify history array is built correctly with all roles
   - Verify the history filtering in `chat-routes.ts` (lines 57-74) correctly builds context including prior turns

2. Create a **live Ollama test** that is skipped if Ollama is not available (server-only test):
   - Guard with `process.env.TEST_OLLAMA === 'true'` or a connectivity check
   - Create conversation via service
   - Simulate the chat-routes logic directly (build history, call OllamaProvider, add messages)
   - Send: "hello who are you? remember my fave number #23"
   - Send follow-up with history: "what is my favorite number?"
   - Assert response contains "23"
   - Cleanup: delete conversation

**Required test structure**:

```typescript
// tests/unit/conversation-memory.spec.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";
import { ConversationService } from "../../src/services/conversation-service.js";
import { OllamaProvider } from "../../src/llm/ollama-provider.js";

// Test 1: History serialization logic (always runs)
describe("Conversation history building", () => {
  // Test that after two addMessage calls, the messages array contains both turns
  // Test that the history filter in chat-routes (last 20, filter errors) works correctly
});

// Test 2: Live Ollama memory test (guarded)
describe("Ollama conversation memory (live)", () => {
  it.skipIf(!process.env.TEST_OLLAMA)("remembers context across turns", async () => {
    // Setup: DB + services
    // Create conversation
    // Turn 1: send message with #23
    // Turn 2: build history from conversation, ask about favorite number
    // Assert: response includes "23"
    // Cleanup: delete conversation
  });
});
```

**Acceptance criteria**:
- [ ] `npm test` passes with the new spec file included (non-live tests always pass)
- [ ] Non-live tests verify that history array is correctly built and contains all prior turns
- [ ] Live test (when `TEST_OLLAMA=true`) creates conversation, sends two messages, asserts "23" in response, deletes conversation
- [ ] No test leaves orphaned data (cleanup runs in `afterEach`)
- [ ] Test file follows existing patterns (DatabaseService, AuditService setup)

**Stop conditions**:
- If `OllamaProvider` constructor/interface is not directly instantiable in tests (e.g., requires config), mock or skip the live portion and document
- Live test failure is NOT a blocker for the implementation plan completion — it validates correctness but the fix is in the providers

---

## Milestone Summary

| MS | Milestone | Completion Evidence |
|----|-----------|---------------------|
| MS-01 | TASK-01+02 complete | `claude-cli-provider.ts` and `codex-cli-provider.ts` serialize full history; `npm run build` passes |
| MS-02 | TASK-03 complete | `/api/chat/models/codex` returns 3 models; `npm run build` passes |
| MS-03 | TASK-04 complete | `npm test` passes; new spec file exists with non-live tests green |
| MS-FINAL | All milestones done | `npm run build` clean, `npm test` all green, Telegram COMPLETION sent |

---

## Execution Order

```
Phase 1 (parallel):
  - elitedev02 → TASK-01 (ClaudeCliProvider fix)
  - elitedev02 → TASK-02 (CodexCliProvider fix)
  - elitedev02 → TASK-03 (Codex models)

Phase 2:
  - elitedev02 → TASK-04 (E2E memory test)

Phase 3:
  - Full build + test: npm run build && npm test
  - If green → MS-FINAL, send COMPLETION notification
  - If failures → implementation loop (max 2 iterations)
```

---

## Implementation Loop Contract

- **Loop limit**: 2 iterations per task
- **Iteration 1**: `elitedev02` fixes the issue
- **Iteration 2**: `elitedev02` second attempt with different approach
- **If still failing after 2 iterations**:
  1. Codex escalation: `codex exec -m 5.3 --context-window high -s suggest "<escalation-packet>"`
  2. Second Codex escalation
  3. Opus escalation: `claude --model opus -p "<escalation-packet>"`
  4. Second Opus escalation
  5. User STOP

**Escalation packet must include**:
1. Problem summary (what fails and how)
2. What was attempted (all iterations with diffs)
3. Diagnosis (root cause hypothesis)
4. Proposed next angle
5. Full relevant file content

---

## Test Loop Contract

- **Loop limit**: 3 iterations
- `elitedev02` resolves test failures after `npm test` run
- After 3 failed iterations → escalate via Codex → Opus → User STOP

---

## One-Shot Execution Contract

Once implementation starts, only two exit states are valid:
1. **COMPLETE**: All tasks done, `npm run build` clean, `npm test` all green
2. **ESCALATED STOP**: Loop caps exhausted or critical blocker unresolvable

No partial handoffs. No open-ended pauses.

---

## Telegram Notification Contract

Send notifications at each milestone and on completion/error:

```bash
# Start
curl -X POST http://127.0.0.1:8701/notify \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pmanager02",
    "project": "AGJAssist",
    "model": "Sonnet",
    "message": "📬 pmanager02 Notification\n\n🤖 Claude (Sonnet) · 📁 [AGJAssist]\n───────────────────\n\n🚀 START — Chat memory fix implementation begun\n\n• TASK-01: Claude CLI history fix\n• TASK-02: Codex CLI history fix\n• TASK-03: Codex model list (3 models)\n• TASK-04: E2E memory test\n\nOwner: elitedev02 (all tasks)"
  }'

# After each TASK
curl -X POST http://127.0.0.1:8701/notify \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pmanager02",
    "project": "AGJAssist",
    "model": "Sonnet",
    "message": "📬 pmanager02 Notification\n\n🤖 Claude (Sonnet) · 📁 [AGJAssist]\n───────────────────\n\n🎯 MILESTONE — TASK-0X complete\n\n• <files changed>\n• Build: passing\n\nNext: TASK-0Y"
  }'

# Completion
curl -X POST http://127.0.0.1:8701/notify \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pmanager02",
    "project": "AGJAssist",
    "model": "Sonnet",
    "message": "📬 pmanager02 Notification\n\n🤖 Claude (Sonnet) · 📁 [AGJAssist]\n───────────────────\n\n🎉 COMPLETION — Chat memory fix complete ✅\n\n• TASK-01: Claude CLI history ✅\n• TASK-02: Codex CLI history ✅\n• TASK-03: Codex models (3) ✅\n• TASK-04: E2E memory test ✅\n\nnpm run build: clean\nnpm test: all green"
  }'
```

---

## Cost Optimization (sonnet-only)

All 4 tasks assigned to `elitedev02` (Sonnet). No Opus escalation unless loop limits are exceeded.

| Task | Agent | Rationale |
|------|-------|-----------|
| TASK-01 | elitedev02 | Routine bug fix — string serialization logic, clear scope |
| TASK-02 | elitedev02 | Same as TASK-01, identical pattern |
| TASK-03 | elitedev02 | Config data addition + minor method additions |
| TASK-04 | elitedev02 | New test file with clear acceptance criteria |

Escalate to `elitedev01` (Opus) only if elitedev02 hits loop limits on any task.

---

## Risk Controls

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Claude CLI rejects long history-embedded prompts | Low | Apply character budget on history (last ~4000 chars); test with short history first |
| Codex CLI `--model` flag not supported | Medium | Add defensive check; if flag not supported, use model as metadata only with warning comment |
| Ollama not available in test env | High | Live Ollama test is guarded by `process.env.TEST_OLLAMA`; non-live tests always run |
| TypeScript type errors from new Codex model/method | Low | Follow exact same pattern as `ClaudeCliProvider` for `getModel`/`setModel` |

---

## Scope Exclusions (intentional)

- **TG bot one-shot commands** (`haiku hello`, `codex <prompt>`, etc.) — intentionally stateless, no changes needed
- **Ollama/OpenRouter providers** — already pass history correctly via `fullRequest` string in `chat-routes.ts`; verified no changes needed
- **Claude `--resume` session mechanism** — already implemented and functional; history serialization is an additional fallback layer, not a replacement
- **Frontend UI** — model selector already renders dynamically from API; no changes needed beyond TASK-03's API change

---

## Post-Implementation: Update Project Specification

**Since all upstream agents were skipped** (bsconsult, sysarch, webdesign), and this is a targeted bug fix with minor data additions, **no project_specification.md update is required** unless the implementor judges that the history-serialization pattern warrants documenting in the architecture section.

PM judgment: Skip spec update for this change. The change is narrow, internal to existing providers, and does not alter any user-visible architecture or business rules.

---

## Completion Criteria (Definition of Done)

All of the following must be true before declaring DONE:

- [ ] `src/llm/claude-cli-provider.ts` — `chatWithSession()` and `chat()` serialize full history
- [ ] `src/llm/codex-cli-provider.ts` — `chatWithSession()` and `chat()` serialize full history; `getModel()`/`setModel()` added
- [ ] `src/api/routes/chat-routes.ts` — Codex model endpoint returns 3 models; `provider-model` handles codex
- [ ] `tests/unit/conversation-memory.spec.ts` — exists with passing non-live tests
- [ ] `npm run build` exits with code 0
- [ ] `npm test` exits with code 0 (all tests including new spec)
- [ ] Telegram COMPLETION notification sent
