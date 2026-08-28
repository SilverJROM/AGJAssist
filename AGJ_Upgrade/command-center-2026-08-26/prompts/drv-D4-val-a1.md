# [driver] D4 — THE COMMIT UNDER TEST IS `f83c817b50bbac5ba37312752433ab34de411dfa`

Analyse EXACTLY that commit: `git show f83c817b50bbac5ba37312752433ab34de411dfa`, `git diff f83c817b50bbac5ba37312752433ab34de411dfa^..f83c817b50bbac5ba37312752433ab34de411dfa`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=f83c817b50bbac5ba37312752433ab34de411dfa`.

## The change under test (produced by the driver, not reported by the implementer)
```
[D4] owner-only summary routes with endpoint CRUD/default and per-agent summaries


 src/api/routes/summary-routes.ts | 150 +++++++++++++++++++++++++++
 src/api/server.ts                |   2 +
 tests/summary-routes.test.ts     | 216 +++++++++++++++++++++++++++++++++++++++
 3 files changed, 368 insertions(+)
```
```diff
diff --git a/src/api/routes/summary-routes.ts b/src/api/routes/summary-routes.ts
new file mode 100644
index 0000000..474c9ff
--- /dev/null
+++ b/src/api/routes/summary-routes.ts
@@ -0,0 +1,150 @@
+import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
+import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
+import { AuthService } from "../../auth/auth-service.js";
+import { DatabaseService } from "../../db/database.js";
+import { SummaryEndpointService } from "../../services/summary-endpoint-service.js";
+
+function isOpenAICompatibleBaseUrl(urlString: string): boolean {
+  try {
+    const url = new URL(urlString);
+    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
+    // OpenAI-compatible base URL must end with /v1 or /v1/
+    const path = url.pathname;
+    return path === "/v1" || path === "/v1/";
+  } catch {
+    return false;
+  }
+}
+
+export function registerSummaryRoutes(
+  app: FastifyInstance,
+  authService: AuthService,
+  db: DatabaseService
+): void {
+  const authMiddleware = createAuthMiddleware(authService);
+  const endpointService = new SummaryEndpointService(db);
+
+  // List endpoints
+  app.get(
+    "/api/summary-endpoints",
+    { preHandler: [authMiddleware, requireOwner] },
+    async () => {
+      const list = endpointService.list();
+      return { endpoints: list };
+    }
+  );
+
+  // Get endpoint by id
+  app.get<{ Params: { id: string } }>(
+    "/api/summary-endpoints/:id",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request, reply) => {
+      const id = Number(request.params.id);
+      const ep = endpointService.getById(id);
+      if (!ep) return reply.code(404).send({ error: "Endpoint not found" });
+      return { endpoint: ep };
+    }
+  );
+
+  // Create endpoint
+  app.post<{ Body: { name: string; base_url: string; model: string; provenance?: string } }>(
+    "/api/summary-endpoints",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request, reply) => {
+      const body = request.body;
+      if (!body?.name || typeof body.name !== "string") {
+        return reply.code(400).send({ error: "name is required" });
+      }
+      if (!body?.base_url || typeof body.base_url !== "string") {
+        return reply.code(400).send({ error: "base_url is required" });
+      }
+      if (!isOpenAICompatibleBaseUrl(body.base_url)) {
+        return reply.code(400).send({ error: "base_url must be a valid http(s) URL ending with /v1" });
+      }
+      if (!body?.model || typeof body.model !== "string") {
+        return reply.code(400).send({ error: "model is required" });
+      }
+
+      try {
+        const created = endpointService.create({
+          name: body.name,
+          base_url: body.base_url,
+          model: body.model,
+          provenance: body.provenance,
+        });
+        // Do not log base_url or secrets
+        return reply.code(201).send({ endpoint: created });
+      } catch (e) {
+        return reply.code(400).send({ error: (e as Error).message });
+      }
+    }
+  );
+
+  // Update endpoint
+  app.patch<{ Params: { id: string }; Body: { name?: string; base_url?: string; model?: string } }>(
+    "/api/summary-endpoints/:id",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request, reply) => {
+      const id = Number(request.params.id);
+      const body = request.body;
+      if (body?.base_url) {
+        if (typeof body.base_url !== "string" || !isOpenAICompatibleBaseUrl(body.base_url)) {
+          return reply.code(400).send({ error: "base_url must be a valid http(s) URL ending with /v1" });
+        }
+      }
+      const updated = endpointService.update(id, {
+        name: body?.name,
+        base_url: body?.base_url,
+        model: body?.model,
+      });
+      if (!updated) return reply.code(404).send({ error: "Endpoint not found" });
+      return { endpoint: updated };
+    }
+  );
+
+  // Delete endpoint
+  app.delete<{ Params: { id: string } }>(
+    "/api/summary-endpoints/:id",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request, reply) => {
+      const id = Number(request.params.id);
+      const ok = endpointService.remove(id);
+      if (!ok) {
+        const ep = endpointService.getById(id);
+        if (!ep) return reply.code(404).send({ error: "Endpoint not found" });
+        return reply.code(400).send({ error: "Cannot remove default endpoint" });
+      }
+      return reply.code(204).send();
+    }
+  );
+
+  // Set default endpoint
+  app.post<{ Params: { id: string } }>(
+    "/api/summary-endpoints/:id/default",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request, reply) => {
+      const id = Number(request.params.id);
+      const ep = endpointService.getById(id);
+      if (!ep) return reply.code(404).send({ error: "Endpoint not found" });
+      const updated = endpointService.setDefault(id);
+      if (!updated) return reply.code(500).send({ error: "Failed to set default" });
+      return { endpoint: updated };
+    }
+  );
+
+  // Per-agent summaries newest first
+  app.get<{ Params: { agentName: string } }>(
+    "/api/summary-agents/:agentName/summaries",
+    { preHandler: [authMiddleware, requireOwner] },
+    async (request) => {
+      const agentName = request.params.agentName;
+      const rows = db.prepare(
+        `SELECT id, agent_name, endpoint_id, summary_text, provenance, created_at, updated_at
+         FROM agent_summaries
+         WHERE agent_name = ?
+         ORDER BY created_at DESC, id DESC`
+      ).all(agentName) as any[];
+      return { summaries: rows };
+    }
+  );
+}
diff --git a/src/api/server.ts b/src/api/server.ts
index 33770fd..0753eb1 100644
--- a/src/api/server.ts
+++ b/src/api/server.ts
@@ -62,6 +62,7 @@ import { McpBearerService } from "../mcp/mcp-bearer-service.js";
 import { McpRateLimiter } from "../mcp/mcp-rate-limit.js";
 import { registerMcpRoutes } from "./routes/mcp-routes.js";
 import { registerMcpManagementRoutes } from "./routes/mcp-management-routes.js";
