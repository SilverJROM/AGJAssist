# [driver] B6 — THE COMMIT UNDER TEST IS `7047fc6bc13e77b03a2ccc0b77a397df7f99ce60`

Analyse EXACTLY that commit: `git show 7047fc6bc13e77b03a2ccc0b77a397df7f99ce60`, `git diff 7047fc6bc13e77b03a2ccc0b77a397df7f99ce60^..7047fc6bc13e77b03a2ccc0b77a397df7f99ce60`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=7047fc6bc13e77b03a2ccc0b77a397df7f99ce60`.

## The change under test (produced by the driver, not reported by the implementer)
```
[B6] delete guardian-routes module and stale test, strengthen removal test


 src/api/routes/guardian-routes.ts | 148 -------------------------------
 tests/guardian-removal.test.ts    |   7 +-
 tests/guardian-routes.test.ts     | 178 --------------------------------------
 3 files changed, 6 insertions(+), 327 deletions(-)
```
```diff
diff --git a/src/api/routes/guardian-routes.ts b/src/api/routes/guardian-routes.ts
deleted file mode 100644
index 30e0a2e..0000000
--- a/src/api/routes/guardian-routes.ts
+++ /dev/null
@@ -1,148 +0,0 @@
-import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
-import { AppConfig } from "../../config/config.js";
-import { isLoopbackAddress } from "./overmind-routes.js";
-import { buildGuardianEscalationNotification } from "../../services/overmind-notifications.js";
-import type { TelegramAssistant } from "../../bot/telegram-bot.js";
-
-const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
-const RETRY_DELAY_MS = 2000;
-const SEVERITIES = new Set(["BLOCKED", "URGENT"]);
-
-function firstHeaderValue(value: string | string[] | undefined): string | undefined {
-  return Array.isArray(value) ? value[0] : value;
-}
-
-// Loopback + shared-secret guard, matching the pattern used for other
-// daemon-facing overmind endpoints (e.g. GET /api/overmind/runs/active).
-// The guardian daemon isn't tied to overmind, so it may send its token under
-// either header name; both are accepted against the same configured secret.
-function requireGuardianAuth(
-  request: FastifyRequest,
-  reply: FastifyReply,
-  expectedToken: string
-): boolean {
-  if (!isLoopbackAddress(request.ip)) {
-    reply.code(403).send({ error: "guardian escalate endpoint is localhost-only" });
-    return false;
-  }
-
-  const token =
-    firstHeaderValue(request.headers["x-overmind-token"]) ||
-    firstHeaderValue(request.headers["x-guardian-token"]);
-  if (!token || token !== expectedToken) {
-    reply.code(401).send({ error: "missing or invalid guardian token" });
-    return false;
-  }
-
-  return true;
-}
-
-interface EscalateBody {
-  run_id?: string;
-  severity?: string;
-  title?: string;
-  lines?: string[];
-  action?: string;
-}
-
-// Module-level: one process serves this route, so an in-memory map is enough
-// to dedupe a retrying daemon within the window. No persistence needed —
-// losing this on restart just means a genuinely-repeated page goes through.
-const recentEscalations = new Map<string, number>();
-
-function pruneExpired(now: number): void {
-  for (const [key, sentAt] of recentEscalations) {
-    if (now - sentAt >= DEDUPE_WINDOW_MS) {
-      recentEscalations.delete(key);
-    }
-  }
-}
-
-interface ValidEscalateBody {
-  runId: string;
-  severity: "BLOCKED" | "URGENT";
-  title: string;
-  lines: string[];
-  action: string;
-}
-
-function validateBody(body: EscalateBody | undefined): ValidEscalateBody | string {
-  if (!body) return "Request body is required";
-  if (!body.run_id || typeof body.run_id !== "string") return "run_id is required";
-  if (!body.severity || !SEVERITIES.has(body.severity)) return "severity must be BLOCKED or URGENT";
-  if (!body.title || typeof body.title !== "string") return "title is required";
-  if (!body.action || typeof body.action !== "string") return "action is required";
-  if (body.lines !== undefined) {
-    if (!Array.isArray(body.lines) || body.lines.some((line) => typeof line !== "string")) {
-      return "lines must be an array of strings";
-    }
-  }
-  return {
-    runId: body.run_id,
-    severity: body.severity as "BLOCKED" | "URGENT",
-    title: body.title,
-    lines: body.lines ?? [],
-    action: body.action
-  };
-}
-
-async function deliverEscalation(
-  telegramAssistant: TelegramAssistant | null | undefined,
-  chatId: number,
-  text: string
-): Promise<void> {
-  if (!telegramAssistant) {
-    console.error("guardian escalate: no Telegram assistant available; message dropped:", text);
-    return;
-  }
-
-  try {
-    await telegramAssistant.sendMessage(chatId, text);
-    return;
-  } catch (error) {
-    console.error("guardian escalate: first Telegram send attempt failed, retrying:", error);
-  }
-
-  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
-
-  try {
-    await telegramAssistant.sendMessage(chatId, text);
-  } catch (error) {
-    console.error("guardian escalate: Telegram send failed after retry; message dropped:", error);
-  }
-}
-
-export function registerGuardianRoutes(
-  app: FastifyInstance,
-  config: AppConfig,
-  telegramAssistant: TelegramAssistant | null | undefined
-): void {
-  app.post<{ Body: EscalateBody }>(
-    "/api/guardian/escalate",
-    async (request, reply) => {
-      if (!requireGuardianAuth(request, reply, config.overmind.token)) return;
-
-      const validated = validateBody(request.body);
-      if (typeof validated === "string") {
-        reply.code(400).send({ error: validated });
-        return;
-      }
-
-      const now = Date.now();
-      pruneExpired(now);
-
-      const key = `${validated.runId}::${validated.title}`;
-      const lastSentAt = recentEscalations.get(key);
-      if (lastSentAt !== undefined && now - lastSentAt < DEDUPE_WINDOW_MS) {
-        reply.code(202).send({ status: "deduped" });
-        return;
-      }
-      recentEscalations.set(key, now);
-
-      reply.code(202).send({ status: "enqueued" });
-
-      const text = buildGuardianEscalationNotification(validated);
-      void deliverEscalation(telegramAssistant, config.telegram.authorizedUserId, text);
-    }
-  );
-}
diff --git a/tests/guardian-removal.test.ts b/tests/guardian-removal.test.ts
index 78b0657..0bbcc31 100644
--- a/tests/guardian-removal.test.ts
+++ b/tests/guardian-removal.test.ts
@@ -1,5 +1,5 @@
 import { describe, it, expect } from "vitest";
