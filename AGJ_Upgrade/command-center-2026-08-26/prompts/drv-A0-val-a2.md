# [driver] A0 — THE COMMIT UNDER TEST IS `0a7bcdcd71d052d506329b25bcf9f9f75d7a3be6`

Analyse EXACTLY that commit: `git show 0a7bcdcd71d052d506329b25bcf9f9f75d7a3be6`, `git diff 0a7bcdcd71d052d506329b25bcf9f9f75d7a3be6^..0a7bcdcd71d052d506329b25bcf9f9f75d7a3be6`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=0a7bcdcd71d052d506329b25bcf9f9f75d7a3be6`.

## The change under test (produced by the driver, not reported by the implementer)
```
[A0] In-process FENCE_STUB preload, remove HTTP proxy


 scripts/cc-run-isolated.mjs | 98 +--------------------------------------------
 src/index.ts                | 33 +++++++++++++++
 2 files changed, 35 insertions(+), 96 deletions(-)
```
```diff
diff --git a/scripts/cc-run-isolated.mjs b/scripts/cc-run-isolated.mjs
index 402bdff..9b15a18 100644
--- a/scripts/cc-run-isolated.mjs
+++ b/scripts/cc-run-isolated.mjs
@@ -3,14 +3,13 @@ import { spawnSync, spawn } from 'node:child_process';
 import fs from 'node:fs';
 import os from 'node:os';
 import path from 'node:path';
-import http from 'node:http';
 
 const args = process.argv.slice(2);
 const serve = args.includes('--serve');
+
 const SRC_DB = process.env.DB_PATH_SOURCE || 'data/agjassist.db';
 const srcDbPath = path.resolve(SRC_DB);
 const PUBLIC_PORT = 3210;
-const UPSTREAM_PORT = 3211;
 
 function ensureTmpDb(tmpDir) {
   fs.mkdirSync(tmpDir, { recursive: true });
@@ -23,117 +22,24 @@ function ensureTmpDb(tmpDir) {
   return tmpDb;
 }
 
-// FENCE_STUB replaces a named contributor's effect in-process (fence-contract.json's
-// negative_control_cmd), applied at the network boundary in front of the real Fastify
-// server so the same page.request-driven assertions observe the stubbed behaviour —
-// page.route() cannot see page.request traffic, so per-spec route() stubs can't reach it.
-const FENCE_STUB_HANDLERS = {
-  // B2 (plan.md): removes registerOvermindRoutes so /api/overmind/status stops
-  // existing (404). Stubbing B2 re-registers a synthetic 200 here so B8's negative
-  // control keeps proving the fence catches a regression once B2 actually lands.
-  B2: (req, res) => {
-    const pathname = (req.url || '').split('?')[0];
-    if (pathname === '/api/overmind/status') {
-      res.writeHead(200, { 'content-type': 'application/json' });
-      res.end(JSON.stringify({ stubbed: true, contributor: 'B2' }));
-      return true;
-    }
-    return false;
-  },
-  C3: (req, res) => {
-    const pathname = (req.url || '').split('?')[0];
-    if (pathname === '/api/agent-reminders/active') {
-      res.writeHead(500, { 'content-type': 'application/json' });
-      res.end(JSON.stringify({ stubbed: true, contributor: 'C3' }));
-      return true;
-    }
-    return false;
-  },
-  D3: (req, res) => {
-    const pathname = (req.url || '').split('?')[0];
-    if (pathname === '/api/summary-endpoints') {
-      res.writeHead(500, { 'content-type': 'application/json' });
-      res.end(JSON.stringify({ stubbed: true, contributor: 'D3' }));
-      return true;
-    }
-    return false;
-  },
-  E2: (req, res) => {
-    const pathname = (req.url || '').split('?')[0];
-    if (pathname === '/api/agent-wakeups/fire') {
-      res.writeHead(500, { 'content-type': 'application/json' });
-      res.end(JSON.stringify({ stubbed: true, contributor: 'E2' }));
-      return true;
-    }
-    return false;
-  },
-  F1: (req, res) => {
-    const pathname = (req.url || '').split('?')[0];
-    if (pathname === '/api/agent-group-switcher') {
-      res.writeHead(500, { 'content-type': 'application/json' });
-      res.end(JSON.stringify({ stubbed: true, contributor: 'F1' }));
-      return true;
-    }
-    return false;
-  },
-};
-
-function startStubProxy(stub) {
-  const handler = FENCE_STUB_HANDLERS[stub];
-  const proxy = http.createServer((req, res) => {
-    if (handler && handler(req, res)) return;
-    const upstreamReq = http.request(
-      { host: '127.0.0.1', port: UPSTREAM_PORT, path: req.url, method: req.method, headers: req.headers },
-      (upstreamRes) => {
-        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
-        upstreamRes.pipe(res);
-      }
-    );
-    upstreamReq.on('error', () => { res.writeHead(502); res.end('upstream unavailable'); });
-    req.pipe(upstreamReq);
-  });
-  proxy.on('upgrade', (req, socket, head) => {
-    const upstreamReq = http.request({
-      host: '127.0.0.1', port: UPSTREAM_PORT, path: req.url, method: req.method, headers: req.headers
-    });
-    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
-      socket.write(
-        `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n` +
-        Object.entries(upstreamRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n'
-      );
-      upstreamSocket.write(upstreamHead);
-      upstreamSocket.pipe(socket);
-      socket.pipe(upstreamSocket);
-    });
-    upstreamReq.on('error', () => socket.destroy());
-    upstreamReq.end(head);
-  });
-  proxy.listen(PUBLIC_PORT);
-  return proxy;
-}
-
 if (serve) {
   const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
   const tmpDb = ensureTmpDb(tmpDir);
   const startSize = fs.statSync(tmpDb).size;
-  const stub = process.env.FENCE_STUB || '';
-  const port = stub ? UPSTREAM_PORT : PUBLIC_PORT;
   const env = {
     ...process.env,
     DB_PATH: tmpDb,
     AGJASSIST_FENCE_DB_MODE: 'temp-copy',
-    API_PORT: String(port),
+    API_PORT: String(PUBLIC_PORT),
     API_HOST: '127.0.0.1',
     TEST_MODE: 'true'
   };
   // Real Fastify entrypoint (src/index.ts) via tsx's node --import loader hook —
   // serves the shipped app through Fastify's own static registration, not a stand-in.
   const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { stdio: 'inherit', env });
