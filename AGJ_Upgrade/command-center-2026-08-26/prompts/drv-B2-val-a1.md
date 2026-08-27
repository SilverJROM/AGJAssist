# [driver] B2 — THE COMMIT UNDER TEST IS `59fb99d5bbabf471dbff63af4f9e131224644c03`

Analyse EXACTLY that commit: `git show 59fb99d5bbabf471dbff63af4f9e131224644c03`, `git diff 59fb99d5bbabf471dbff63af4f9e131224644c03^..59fb99d5bbabf471dbff63af4f9e131224644c03`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=59fb99d5bbabf471dbff63af4f9e131224644c03`.

## The change under test (produced by the driver, not reported by the implementer)
```
[B2] remove overmind routes and ApiServices fields


 src/api/server.ts                  |  18 -----
 tests/overmind-removal-api.test.ts | 132 +++++++++++++++++++++++++++++++++++++
 2 files changed, 132 insertions(+), 18 deletions(-)
```
```diff
diff --git a/src/api/server.ts b/src/api/server.ts
index c919744..a868046 100644
--- a/src/api/server.ts
+++ b/src/api/server.ts
@@ -38,10 +38,6 @@ import { registerReminderRoutes } from "./routes/reminder-routes.js";
 import { registerAgentRoutes } from "./routes/agent-routes.js";
 import { AgentAssignmentService } from "../services/agent-assignment-service.js";
 import { CoordinatorLaunchService } from "../services/coordinator-launch-service.js";
-import { OvermindService } from "../services/overmind-service.js";
-import { registerOvermindRoutes } from "./routes/overmind-routes.js";
-import type { OvermindNotify } from "../services/overmind-watcher.js";
-import { OvermindStreamManager } from "./websocket/overmind-stream-manager.js";
 import { AgentEventsStreamManager } from "./websocket/agent-events-stream-manager.js";
 import { registerAgentEventsRoutes } from "./routes/agent-events-routes.js";
 import type { OvmSessionManager } from "../services/ovm-session.js";