-import { readFileSync } from "node:fs";
+import { readFileSync, existsSync } from "node:fs";
 import { createApiServer } from "../src/api/server.js";
 import { AppConfig } from "../src/config/config.js";
 
@@ -35,6 +35,11 @@ function minimalConfig(): AppConfig {
 }
 
 describe("guardian removal B6", () => {
+  it("guardian-routes.ts is removed", () => {
+    const path = new URL("../src/api/routes/guardian-routes.ts", import.meta.url);
+    expect(existsSync(path)).toBe(false);
+  });
+
   it("server.ts no longer imports or calls registerGuardianRoutes", () => {
     const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
     expect(src).not.toContain("registerGuardianRoutes");
diff --git a/tests/guardian-routes.test.ts b/tests/guardian-routes.test.ts
deleted file mode 100644
index 067cbad..0000000
--- a/tests/guardian-routes.test.ts
+++ /dev/null
@@ -1,178 +0,0 @@
-import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
-import Fastify, { FastifyInstance } from "fastify";
-import { registerGuardianRoutes } from "../src/api/routes/guardian-routes.js";
-import { AppConfig } from "../src/config/config.js";
-import type { TelegramAssistant } from "../src/bot/telegram-bot.js";
-
-const OVERMIND_TOKEN = "ovm-test-token";
-
-function testConfig(): AppConfig {
-  return {
-    telegram: {
-      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
-      authorizedUserId: 111222,
-      authorizedChatIds: [111222],
-      testMode: true,
-      updateMode: "polling",
-      webhookUrl: null,
-      webhookPath: "/api/telegram/webhook",
-      webhookSecretToken: "test-secret"
-    },
-    runtime: {
-      workspaceRoot: "/tmp",
-      allowedCommandPrefixes: [],
-      maxToolIterations: 1,
-      defaultTimeoutMinutes: 1
-    },
-    api: {
-      port: 0,
-      host: "127.0.0.1",
-      jwtSecret: "test-secret",
-      sessionExpiryHours: 24
-    },
-    db: {
-      path: "data/test-guardian-routes.sqlite"
-    },
-    projects: {
-      root: "/tmp"
-    },
-    tmux: {
-      historyRetentionDays: 7,
-      outputBufferLines: 5000,
-      streamIntervalMs: 100
-    },
-    overmind: {
-      token: OVERMIND_TOKEN
-    }
-  };
-}
-
-let app: FastifyInstance;
-let sendMessage: ReturnType<typeof vi.fn>;
-let telegramAssistant: TelegramAssistant;
-
-// The dedupe map in guardian-routes.ts is a module-level singleton (by design —
-// one process serves this route). Give each test its own run_id so dedupe
-// windows from earlier tests in this file can't bleed into later ones.
-let runCounter = 0;
-
-function validPayload(overrides: Record<string, unknown> = {}) {
-  return {
-    run_id: `app-fixes-v2-${runCounter}`,
-    severity: "BLOCKED",
-    title: "coordinator session died",
-    lines: ["session: rs-grok", "agent: grok45", "batch: B24c"],
-    action: "restart rs-grok and reseed projcore from context-handoff.md",
-    ...overrides
-  };
-}
-
-beforeEach(async () => {
-  runCounter += 1;
-  sendMessage = vi.fn(async () => {});
-  telegramAssistant = { sendMessage } as unknown as TelegramAssistant;
-  app = Fastify({ logger: false });
-  registerGuardianRoutes(app, testConfig(), telegramAssistant);
-  await app.ready();
-});
-
-afterEach(async () => {
-  await app.close();
-  vi.restoreAllMocks();
-});
-
-async function postEscalate(
-  payload: unknown,
-  headers: Record<string, string> = {},
-  remoteAddress = "127.0.0.1"
-) {
-  return app.inject({
-    method: "POST",
-    url: "/api/guardian/escalate",
-    headers,
-    remoteAddress,
-    payload: payload as Record<string, unknown>
-  });
-}
-
-describe("POST /api/guardian/escalate", () => {
-  it("rejects a non-loopback caller even with a valid token", async () => {
-    const res = await postEscalate(
-      validPayload(),
-      { "x-overmind-token": OVERMIND_TOKEN },
-      "203.0.113.5"
-    );
-    expect(res.statusCode).toBe(403);
-  });
-
-  it("rejects a loopback caller with no token", async () => {
-    const res = await postEscalate(validPayload());
-    expect(res.statusCode).toBe(401);
-  });
-
-  it("rejects a loopback caller with the wrong token", async () => {
-    const res = await postEscalate(validPayload(), { "x-overmind-token": "wrong" });
-    expect(res.statusCode).toBe(401);
-  });
-
-  it("accepts x-overmind-token and delivers the formatted message to the authorized user", async () => {
-    const res = await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });
-
-    expect(res.statusCode).toBe(202);
-    expect(res.json()).toEqual({ status: "enqueued" });
-
-    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
-    const [chatId, text] = sendMessage.mock.calls[0];
-    expect(chatId).toBe(111222);
-    expect(text).toContain("🛑 BLOCKED · AGJAssist · guardian");
-    expect(text).toContain(`Run: app-fixes-v2-${runCounter}`);
-    expect(text).toContain("session: rs-grok");
-    expect(text).toContain("Need from you: restart rs-grok and reseed projcore from context-handoff.md");
-  });
-
-  it("also accepts x-guardian-token (guardian isn't tied to overmind but shares the secret)", async () => {
-    const res = await postEscalate(validPayload(), { "x-guardian-token": OVERMIND_TOKEN });
-
-    expect(res.statusCode).toBe(202);
-    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
-  });
-
-  it("rejects a severity other than BLOCKED or URGENT", async () => {
-    const res = await postEscalate(validPayload({ severity: "INFO" }), { "x-overmind-token": OVERMIND_TOKEN });
-    expect(res.statusCode).toBe(400);
-  });
-
-  it("rejects a payload missing required fields", async () => {
-    const res = await postEscalate(
-      { run_id: "app-fixes-v2", severity: "URGENT" },
-      { "x-overmind-token": OVERMIND_TOKEN }
-    );
-    expect(res.statusCode).toBe(400);
-  });
-
-  it("dedupes a retried escalation with the same run_id and title within the window, without re-sending Telegram", async () => {
-    const first = await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });
-    expect(first.statusCode).toBe(202);
-    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
-
-    const retry = await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });
-    expect(retry.statusCode).toBe(202);
-    expect(retry.json()).toEqual({ status: "deduped" });
-
-    expect(sendMessage).toHaveBeenCalledTimes(1);
-  });
-
-  it("does not dedupe a different title for the same run", async () => {
-    await postEscalate(validPayload(), { "x-overmind-token": OVERMIND_TOKEN });
-    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
-
-    const res = await postEscalate(
-      validPayload({ title: "a different failure" }),
-      { "x-overmind-token": OVERMIND_TOKEN }
-    );
-    expect(res.statusCode).toBe(202);
-    expect(res.json()).toEqual({ status: "enqueued" });
-
-    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
-  });
-});
```

# tiller validator — standing contract
(This section is identical in every validator brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the VALIDATOR. **Write NO product code** (verifier != fixer). You judge, independently.

---

# THE SLICE — B6 (run command-center-2026-08-26)

## Scope (do ONLY this)
API layer: remove `registerGuardianRoutes` and `POST /api/guardian/escalate`; stop importing `isLoopbackAddress` / `buildGuardianEscalationNotification` (delete them here if unused, else leave a local copy for non-OVM loopback routes). Regression fixture: calendar-reminder Telegram paging still sends. Precedes B2/B3.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **B1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **B2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx vitest run tests/guardian-removal.test.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=B6 attempt=1 role=validator
  marker=DRV-B6-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate B6 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator B6 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B6-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
**One block per finding that is NOT A CLEAN PASS — including PARTIAL. If N things failed or partially failed, write N blocks** — numbered, in the order you would fix them. Do NOT collapse them to the most important one. Only a lens that passed CLEANLY gets no block:
```
FINDING 1 of <N>
WHAT FAILED: <the specific assertion/behaviour, and where>
THE FIX: <the concrete change that would make this pass>
WHY THE LAST ATTEMPT MISSED IT: <one line, optional>

FINDING 2 of <N>
WHAT FAILED: ...
THE FIX: ...
```
**A finding you leave out can cost a FULL ATTEMPT CYCLE to rediscover** — an implementer turn, a validator turn and the callback latency — to learn something already written on disk. A strong seat sometimes infers past the omission; do not rely on the next seat being that seat. The gate id below stays singular because it names ONE gate; your prescription must not.
**NAME A MECHANISM, NOT AN OUTCOME.** A call, a path, a specimen, a structure, a flag — not the property the change should have. *"Tests must fail when the clause is violated"* is an OUTCOME and is worth nothing to the next seat; *"the negative specimen's NAME must contradict its shape"* is a mechanism and closed the slice. That distinction is not stylistic: a slice spent FOUR attempts each inventing a different mechanism for one question — zero-arg call, bytecode scan, object() sentinel, MagicMock sentinel — while the fix sat unwritten, and closed on the first attempt that had it. **The next implementer sees this file VERBATIM and sees your callback line only as a summary; if the fix is not in the file, it does not reach them.**
`[VERDICT-V1] run=command-center-2026-08-26 batch=B6 attempt=3 marker=DRV-B6-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