-  const proxy = stub ? startStubProxy(stub) : null;
   const cleanup = () => {
     try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
     console.log(`reclaimed_bytes=${startSize}`);
-    if (proxy) proxy.close();
     server.kill();
   };
   process.on('SIGINT', cleanup);
diff --git a/src/index.ts b/src/index.ts
index 6d6a1e2..e1a2218 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -158,6 +158,39 @@ async function main(): Promise<void> {
     telegramAssistant
   });
 
+  // FENCE_STUB in-process preload: patch Fastify before route registration
+  if (process.env.FENCE_STUB) {
+    const stub = process.env.FENCE_STUB;
+    apiServer.addHook('preHandler', async (request, reply) => {
+      const url = request.url || '';
+      // B2: make overmind status return 200 for negative control
+      if (stub === 'B2' && url.startsWith('/api/overmind/status')) {
+        reply.code(200).type('application/json').send({ stubbed: true, contributor: 'B2' });
+        return reply;
+      }
+      // C3: make reminders active fail
+      if (stub === 'C3' && url.startsWith('/api/agent-reminders/active')) {
+        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'C3' });
+        return reply;
+      }
+      // D3: make summary endpoints fail
+      if (stub === 'D3' && url.startsWith('/api/summary-endpoints')) {
+        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'D3' });
+        return reply;
+      }
+      // E2: make wakeups fire fail
+      if (stub === 'E2' && url.startsWith('/api/agent-wakeups/fire')) {
+        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'E2' });
+        return reply;
+      }
+      // F1: make agent group switcher fail
+      if (stub === 'F1' && url.startsWith('/api/agent-group-switcher')) {
+        reply.code(500).type('application/json').send({ stubbed: true, contributor: 'F1' });
+        return reply;
+      }
+    });
+  }
+
   await apiServer.listen({ port: config.api.port, host: config.api.host });
   console.log(`AGJAssist API server listening on ${config.api.host}:${config.api.port}`);
   overmindWatcher.start();
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

# THE SLICE — A0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Validator gates this row on `--harness-smoke` exit 0, NEVER on product A5. `acs` is HARNESS-SMOKE (not A5 — A5 stays B8/G2). Recovered HEAD still uses an HTTP proxy for FENCE_STUB (`scripts/cc-run-isolated.mjs` startStubProxy); remaining work: replace that with in-process Fastify preload so FENCE_STUB=ID patches the unit before route/job registration (INTERCEPTION_GAP). Also: every spec writes fence-report-v1.json in finally; `--gate` requires named expected_negative_fail_ids kind=assert (no synthesized ids); print reclaimed_bytes. Recovered commits already on HEAD (3439337). No product OVM removal.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --harness-smoke`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=A0 attempt=1 role=validator
  marker=DRV-A0-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate A0 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator A0 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/A0-fix-a2.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=A0 attempt=2 marker=DRV-A0-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
