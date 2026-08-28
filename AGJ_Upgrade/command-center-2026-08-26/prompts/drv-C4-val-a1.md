# [driver] C4 — THE COMMIT UNDER TEST IS `266aca969e982fca488ac6046feef02c90991c47`

Analyse EXACTLY that commit: `git show 266aca969e982fca488ac6046feef02c90991c47`, `git diff 266aca969e982fca488ac6046feef02c90991c47^..266aca969e982fca488ac6046feef02c90991c47`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=266aca969e982fca488ac6046feef02c90991c47`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C4] Add owner-only agent reminder API routes and tests


 src/api/routes/agent-reminder-routes.ts | 132 +++++++++++++++++++++
 src/api/server.ts                       |   2 +
 tests/agent-reminder-routes.test.ts     | 204 ++++++++++++++++++++++++++++++++
 3 files changed, 338 insertions(+)
```
```diff
diff --git a/src/api/routes/agent-reminder-routes.ts b/src/api/routes/agent-reminder-routes.ts
new file mode 100644
index 0000000..aee9473
--- /dev/null
+++ b/src/api/routes/agent-reminder-routes.ts
@@ -0,0 +1,132 @@
+import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
+import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
+import { AuthService } from "../../auth/auth-service.js";
+import { AgentSolicitService } from "../../services/agent-solicit-service.js";
+import { DatabaseService } from "../../db/database.js";
+
+export function registerAgentReminderRoutes(
+  app: FastifyInstance,
+  authService: AuthService,
+  db: DatabaseService
+): void {
+  const authMiddleware = createAuthMiddleware(authService);
+  const solicitService = new AgentSolicitService(db);
+
+  // Active reminders read (owner check not required for read, just auth)
+  app.get(
+    "/api/agent-reminders/active",
+    { preHandler: authMiddleware },
+    async (request: FastifyRequest) => {
+      const userId = request.sessionUser!.id;
+      return { reminders: solicitService.listActive(userId) };
+    }
+  );
+
+  // Create reminder (owner only)
+  app.post<{ Body: {
+    folder_group: string;
+    cadence_minutes: number;
+    repeat_limit?: number | null;
+    solicit_message?: string;
+    next_fire?: string | null;
+    recipients?: { agent_name: string; include?: number }[];
+  } }>(
+    "/api/agent-reminders",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request: FastifyRequest, reply: FastifyReply) => {
+      const body = request.body as any;
+      if (!body?.folder_group || typeof body.folder_group !== "string") {
+        return reply.code(400).send({ error: "folder_group is required" });
+      }
+      const cadence = Number(body.cadence_minutes);
+      if (!Number.isFinite(cadence) || cadence <= 0) {
+        return reply.code(400).send({ error: "cadence_minutes must be > 0" });
+      }
+      if (body.repeat_limit !== undefined && body.repeat_limit !== null) {
+        const rl = Number(body.repeat_limit);
+        if (!Number.isInteger(rl) || rl < 0) {
+          return reply.code(400).send({ error: "repeat_limit must be >= 0 or null" });
+        }
+      }
+
+      try {
+        const reminder = solicitService.create({
+          user_id: request.sessionUser!.id,
+          folder_group: body.folder_group,
+          cadence_minutes: cadence,
+          repeat_limit: body.repeat_limit ?? null,
+          solicit_message: body.solicit_message,
+          next_fire: body.next_fire ?? null,
+          recipients: body.recipients ?? [],
+          active: 1,
+        });
+        return reply.code(201).send({ reminder });
+      } catch (e) {
+        return reply.code(400).send({ error: (e as Error).message });
+      }
+    }
+  );
+
+  // Update reminder (owner only)
+  app.patch<{ Params: { id: string }; Body: {
+    folder_group?: string;
+    cadence_minutes?: number;
+    repeat_limit?: number | null;
+    next_fire?: string | null;
+    solicit_message?: string;
+    active?: number;
+    recipients?: { agent_name: string; include?: number }[];
+  } }>(
+    "/api/agent-reminders/:id",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request: FastifyRequest, reply: FastifyReply) => {
+      const id = Number(request.params.id);
+      const body = request.body as any;
+
+      if (body.cadence_minutes !== undefined) {
+        const cadence = Number(body.cadence_minutes);
+        if (!Number.isFinite(cadence) || cadence <= 0) {
+          return reply.code(400).send({ error: "cadence_minutes must be > 0" });
+        }
+      }
+      if (body.repeat_limit !== undefined && body.repeat_limit !== null) {
+        const rl = Number(body.repeat_limit);
+        if (!Number.isInteger(rl) || rl < 0) {
+          return reply.code(400).send({ error: "repeat_limit must be >= 0 or null" });
+        }
+      }
+
+      try {
+        const updated = solicitService.update(id, {
+          folder_group: body.folder_group,
+          cadence_minutes: body.cadence_minutes,
+          repeat_limit: body.repeat_limit,
+          next_fire: body.next_fire,
+          solicit_message: body.solicit_message,
+          active: body.active,
+          recipients: body.recipients,
+        });
+        if (!updated) {
+          return reply.code(404).send({ error: "Reminder not found" });
+        }
+        return { reminder: updated };
+      } catch (e) {
+        return reply.code(400).send({ error: (e as Error).message });
+      }
+    }
+  );
+
+  // Cancel reminder (owner only)
+  app.delete<{ Params: { id: string } }>(
+    "/api/agent-reminders/:id",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request: FastifyRequest, reply: FastifyReply) => {
+      const id = Number(request.params.id);
+      const ok = solicitService.delete(id);
+      if (!ok) {
+        return reply.code(404).send({ error: "Reminder not found" });
+      }
+      return reply.code(204).send();
+    }
+  );
+}
diff --git a/src/api/server.ts b/src/api/server.ts
index c9fa373..03ec61c 100644
--- a/src/api/server.ts
+++ b/src/api/server.ts
@@ -36,6 +36,7 @@ import { registerPersonalTaskRoutes } from "./routes/personal-task-routes.js";
 import { ReminderService } from "../services/reminder-service.js";
 import { registerReminderRoutes } from "./routes/reminder-routes.js";
 import { registerAgentRoutes } from "./routes/agent-routes.js";
+import { registerAgentReminderRoutes } from "./routes/agent-reminder-routes.js";
 import { AgentAssignmentService } from "../services/agent-assignment-service.js";
 import { CoordinatorLaunchService } from "../services/coordinator-launch-service.js";
 import { AgentEventsStreamManager } from "./websocket/agent-events-stream-manager.js";
@@ -195,6 +196,7 @@ export async function createApiServer(
   registerPersonalTaskRoutes(app, services.authService, services.personalTaskService);
   registerReminderRoutes(app, services.authService, services.reminderService);
   registerAgentRoutes(app, services.authService, services.agentAssignmentService, services.coordinatorLaunchService, services.tmuxService, services.projectService, services.safetyService);
+  registerAgentReminderRoutes(app, services.authService, services.db);
 
   if (services.agentEventsStreamManager) {
     registerAgentEventsRoutes(app, services.agentEventsStreamManager);
diff --git a/tests/agent-reminder-routes.test.ts b/tests/agent-reminder-routes.test.ts
new file mode 100644
index 0000000..384fcd8
--- /dev/null
+++ b/tests/agent-reminder-routes.test.ts
@@ -0,0 +1,204 @@
+import { describe, it, expect, beforeEach, afterEach } from "vitest";
+import Fastify from "fastify";
+import { DatabaseService } from "../src/db/database.js";
+import { registerAgentReminderRoutes } from "../src/api/routes/agent-reminder-routes.js";
+import { AuthService } from "../src/auth/auth-service.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+
+function tempDb() {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-routes-"));
+  return path.join(dir, "test.sqlite");
+}
+
+describe("agent-reminder-routes C4", () => {
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
+    // create users
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
+    registerAgentReminderRoutes(app, authService, db);
+    await app.ready();
+  });
+
+  afterEach(async () => {
+    await app.close();
+    db.close();
+    // cleanup temp dir
+    try {
+      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
+    } catch {}
+  });
+
+  it("GET /api/agent-reminders/active returns active reminders for owner", async () => {
+    // create a reminder directly via service
+    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
+    const svc = new AgentSolicitService(db);
+    svc.create({
+      user_id: ownerUserId,
+      folder_group: "g1",
+      cadence_minutes: 30,
+      recipients: [{ agent_name: "a1", include: 1 }],
+    });
+
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/agent-reminders/active",
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.reminders).toHaveLength(1);
+    expect(body.reminders[0].folder_group).toBe("g1");
+  });
+
+  it("POST creates reminder with owner token, fails for non-owner", async () => {
+    const resOwner = await app.inject({
+      method: "POST",
+      url: "/api/agent-reminders",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        folder_group: "g2",
+        cadence_minutes: 15,
+        repeat_limit: 3,
+        recipients: [{ agent_name: "a2", include: 0 }],
+      },
+    });
+    expect(resOwner.statusCode).toBe(201);
+    const body = JSON.parse(resOwner.body);
+    expect(body.reminder.folder_group).toBe("g2");
+    expect(body.reminder.cadence_minutes).toBe(15);
+
+    const resViewer = await app.inject({
+      method: "POST",
+      url: "/api/agent-reminders",
+      headers: { authorization: `Bearer ${viewerToken}` },
+      payload: { folder_group: "g3", cadence_minutes: 10 },
+    });
+    expect(resViewer.statusCode).toBe(403);
+  });
+
+  it("POST fails closed on malformed cadence and repeat", async () => {
+    const resBadCadence = await app.inject({
+      method: "POST",
+      url: "/api/agent-reminders",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { folder_group: "g", cadence_minutes: 0 },
+    });
+    expect(resBadCadence.statusCode).toBe(400);
+
+    const resBadRepeat = await app.inject({
+      method: "POST",
+      url: "/api/agent-reminders",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { folder_group: "g", cadence_minutes: 10, repeat_limit: -1 },
+    });
+    expect(resBadRepeat.statusCode).toBe(400);
+  });
+
+  it("PATCH updates reminder and include/skip, fails for non-owner", async () => {
+    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
+    const svc = new AgentSolicitService(db);
+    const r = svc.create({
+      user_id: ownerUserId,
+      folder_group: "g-upd",
+      cadence_minutes: 20,
+      recipients: [{ agent_name: "a1", include: 1 }],
+    });
+
+    const res = await app.inject({
+      method: "PATCH",
+      url: `/api/agent-reminders/${r.id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        cadence_minutes: 40,
+        recipients: [{ agent_name: "a1", include: 0 }, { agent_name: "a2", include: 1 }],
+      },
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.reminder.cadence_minutes).toBe(40);
+    expect(body.reminder.recipients).toHaveLength(2);
+    expect(body.reminder.recipients.find((x: any) => x.agent_name === "a1").include).toBe(0);
+
+    const resViewer = await app.inject({
+      method: "PATCH",
+      url: `/api/agent-reminders/${r.id}`,
+      headers: { authorization: `Bearer ${viewerToken}` },
+      payload: { cadence_minutes: 50 },
+    });
+    expect(resViewer.statusCode).toBe(403);
+  });
+
+  it("PATCH fails closed on malformed cadence", async () => {
+    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
+    const svc = new AgentSolicitService(db);
+    const r = svc.create({
+      user_id: ownerUserId,
+      folder_group: "g-bad",
+      cadence_minutes: 10,
+      recipients: [],
+    });
+
+    const res = await app.inject({
+      method: "PATCH",
+      url: `/api/agent-reminders/${r.id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { cadence_minutes: -5 },
+    });
+    expect(res.statusCode).toBe(400);
+  });
+
+  it("DELETE cancels reminder, fails for non-owner", async () => {
+    const { AgentSolicitService } = await import("../src/services/agent-solicit-service.js");
+    const svc = new AgentSolicitService(db);
+    const r = svc.create({
+      user_id: ownerUserId,
+      folder_group: "g-del",
+      cadence_minutes: 10,
+      recipients: [],
+    });
+
+    const resOwner = await app.inject({
+      method: "DELETE",
+      url: `/api/agent-reminders/${r.id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(resOwner.statusCode).toBe(204);
+
+    // recreate for viewer test
+    const r2 = svc.create({
+      user_id: ownerUserId,
+      folder_group: "g-del2",
+      cadence_minutes: 10,
+      recipients: [],
+    });
+    const resViewer = await app.inject({
+      method: "DELETE",
+      url: `/api/agent-reminders/${r2.id}`,
+      headers: { authorization: `Bearer ${viewerToken}` },
+    });
+    expect(resViewer.statusCode).toBe(403);
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

# THE SLICE — C4 (run command-center-2026-08-26)

## Scope (do ONLY this)
API layer: owner-only `registerAgentReminderRoutes` for create/update/cancel, include/skip, and active-reminder reads; non-owner and malformed cadence/repeat fail-closed.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **C1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C6** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice C4 -- npx vitest run tests/agent-reminder-routes.test.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=C4 attempt=1 role=validator
  marker=DRV-C4-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate C4 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator C4 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C4-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=C4 attempt=1 marker=DRV-C4-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
