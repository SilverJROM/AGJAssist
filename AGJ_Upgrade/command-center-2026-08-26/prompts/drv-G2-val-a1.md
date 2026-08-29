# [driver] G2 — THE COMMIT UNDER TEST IS `6c26334bcfb0b7b3a8c8b97044938b2844965e08`

Analyse EXACTLY that commit: `git show 6c26334bcfb0b7b3a8c8b97044938b2844965e08`, `git diff 6c26334bcfb0b7b3a8c8b97044938b2844965e08^..6c26334bcfb0b7b3a8c8b97044938b2844965e08`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=6c26334bcfb0b7b3a8c8b97044938b2844965e08`.

## The change under test (produced by the driver, not reported by the implementer)
```
[G2] add guarded command center release script


 scripts/release-command-center.mjs        | 128 ++++++++++++++++++++++++++++++
 src/api/routes/agent-reminder-routes.ts   |   4 +-
 src/api/routes/agent-wakeup-routes.ts     |   2 +-
 tests/unit/release-command-center.spec.ts |  45 +++++++++++
 4 files changed, 176 insertions(+), 3 deletions(-)
```
```diff
diff --git a/scripts/release-command-center.mjs b/scripts/release-command-center.mjs
new file mode 100644
index 0000000..81c4627
--- /dev/null
+++ b/scripts/release-command-center.mjs
@@ -0,0 +1,128 @@
+#!/usr/bin/env node
+import { spawnSync } from "node:child_process";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+import readline from "node:readline/promises";
+import { fileURLToPath } from "node:url";
+import { stdin as input, stdout as output } from "node:process";
+import Database from "better-sqlite3";
+
+const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
+const markerIds = ["B8", "C6", "D7", "E5", "F7"];
+const agentEnvironmentKeys = ["TILLER_SLICE", "TILLER_RUN_DIR", "TILLER_ATTEMPT", "TILLER_SEAT"];
+const confirmationPhrase = "RELEASE COMMAND CENTER";
+
+function run(command, args, options = {}) {
+  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
+  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
+}
+
+function preReleaseSha() {
+  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
+  if (result.status !== 0) throw new Error("could not determine pre-release git SHA");
+  return result.stdout.trim();
+}
+
+function requireGreenMarkers() {
+  const missing = markerIds.filter((id) => !fs.existsSync(path.join(root, "AGJ_Upgrade", "command-center-2026-08-26", "dispatch", `advance-${id}.marker`)));
+  if (missing.length > 0) throw new Error(`required green markers are missing: ${missing.join(", ")}`);
+}
+
+async function backupDatabase(sourcePath, backupPath) {
+  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
+  try {
+    await source.backup(backupPath);
+  } finally {
+    source.close();
+  }
+}
+
+function migrateDatabase(dbPath) {
+  const result = spawnSync(
+    process.execPath,
+    [
+      "--import", "tsx", "--input-type=module", "--eval",
+      "import { DatabaseService } from './src/db/database.ts'; const db = new DatabaseService(process.argv[1]); db.close();",
+      dbPath
+    ],
+    { cwd: root, stdio: "inherit" }
+  );
+  if (result.status !== 0) throw new Error("database migration failed");
+}
+
+function timestamp() {
+  return new Date().toISOString().replace(/[-:.TZ]/g, "");
+}
+
+function printRollback(backupPath, sourcePath, sha) {
+  console.log(`[release-command-center] backup: ${backupPath}`);
+  console.log(`[release-command-center] rollback code: git reset --hard ${sha}`);
+  console.log(`[release-command-center] rollback database: cp ${backupPath} ${sourcePath}`);
+}
+
+function hasAgentEnvironment() {
+  return agentEnvironmentKeys.some((key) => process.env[key] !== undefined);
+}
+
+async function confirmHumanExecute() {
+  if (!input.isTTY) throw new Error("--execute requires an interactive TTY");
+  const terminal = readline.createInterface({ input, output });
+  try {
+    const answer = await terminal.question(`Type ${confirmationPhrase} to release command center: `);
+    if (answer !== confirmationPhrase) throw new Error("confirmation phrase did not match");
+  } finally {
+    terminal.close();
+  }
+}
+
+async function dryRun(sourcePath, sha) {
+  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-release-"));
+  const backupPath = `${sourcePath}.pre-release-${timestamp()}.bak`;
+  const migrationCopy = path.join(tmpDir, path.basename(sourcePath));
+  try {
+    await backupDatabase(sourcePath, backupPath);
+    fs.copyFileSync(backupPath, migrationCopy);
+    migrateDatabase(migrationCopy);
+    printRollback(backupPath, sourcePath, sha);
+    console.log("[release-command-center] DRY RUN passed; a temporary DB copy was migrated.");
+  } finally {
+    fs.rmSync(tmpDir, { recursive: true, force: true });
+  }
+}
+
+async function execute(sourcePath, sha) {
+  const backupPath = `${sourcePath}.pre-release-${timestamp()}.bak`;
+  await backupDatabase(sourcePath, backupPath);
+  migrateDatabase(sourcePath);
+  run("pm2", ["restart", "agjassist"]);
+  printRollback(backupPath, sourcePath, sha);
+  console.log("[release-command-center] execute completed");
+}
+
+async function main() {
+  const args = process.argv.slice(2);
+  if (args.some((arg) => arg !== "--dry-run" && arg !== "--execute") || (args.includes("--dry-run") && args.includes("--execute"))) {
+    throw new Error("usage: node scripts/release-command-center.mjs [--dry-run|--execute]");
+  }
+
+  const executeRequested = args.includes("--execute");
+  if (executeRequested && hasAgentEnvironment()) {
+    throw new Error("--execute is refused from a tiller or agent environment");
+  }
+  if (executeRequested) await confirmHumanExecute();
+
+  requireGreenMarkers();
+  const sha = preReleaseSha();
+  run("npm", ["run", "build"]);
+  const sourcePath = path.resolve(root, process.env.DB_PATH || "data/agjassist.db");
+  if (!fs.existsSync(sourcePath)) throw new Error(`DB_PATH does not exist: ${sourcePath}`);
+
+  if (executeRequested) await execute(sourcePath, sha);
+  else await dryRun(sourcePath, sha);
+}
+
+main().catch((error) => {
+  console.error(`[release-command-center] ${error instanceof Error ? error.message : String(error)}`);
+  process.exitCode = 1;
+});
diff --git a/src/api/routes/agent-reminder-routes.ts b/src/api/routes/agent-reminder-routes.ts
index eac9a91..db2530c 100644
--- a/src/api/routes/agent-reminder-routes.ts
+++ b/src/api/routes/agent-reminder-routes.ts
@@ -79,7 +79,7 @@ export function registerAgentReminderRoutes(
   } }>(
     "/api/agent-reminders/:id",
     { preHandler: [authMiddleware, requireOwner] },
-    async (request: FastifyRequest, reply: FastifyReply) => {
+    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
       const id = Number(request.params.id);
       const body = request.body as any;
 
@@ -120,7 +120,7 @@ export function registerAgentReminderRoutes(
   app.delete<{ Params: { id: string } }>(
     "/api/agent-reminders/:id",
     { preHandler: [authMiddleware, requireOwner] },
-    async (request: FastifyRequest, reply: FastifyReply) => {
+    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
       const id = Number(request.params.id);
       const ok = solicitService.delete(id);
       if (!ok) {
diff --git a/src/api/routes/agent-wakeup-routes.ts b/src/api/routes/agent-wakeup-routes.ts
index 4e0067f..006ef7c 100644
--- a/src/api/routes/agent-wakeup-routes.ts
+++ b/src/api/routes/agent-wakeup-routes.ts
@@ -71,7 +71,7 @@ export function registerAgentWakeupRoutes(
   app.delete<{ Params: { id: string } }>(
     "/api/agent-wakeups/:id",
     { preHandler: [authMiddleware, requireOwner] },
-    async (request: FastifyRequest, reply: FastifyReply) => {
+    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
       const id = Number(request.params.id);
       if (!Number.isInteger(id) || id <= 0) {
         return reply.code(400).send({ error: "Invalid id" });
diff --git a/tests/unit/release-command-center.spec.ts b/tests/unit/release-command-center.spec.ts
new file mode 100644
index 0000000..70ecaba
--- /dev/null
+++ b/tests/unit/release-command-center.spec.ts
@@ -0,0 +1,45 @@
+import { describe, expect, it } from "vitest";
+import { spawnSync } from "node:child_process";
+import crypto from "node:crypto";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+import { fileURLToPath } from "node:url";
+
+const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
+const script = path.join(root, "scripts/release-command-center.mjs");
+const liveDb = path.join(root, "data/agjassist.db");
+
+function fingerprint(filePath: string): string | null {
+  return fs.existsSync(filePath) ? crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") : null;
+}
+
+describe("release command center execute guard", () => {
+  it("refuses --execute in a tiller environment before DB writes or pm2 spawn", () => {
+    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-release-guard-"));
+    const pm2Probe = path.join(tempDir, "pm2-spawned");
+    const fakePm2 = path.join(tempDir, "pm2");
+    fs.writeFileSync(fakePm2, `#!/bin/sh\nprintf spawned > ${JSON.stringify(pm2Probe)}\n`);
+    fs.chmodSync(fakePm2, 0o755);
+    const before = fingerprint(liveDb);
+
+    try {
+      const result = spawnSync(process.execPath, [script, "--execute"], {
+        cwd: root,
+        encoding: "utf8",
+        env: {
+          ...process.env,
+          TILLER_SLICE: "G2",
+          PATH: `${tempDir}${path.delimiter}${process.env.PATH || ""}`
+        }
+      });
+
+      expect(result.status).not.toBe(0);
+      expect(`${result.stdout}${result.stderr}`).toContain("refused from a tiller or agent environment");
+      expect(fingerprint(liveDb)).toBe(before);
+      expect(fs.existsSync(pm2Probe)).toBe(false);
+    } finally {
+      fs.rmSync(tempDir, { recursive: true, force: true });
+    }
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

# THE SLICE — G2 (run command-center-2026-08-26)

## Scope (do ONLY this)
RELEASE-ATOMIC: add `scripts/release-command-center.mjs`. Default `--dry-run` requires green B8,C6,D7,E5,F7 markers, builds, migrates a `DB_PATH` copy, prints backup path plus rollback `git reset --hard <pre-release-sha>` and DB-restore. `--execute` is human-gated by MECHANISM: refuse unless stdin is a TTY AND the operator types the confirmation phrase AND none of `TILLER_SLICE`/`TILLER_RUN_DIR`/`TILLER_ATTEMPT`/`TILLER_SEAT` are set; any tiller/agent marker ⇒ hard refuse (non-zero, zero live DB writes, zero pm2). `tests/unit/release-command-center.spec.ts` MUST prove a tiller-env `--execute` is refused (exit non-zero, `data/agjassist.db` untouched, no `pm2` spawn). Tiller runs only dry-run + the refuse test, never `--execute`.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A4** — Migration drops `overmind_projects`, `overmind_workflows`, `overmind_task_history` (+ any overmind-only columns), with a timestamped DB backup taken first; a **fresh** DB and an **upgraded** DB converge to the same schema; `SCHEMA_VERSION` bumped.
- **A5** — After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the full unit + e2e suites are green (no dangling overmind imports/types).

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice G2 -- npx vitest run tests/unit/release-command-center.spec.ts --minWorkers=1 --maxWorkers=4 && npm run build`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=G2 attempt=1 role=validator
  marker=DRV-G2-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate G2 independently against its ACs; run the focused tests. ALSO perform a elite-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator G2 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/G2-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=G2 attempt=1 marker=DRV-G2-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=elite-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
