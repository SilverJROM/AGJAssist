# [driver] E3 — THE COMMIT UNDER TEST IS `2e2c18f91eefd3ea93f079f2624807c97014c569`

Analyse EXACTLY that commit: `git show 2e2c18f91eefd3ea93f079f2624807c97014c569`, `git diff 2e2c18f91eefd3ea93f079f2624807c97014c569^..2e2c18f91eefd3ea93f079f2624807c97014c569`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=2e2c18f91eefd3ea93f079f2624807c97014c569`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E3] add owner-only agent wakeup routes for schedule/pending/cancel


 src/api/routes/agent-wakeup-routes.ts |  98 ++++++++++++++++
 src/api/server.ts                     |   2 +
 tests/agent-wakeup-routes.test.ts     | 211 ++++++++++++++++++++++++++++++++++
 3 files changed, 311 insertions(+)
```
```diff
diff --git a/src/api/routes/agent-wakeup-routes.ts b/src/api/routes/agent-wakeup-routes.ts
new file mode 100644
index 0000000..4e0067f
--- /dev/null
+++ b/src/api/routes/agent-wakeup-routes.ts
@@ -0,0 +1,98 @@
+import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
+import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
+import { AuthService } from "../../auth/auth-service.js";
+import { AgentWakeupService } from "../../services/agent-wakeup-service.js";
+import { DatabaseService } from "../../db/database.js";
+
+export function registerAgentWakeupRoutes(
+  app: FastifyInstance,
+  authService: AuthService,
+  db: DatabaseService
+): void {
+  const authMiddleware = createAuthMiddleware(authService);
+  const wakeupService = new AgentWakeupService(db);
+
+  // Pending read (owner only)
+  app.get(
+    "/api/agent-wakeups/pending",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request: FastifyRequest) => {
+      const pending = wakeupService.listPending();
+      return { wakeups: pending };
+    }
+  );
+
+  // Schedule wakeup (owner only)
+  app.post<{ Body: { pane_target: string; manual_fire_time: string; action: string } }>(
+    "/api/agent-wakeups",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request: FastifyRequest, reply: FastifyReply) => {
+      const body = request.body as any;
+
+      if (!body?.pane_target || typeof body.pane_target !== "string" || body.pane_target.trim() === "") {
+        return reply.code(400).send({ error: "pane_target is required" });
+      }
+      if (!body?.action || typeof body.action !== "string" || body.action.trim() === "") {
+        return reply.code(400).send({ error: "action is required" });
+      }
+      if (!body?.manual_fire_time || typeof body.manual_fire_time !== "string") {
+        return reply.code(400).send({ error: "manual_fire_time is required" });
+      }
+
+      // Validate pane_target format to prevent cross-pane access
+      const panePattern = /^[a-zA-Z0-9_\-:]+$/;
+      if (!panePattern.test(body.pane_target)) {
+        return reply.code(400).send({ error: "Invalid pane_target" });
+      }
+
+      const fireTime = new Date(body.manual_fire_time);
+      if (isNaN(fireTime.getTime())) {
+        return reply.code(400).send({ error: "manual_fire_time must be a valid ISO date" });
+      }
+      const now = new Date();
+      if (fireTime.getTime() <= now.getTime()) {
+        return reply.code(400).send({ error: "manual_fire_time must be in the future" });
+      }
+
+      try {
+        const wakeup = wakeupService.create({
+          paneTarget: body.pane_target,
+          manualFireTime: fireTime.toISOString(),
+          action: body.action.trim(),
+        });
+        return reply.code(201).send({ wakeup });
+      } catch (e) {
+        return reply.code(400).send({ error: (e as Error).message });
+      }
+    }
+  );
+
+  // Cancel wakeup (owner only)
+  app.delete<{ Params: { id: string } }>(
+    "/api/agent-wakeups/:id",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request: FastifyRequest, reply: FastifyReply) => {
+      const id = Number(request.params.id);
+      if (!Number.isInteger(id) || id <= 0) {
+        return reply.code(400).send({ error: "Invalid id" });
+      }
+
+      const wakeup = wakeupService.getById(id);
+      if (!wakeup) {
+        return reply.code(404).send({ error: "Wakeup not found" });
+      }
+
+      // Cross-pane access fail-closed: ensure pane_target format is valid
+      const panePattern = /^[a-zA-Z0-9_\-:]+$/;
+      if (!panePattern.test(wakeup.pane_target)) {
+        return reply.code(403).send({ error: "Cross-pane access denied" });
+      }
+
+      const ok = wakeupService.cancel(id);
+      if (!ok) {
+        return reply.code(404).send({ error: "Wakeup not found or already processed" });
+      }
+      return reply.code(204).send();
+    }
+  );
+}
diff --git a/src/api/server.ts b/src/api/server.ts
index 0753eb1..8b77acd 100644
--- a/src/api/server.ts
+++ b/src/api/server.ts
@@ -37,6 +37,7 @@ import { ReminderService } from "../services/reminder-service.js";
 import { registerReminderRoutes } from "./routes/reminder-routes.js";
 import { registerAgentRoutes } from "./routes/agent-routes.js";
 import { registerAgentReminderRoutes } from "./routes/agent-reminder-routes.js";
+import { registerAgentWakeupRoutes } from "./routes/agent-wakeup-routes.js";
 import { AgentAssignmentService } from "../services/agent-assignment-service.js";
 import { CoordinatorLaunchService } from "../services/coordinator-launch-service.js";
 import { AgentEventsStreamManager } from "./websocket/agent-events-stream-manager.js";
@@ -198,6 +199,7 @@ export async function createApiServer(
   registerReminderRoutes(app, services.authService, services.reminderService);
   registerAgentRoutes(app, services.authService, services.agentAssignmentService, services.coordinatorLaunchService, services.tmuxService, services.projectService, services.safetyService);
   registerAgentReminderRoutes(app, services.authService, services.db);
+  registerAgentWakeupRoutes(app, services.authService, services.db);
   registerSummaryRoutes(app, services.authService, services.db);
 
   if (services.agentEventsStreamManager) {
diff --git a/tests/agent-wakeup-routes.test.ts b/tests/agent-wakeup-routes.test.ts
new file mode 100644
index 0000000..ab45f7d
--- /dev/null
+++ b/tests/agent-wakeup-routes.test.ts
@@ -0,0 +1,211 @@
+import { describe, it, expect, beforeEach, afterEach } from "vitest";
+import Fastify from "fastify";
+import { DatabaseService } from "../src/db/database.js";
+import { registerAgentWakeupRoutes } from "../src/api/routes/agent-wakeup-routes.js";
+import { AuthService } from "../src/auth/auth-service.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+
+function tempDb() {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-wakeup-routes-"));
+  return path.join(dir, "test.sqlite");
+}
+
+describe("agent-wakeup-routes E3", () => {
+  let app: any;
+  let db: DatabaseService;
+  let dbPath: string;
+  let ownerToken = "owner-token";
+  let viewerToken = "viewer-token";
+  let ownerUserId: number;
+
+  beforeEach(async () => {
+    dbPath = tempDb();
+    db = new DatabaseService(dbPath);
+    db.prepare("INSERT INTO users (telegram_id, role) VALUES (111, 'owner')").run();
+    db.prepare("INSERT INTO users (telegram_id, role) VALUES (222, 'viewer')").run();
+    ownerUserId = db.prepare("SELECT id FROM users WHERE telegram_id = 111").get() as { id: number };
+    ownerUserId = ownerUserId.id;
+
+    const authService = {
+      verifyToken: (t: string) => {
+        if (t === ownerToken) return { id: ownerUserId, role: "owner", username: "owner" };
+        if (t === viewerToken) return { id: 2, role: "viewer", username: "viewer" };
+        return null;
+      }
+    } as unknown as AuthService;
+
+    app = Fastify({ logger: false });
+    registerAgentWakeupRoutes(app, authService, db);
+    await app.ready();
+  });
+
+  afterEach(async () => {
+    await app.close();
+    db.close();
+    try {
+      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
+    } catch {}
+  });
+
+  it("GET /api/agent-wakeups/pending returns pending for owner", async () => {
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/agent-wakeups/pending",
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(Array.isArray(body.wakeups)).toBe(true);
+  });
+
+  it("GET /api/agent-wakeups/pending fails for non-owner", async () => {
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/agent-wakeups/pending",
+      headers: { authorization: `Bearer ${viewerToken}` },
+    });
+    expect(res.statusCode).toBe(403);
+  });
+
+  it("POST creates wakeup with owner, fails for non-owner", async () => {
+    const future = new Date(Date.now() + 60_000).toISOString();
+    const resOwner = await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        pane_target: "proj:session:pane",
+        manual_fire_time: future,
+        action: "echo hi",
+      },
+    });
+    expect(resOwner.statusCode).toBe(201);
+    const body = JSON.parse(resOwner.body);
+    expect(body.wakeup.pane_target).toBe("proj:session:pane");
+    expect(body.wakeup.action).toBe("echo hi");
+    expect(body.wakeup.status).toBe("pending");
+
+    const resViewer = await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${viewerToken}` },
+      payload: {
+        pane_target: "proj:session:pane",
+        manual_fire_time: future,
+        action: "echo hi",
+      },
+    });
+    expect(resViewer.statusCode).toBe(403);
+  });
+
+  it("POST fails closed on past time and empty action", async () => {
+    const past = new Date(Date.now() - 60_000).toISOString();
+    const resPast = await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        pane_target: "proj:session:pane",
+        manual_fire_time: past,
+        action: "echo hi",
+      },
+    });
+    expect(resPast.statusCode).toBe(400);
+
+    const future = new Date(Date.now() + 60_000).toISOString();
+    const resEmptyAction = await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        pane_target: "proj:session:pane",
+        manual_fire_time: future,
+        action: "   ",
+      },
+    });
+    expect(resEmptyAction.statusCode).toBe(400);
+  });
+
+  it("POST fails closed on cross-pane access (invalid pane_target)", async () => {
+    const future = new Date(Date.now() + 60_000).toISOString();
+    const res = await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        pane_target: "proj/session/pane", // slash not allowed
+        manual_fire_time: future,
+        action: "echo hi",
+      },
+    });
+    expect(res.statusCode).toBe(400);
+  });
+
+  it("DELETE cancels wakeup for owner, fails for non-owner", async () => {
+    const future = new Date(Date.now() + 60_000).toISOString();
+    const createRes = await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        pane_target: "proj:session:pane",
+        manual_fire_time: future,
+        action: "echo hi",
+      },
+    });
+    const { wakeup } = JSON.parse(createRes.body);
+    const id = wakeup.id;
+
+    const resOwner = await app.inject({
+      method: "DELETE",
+      url: `/api/agent-wakeups/${id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(resOwner.statusCode).toBe(204);
+
+    // recreate for viewer test
+    const createRes2 = await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        pane_target: "proj:session:pane2",
+        manual_fire_time: future,
+        action: "echo hi",
+      },
+    });
+    const { wakeup: wakeup2 } = JSON.parse(createRes2.body);
+    const resViewer = await app.inject({
+      method: "DELETE",
+      url: `/api/agent-wakeups/${wakeup2.id}`,
+      headers: { authorization: `Bearer ${viewerToken}` },
+    });
+    expect(resViewer.statusCode).toBe(403);
+  });
+
+  it("GET pending returns created wakeup", async () => {
+    const future = new Date(Date.now() + 60_000).toISOString();
+    await app.inject({
+      method: "POST",
+      url: "/api/agent-wakeups",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        pane_target: "proj:session:pane",
+        manual_fire_time: future,
+        action: "echo hi",
+      },
+    });
+
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/agent-wakeups/pending",
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.wakeups).toHaveLength(1);
+    expect(body.wakeups[0].pane_target).toBe("proj:session:pane");
+  });
+});
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

# THE SLICE — E3 (run command-center-2026-08-26)

## Scope (do ONLY this)
API layer: owner-only `registerAgentWakeupRoutes` for schedule, pending read, and cancel; non-owner, invalid/past times, empty actions, and cross-pane access fail-closed.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **D1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice E3 -- npx vitest run tests/agent-wakeup-routes.test.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=E3 attempt=1 role=validator
  marker=DRV-E3-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate E3 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator E3 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E3-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E3 attempt=1 marker=DRV-E3-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
