# [driver] B5 — THE COMMIT UNDER TEST IS `ccc0bdde524b4cbdb872ca70e747d05f76b4e8e0`

Analyse EXACTLY that commit: `git show ccc0bdde524b4cbdb872ca70e747d05f76b4e8e0`, `git diff ccc0bdde524b4cbdb872ca70e747d05f76b4e8e0^..ccc0bdde524b4cbdb872ca70e747d05f76b4e8e0`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=ccc0bdde524b4cbdb872ca70e747d05f76b4e8e0`.

## The change under test (produced by the driver, not reported by the implementer)
```
[B5] remove overmind/ovm commands from AssistantCore and TelegramAssistant


 src/bot/assistant-core.ts              | 27 +-----------
 src/bot/telegram-bot.ts                |  6 +--
 tests/overmind-command-removal.test.ts | 81 ++++++++++++++++++++++++++++++++++
 3 files changed, 83 insertions(+), 31 deletions(-)
```
```diff
diff --git a/src/bot/assistant-core.ts b/src/bot/assistant-core.ts
index aff4e87..0c9beb0 100644
--- a/src/bot/assistant-core.ts
+++ b/src/bot/assistant-core.ts
@@ -125,13 +125,7 @@ export class AssistantCore {
           "/lokalai_link - generate a one-time code to link this Telegram account to lokalAI",
           "/app - open the web app",
           "/timeout [minutes] - show or set command timeout (default 60)",
-          "/overmind - show active Overmind workflows",
-          "/om_tasks <id> - show an Overmind workflow tasklist",
-          "/om_pause <id> - pause Overmind checks (no interrupts while you talk to it)",
-          "/om_resume <id> - resume Overmind checks",
-          "/om_drop <id> - drop an Overmind workflow",
-          "/ovm_start - enter OVM chat mode",
-          "/ovm_end - exit OVM chat mode",
+
           "",
           "Directory commands:",
           "cd <dir> - change directory (within /home/agjrom/websites/)",
@@ -193,26 +187,7 @@ export class AssistantCore {
         return `Timeout updated: ${this.timeoutMinutes} minutes`;
       }
 
-      case "/overmind":
-        return this.handleOvermindStatusCommand();
-
-      case "/om_tasks":
-        return this.handleOvermindTasksCommand(parts[1]);
-
-      case "/om_pause":
-        return this.handleOvermindPauseMutation(parts[1], true);
-
-      case "/om_resume":
-        return this.handleOvermindPauseMutation(parts[1], false);
-
-      case "/om_drop":
-        return this.handleOvermindDropCommand(parts[1]);
-
-      case "/ovm_start":
-        return this.handleOvmStartCommand(uid);
 
-      case "/ovm_end":
-        return this.handleOvmEndCommand(uid);
 
       case "/tmux_create": {
         const projectName = parts[1];
diff --git a/src/bot/telegram-bot.ts b/src/bot/telegram-bot.ts
index e1ef279..e134354 100644
--- a/src/bot/telegram-bot.ts
+++ b/src/bot/telegram-bot.ts
@@ -86,11 +86,7 @@ export class TelegramAssistant {
         { command: "app", description: "Open the web app" },
         { command: "weblogin", description: "Get a web app login code" },
         { command: "lokalai_link", description: "Get a one-time lokalAI link code" },
-        { command: "overmind", description: "Active Overmind workflows" },
-        { command: "om_pause", description: "Pause Overmind checks for a workflow" },
-        { command: "om_resume", description: "Resume Overmind checks for a workflow" },
-        { command: "ovm_start", description: "Enter OVM chat mode" },
-        { command: "ovm_end", description: "Exit OVM chat mode" },
+
         { command: "jobs", description: "List tmux sessions" },
         { command: "tmux_send", description: "Send command to tmux pane" }
       ]);
diff --git a/tests/overmind-command-removal.test.ts b/tests/overmind-command-removal.test.ts
new file mode 100644
index 0000000..afdaa98
--- /dev/null
+++ b/tests/overmind-command-removal.test.ts
@@ -0,0 +1,81 @@
+import { describe, it, expect } from "vitest";
+import { AssistantCore } from "../src/bot/assistant-core.js";
+import type { AppConfig } from "../src/config/config.js";
+
+function testConfig(): AppConfig {
+  return {
+    telegram: {
+      botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
+      authorizedUserId: 111222,
+      authorizedChatIds: [],
+      testMode: true,
+      updateMode: "polling",
+      webhookUrl: null,
+      webhookPath: "/api/telegram/webhook",
+      webhookSecretToken: "test-secret"
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
+      jwtSecret: "test-secret",
+      sessionExpiryHours: 24
+    },
+    db: {
+      path: ":memory:"
+    },
+    projects: {
+      root: "/tmp"
+    },
+    tmux: {
+      historyRetentionDays: 7,
+      outputBufferLines: 5000,
+      streamIntervalMs: 100
+    },
+    overmind: {
+      token: "ovm-test-token"
+    }
+  };
+}
+
+describe("Overmind command removal", () => {
+  it("treats removed overmind/ovm commands as unknown", async () => {
+    const core = new AssistantCore(testConfig(), {} as any);
+    const removedCommands = [
+      "/overmind",
+      "/om_tasks 1",
+      "/om_pause 1",
+      "/om_resume 1",
+      "/om_drop 1",
+      "/ovm_start",
+      "/ovm_end"
+    ];
+
+    for (const cmd of removedCommands) {
+      const result = await core.handleCommand(cmd, 111222);
+      expect(result).toBe("Unknown command. Use /help.");
+    }
+  });
+
+  it("help text does not list removed commands", async () => {
+    const core = new AssistantCore(testConfig(), {} as any);
+    const help = await core.handleCommand("/help", 111222);
+    const forbidden = [
+      "/overmind",
+      "/om_tasks",
+      "/om_pause",
+      "/om_resume",
+      "/om_drop",
+      "/ovm_start",
+      "/ovm_end"
+    ];
+    for (const token of forbidden) {
+      expect(help).not.toContain(token);
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

# THE SLICE — B5 (run command-center-2026-08-26)

## Scope (do ONLY this)
Bot layer only: remove `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end` from `AssistantCore` and `TelegramAssistant`; they follow the normal unknown-command path.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx vitest run tests/overmind-command-removal.test.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=B5 attempt=1 role=validator
  marker=DRV-B5-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate B5 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator B5 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B5-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=B5 attempt=1 marker=DRV-B5-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