@@ -86,9 +82,6 @@ export interface ApiServices {
   reminderService: ReminderService;
   agentAssignmentService: AgentAssignmentService;
   coordinatorLaunchService?: CoordinatorLaunchService;
-  overmindService: OvermindService;
-  overmindNotify?: OvermindNotify;
-  overmindStreamManager?: OvermindStreamManager;
   agentEventsStreamManager?: AgentEventsStreamManager;
   ovmSessionService?: OvmSessionManager;
   appSettingsService?: AppSettingsService;
@@ -200,17 +193,6 @@ export async function createApiServer(
   registerPersonalTaskRoutes(app, services.authService, services.personalTaskService);
   registerReminderRoutes(app, services.authService, services.reminderService);
   registerAgentRoutes(app, services.authService, services.agentAssignmentService, services.coordinatorLaunchService, services.tmuxService, services.projectService, services.safetyService);
-  registerOvermindRoutes(
-    app,
-    config,
-    services.authService,
-    services.overmindService,
-    services.overmindNotify,
-    services.overmindStreamManager,
-    services.ovmSessionService,
-    services.tmuxService,
-    services.nudgeStateService
-  );
 
   if (services.agentEventsStreamManager) {
     registerAgentEventsRoutes(app, services.agentEventsStreamManager);
diff --git a/tests/overmind-removal-api.test.ts b/tests/overmind-removal-api.test.ts
new file mode 100644
index 0000000..e567832
--- /dev/null
+++ b/tests/overmind-removal-api.test.ts
@@ -0,0 +1,132 @@
+import { describe, it, expect } from "vitest";
+import { readFileSync } from "node:fs";
+import { createApiServer } from "../src/api/server.js";
+import { AppConfig } from "../src/config/config.js";
+
+function minimalConfig(): AppConfig {
+  return {
+    telegram: {
+      botToken: "123:ABC",
+      authorizedUserId: 1,
+      authorizedChatIds: [1],
+      testMode: true,
+      updateMode: "polling",
+      webhookUrl: null,
+      webhookPath: "/api/telegram/webhook",
+      webhookSecretToken: "s"
+    },
+    runtime: {
+      workspaceRoot: "/tmp",
+      allowedCommandPrefixes: [],
+      maxToolIterations: 1,
+      defaultTimeoutMinutes: 1
+    },
+    api: {
+      port: 0,
+      host: "127.0.0.1",
+      jwtSecret: "s",
+      sessionExpiryHours: 24
+    },
+    db: { path: ":memory:" },
+    projects: { root: "/tmp" },
+    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
+    overmind: { token: "t" }
+  };
+}
+
+describe("overmind removal B2 API layer", () => {
+  it("server.ts does not import registerOvermindRoutes", () => {
+    const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
+    expect(src).not.toContain("registerOvermindRoutes");
+  });
+
+  it("server.ts does not import OvermindStreamManager", () => {
+    const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
+    expect(src).not.toContain("OvermindStreamManager");
+  });
+
+  it("ApiServices interface has no overmind fields", () => {
+    const src = readFileSync(new URL("../src/api/server.ts", import.meta.url), "utf8");
+    expect(src).not.toContain("overmindService");
+    expect(src).not.toContain("overmindNotify");
+    expect(src).not.toContain("overmindStreamManager");
+  });
+
+  it("GET /api/overmind/projects is not registered", async () => {
+    const app = await createApiServer(minimalConfig(), {
+      authService: {} as any,
+      projectService: {} as any,
+      safetyService: {} as any,
+      auditService: {} as any,
+      tmuxService: {} as any,
+      tmuxStreamManager: {} as any,
+      db: {} as any,
+      delegationService: {} as any,
+      noteService: {} as any,
+      planService: {} as any,
+      taskService: {} as any,
+      fileService: {} as any,
+      stepTemplateService: {} as any,
+      personalTaskService: {} as any,
+      reminderService: {} as any,
+      agentAssignmentService: {} as any,
+      appSettingsService: {} as any,
+      agentEventsStreamManager: {} as any
+    } as any);
+    const res = await app.inject({ method: "GET", url: "/api/overmind/projects" });
+    expect(res.statusCode).toBe(404);
+    await app.close();
+  });
+
+  it("POST /api/overmind/register is not registered", async () => {
+    const app = await createApiServer(minimalConfig(), {
+      authService: {} as any,
+      projectService: {} as any,
+      safetyService: {} as any,
+      auditService: {} as any,
+      tmuxService: {} as any,
+      tmuxStreamManager: {} as any,
+      db: {} as any,
+      delegationService: {} as any,
+      noteService: {} as any,
+      planService: {} as any,
+      taskService: {} as any,
+      fileService: {} as any,
+      stepTemplateService: {} as any,
+      personalTaskService: {} as any,
+      reminderService: {} as any,
+      agentAssignmentService: {} as any,
+      appSettingsService: {} as any,
+      agentEventsStreamManager: {} as any
+    } as any);
+    const res = await app.inject({ method: "POST", url: "/api/overmind/register", payload: { run_dir: "/tmp", token: "t" } });
+    expect(res.statusCode).toBe(404);
+    await app.close();
+  });
+
+  it("GET /api/overmind/describe is not registered", async () => {
+    const app = await createApiServer(minimalConfig(), {
+      authService: {} as any,
+      projectService: {} as any,
+      safetyService: {} as any,
+      auditService: {} as any,
+      tmuxService: {} as any,
+      tmuxStreamManager: {} as any,
+      db: {} as any,
+      delegationService: {} as any,
+      noteService: {} as any,
+      planService: {} as any,
+      taskService: {} as any,
+      fileService: {} as any,
+      stepTemplateService: {} as any,
+      personalTaskService: {} as any,
+      reminderService: {} as any,
+      agentAssignmentService: {} as any,
+      appSettingsService: {} as any,
+      agentEventsStreamManager: {} as any
+    } as any);
+    const res = await app.inject({ method: "GET", url: "/api/overmind/describe" });
+    expect(res.statusCode).toBe(404);
+    await app.close();
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

# THE SLICE — B2 (run command-center-2026-08-26)

## Scope (do ONLY this)
API layer only: remove `registerOvermindRoutes`, `OvermindStreamManager`, and Overmind fields from `ApiServices`; `/api/overmind/*` and its WebSocket no longer register. Runs after B6 so guardian no longer imports `overmind-routes`.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx vitest run tests/overmind-removal-api.test.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=B2 attempt=1 role=validator
  marker=DRV-B2-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate B2 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator B2 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B2-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=B2 attempt=1 marker=DRV-B2-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