+import { registerSummaryRoutes } from "./routes/summary-routes.js";
 
 const __dirname = path.dirname(fileURLToPath(import.meta.url));
 
@@ -197,6 +198,7 @@ export async function createApiServer(
   registerReminderRoutes(app, services.authService, services.reminderService);
   registerAgentRoutes(app, services.authService, services.agentAssignmentService, services.coordinatorLaunchService, services.tmuxService, services.projectService, services.safetyService);
   registerAgentReminderRoutes(app, services.authService, services.db);
+  registerSummaryRoutes(app, services.authService, services.db);
 
   if (services.agentEventsStreamManager) {
     registerAgentEventsRoutes(app, services.agentEventsStreamManager);
diff --git a/tests/summary-routes.test.ts b/tests/summary-routes.test.ts
new file mode 100644
index 0000000..48d49b4
--- /dev/null
+++ b/tests/summary-routes.test.ts
@@ -0,0 +1,216 @@
+import { describe, it, expect, beforeEach, afterEach } from "vitest";
+import Fastify from "fastify";
+import { DatabaseService } from "../src/db/database.js";
+import { registerSummaryRoutes } from "../src/api/routes/summary-routes.js";
+import { AuthService } from "../src/auth/auth-service.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+
+function tempDb() {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-summary-routes-"));
+  return path.join(dir, "test.sqlite");
+}
+
+describe("summary-routes D4", () => {
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
+    registerSummaryRoutes(app, authService, db);
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
+  it("GET /api/summary-endpoints lists endpoints for owner", async () => {
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.endpoints).toBeDefined();
+    expect(body.endpoints.length).toBeGreaterThanOrEqual(1);
+    const seeded = body.endpoints.find((e: any) => e.name === "140");
+    expect(seeded).toBeDefined();
+  });
+
+  it("GET /api/summary-endpoints rejects viewer", async () => {
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${viewerToken}` },
+    });
+    expect(res.statusCode).toBe(403);
+  });
+
+  it("POST creates endpoint with valid OpenAI-compatible base URL", async () => {
+    const res = await app.inject({
+      method: "POST",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        name: "test-ep",
+        base_url: "http://localhost:8080/v1",
+        model: "test-model",
+      },
+    });
+    expect(res.statusCode).toBe(201);
+    const body = JSON.parse(res.body);
+    expect(body.endpoint.name).toBe("test-ep");
+    expect(body.endpoint.base_url).toBe("http://localhost:8080/v1");
+    expect(body.endpoint.model).toBe("test-model");
+  });
+
+  it("POST rejects invalid base URL", async () => {
+    const res = await app.inject({
+      method: "POST",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: {
+        name: "bad-ep",
+        base_url: "http://localhost:8080", // missing /v1
+        model: "m",
+      },
+    });
+    expect(res.statusCode).toBe(400);
+  });
+
+  it("PATCH updates endpoint with valid base URL", async () => {
+    // create first
+    const createRes = await app.inject({
+      method: "POST",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { name: "upd-ep", base_url: "http://a/v1", model: "m1" },
+    });
+    const created = JSON.parse(createRes.body).endpoint;
+    const patchRes = await app.inject({
+      method: "PATCH",
+      url: `/api/summary-endpoints/${created.id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { base_url: "https://b.example/v1", model: "m2" },
+    });
+    expect(patchRes.statusCode).toBe(200);
+    const body = JSON.parse(patchRes.body);
+    expect(body.endpoint.base_url).toBe("https://b.example/v1");
+    expect(body.endpoint.model).toBe("m2");
+  });
+
+  it("PATCH rejects invalid base URL", async () => {
+    const createRes = await app.inject({
+      method: "POST",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { name: "upd-bad", base_url: "http://a/v1", model: "m1" },
+    });
+    const created = JSON.parse(createRes.body).endpoint;
+    const patchRes = await app.inject({
+      method: "PATCH",
+      url: `/api/summary-endpoints/${created.id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { base_url: "not-a-url" },
+    });
+    expect(patchRes.statusCode).toBe(400);
+  });
+
+  it("POST /api/summary-endpoints/:id/default sets default", async () => {
+    const createRes = await app.inject({
+      method: "POST",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { name: "def-ep", base_url: "http://c/v1", model: "m" },
+    });
+    const created = JSON.parse(createRes.body).endpoint;
+    const defRes = await app.inject({
+      method: "POST",
+      url: `/api/summary-endpoints/${created.id}/default`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(defRes.statusCode).toBe(200);
+    const body = JSON.parse(defRes.body);
+    expect(body.endpoint.is_default).toBe(1);
+  });
+
+  it("DELETE removes non-default endpoint", async () => {
+    const createRes = await app.inject({
+      method: "POST",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+      payload: { name: "del-ep", base_url: "http://d/v1", model: "m" },
+    });
+    const created = JSON.parse(createRes.body).endpoint;
+    const delRes = await app.inject({
+      method: "DELETE",
+      url: `/api/summary-endpoints/${created.id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(delRes.statusCode).toBe(204);
+  });
+
+  it("DELETE rejects removal of default endpoint", async () => {
+    const listRes = await app.inject({
+      method: "GET",
+      url: "/api/summary-endpoints",
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    const endpoints = JSON.parse(listRes.body).endpoints;
+    const def = endpoints.find((e: any) => e.is_default === 1);
+    const delRes = await app.inject({
+      method: "DELETE",
+      url: `/api/summary-endpoints/${def.id}`,
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(delRes.statusCode).toBe(400);
+  });
+
+  it("GET /api/summary-agents/:agentName/summaries returns newest first", async () => {
+    // Insert two summaries with different timestamps
+    const svc = db.prepare("INSERT INTO agent_summaries (agent_name, endpoint_id, summary_text, provenance) VALUES (?, ?, ?, ?)");
+    // Use first endpoint id
+    const epId = db.prepare("SELECT id FROM summary_llm_endpoints LIMIT 1").get() as { id: number };
+    svc.run("agent-x", epId.id, "first", "system");
+    // slight delay to ensure different created_at
+    await new Promise(r => setTimeout(r, 10));
+    svc.run("agent-x", epId.id, "second", "system");
+
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/summary-agents/agent-x/summaries",
+      headers: { authorization: `Bearer ${ownerToken}` },
+    });
+    expect(res.statusCode).toBe(200);
+    const body = JSON.parse(res.body);
+    expect(body.summaries).toHaveLength(2);
+    expect(body.summaries[0].summary_text).toBe("second");
+    expect(body.summaries[1].summary_text).toBe("first");
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

# THE SLICE — D4 (run command-center-2026-08-26)

## Scope (do ONLY this)
API layer: owner-only `registerSummaryRoutes` for endpoint CRUD/default and per-agent summary reads (newest first); validate OpenAI-compatible base URLs; secrets stay out of responses and logs.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **E2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice D4 -- npx vitest run tests/summary-routes.test.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D4 attempt=1 role=validator
  marker=DRV-D4-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate D4 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator D4 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/D4-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=D4 attempt=1 marker=DRV-D4-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
