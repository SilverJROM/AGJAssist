# [driver] C3 — THE COMMIT UNDER TEST IS `1f87fe287aa4a783508ac69f8a402d430ebf3c84`

Analyse EXACTLY that commit: `git show 1f87fe287aa4a783508ac69f8a402d430ebf3c84`, `git diff 1f87fe287aa4a783508ac69f8a402d430ebf3c84^..1f87fe287aa4a783508ac69f8a402d430ebf3c84`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=1f87fe287aa4a783508ac69f8a402d430ebf3c84`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C3] add AgentReminderScheduler fireDue implementation and tests


 src/services/agent-reminder-scheduler.ts    |  97 +++++++++++++++++
 tests/unit/agent-reminder-scheduler.spec.ts | 159 ++++++++++++++++++++++++++++
 2 files changed, 256 insertions(+)
```
```diff
diff --git a/src/services/agent-reminder-scheduler.ts b/src/services/agent-reminder-scheduler.ts
new file mode 100644
index 0000000..f0cefed
--- /dev/null
+++ b/src/services/agent-reminder-scheduler.ts
@@ -0,0 +1,97 @@
+import { AgentSolicitService } from "./agent-solicit-service.js";
+import { SafetyService } from "./safety-service.js";
+import { AuditService } from "./audit-service.js";
+import { TmuxService } from "../tmux/tmux-service.js";
+import { TerminalGroupsService } from "./terminal-groups-service.js";
+import { DelegationService } from "./delegation-service.js";
+
+export interface FireDueResult {
+  reminderId: number;
+  sent: { agentName: string; target: string }[];
+  skipped: { agentName: string; reason: string }[];
+  auditIds: number[];
+}
+
+export class AgentReminderScheduler {
+  constructor(
+    private readonly solicitService: AgentSolicitService,
+    private readonly tmuxService: TmuxService,
+    private readonly safetyService: SafetyService,
+    private readonly auditService: AuditService,
+    private readonly groupsService: TerminalGroupsService,
+    private readonly delegationService: DelegationService
+  ) {}
+
+  async fireDue(userId: number, folderGroup?: string): Promise<FireDueResult[]> {
+    const due = this.solicitService.getDueReminders();
+    const filtered = folderGroup ? due.filter(r => r.folder_group === folderGroup) : due;
+    const results: FireDueResult[] = [];
+
+    for (const reminder of filtered) {
+      const result: FireDueResult = {
+        reminderId: reminder.id,
+        sent: [],
+        skipped: [],
+        auditIds: []
+      };
+
+      // Resolve current group panes
+      const group = this.groupsService.get(userId);
+      const groupMeta = group.groups.find(g => g.id === reminder.folder_group || g.name === reminder.folder_group);
+      const sessionNames = groupMeta?.sessions ?? [];
+
+      const includedRecipients = reminder.recipients.filter(r => r.include === 1);
+      const panes = await this.tmuxService.listPanes();
+      const solicitMessage = reminder.solicit_message || "give me a status update";
+
+      // Safety check once per reminder
+      const safety = this.safetyService.checkCommand(solicitMessage);
+      if (safety.blocked) {
+        // Skip all recipients if safety blocks
+        for (const recipient of includedRecipients) {
+          result.skipped.push({ agentName: recipient.agent_name, reason: "safety blocked" });
+        }
+      } else {
+        for (const recipient of includedRecipients) {
+          // Find tmux target for agent via session name
+          const matching = panes.find(p => p.session === recipient.agent_name);
+          if (!matching) {
+            result.skipped.push({ agentName: recipient.agent_name, reason: "no pane" });
+            continue;
+          }
+
+          const target = matching.target;
+
+          // Send via Tmux
+          const sendResult = await this.tmuxService.sendCommand(target, solicitMessage);
+          if (sendResult.blocked) {
+            result.skipped.push({ agentName: recipient.agent_name, reason: "safety blocked on send" });
+            continue;
+          }
+
+          // Audit
+          const auditId = this.auditService.log({
+            userId,
+            agentName: recipient.agent_name,
+            actionType: "reminder_fire",
+            resourceType: "agent_solicit_reminder",
+            resourceId: String(reminder.id),
+            details: { folder_group: reminder.folder_group, solicit_message: solicitMessage, target },
+            tmuxTarget: target,
+            surface: "miniapp"
+          });
+          result.auditIds.push(auditId);
+          result.sent.push({ agentName: recipient.agent_name, target });
+        }
+      }
+
+      // Advance / deactivate once per reminder
+      this.solicitService.advanceReminder(reminder.id);
+
+      // Skip excluded agents – they are not processed, no action needed
+      results.push(result);
+    }
+
+    return results;
+  }
+}
diff --git a/tests/unit/agent-reminder-scheduler.spec.ts b/tests/unit/agent-reminder-scheduler.spec.ts
new file mode 100644
index 0000000..e281f9f
--- /dev/null
+++ b/tests/unit/agent-reminder-scheduler.spec.ts
@@ -0,0 +1,159 @@
+import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
+import { DatabaseService } from "../../src/db/database.js";
+import { AgentSolicitService } from "../../src/services/agent-solicit-service.js";
+import { AgentReminderScheduler } from "../../src/services/agent-reminder-scheduler.js";
+import { SafetyService } from "../../src/services/safety-service.js";
+import { AuditService } from "../../src/services/audit-service.js";
+import { TerminalGroupsService } from "../../src/services/terminal-groups-service.js";
+import { DelegationService } from "../../src/services/delegation-service.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+
+const tempDirs: string[] = [];
+
+function tempDb(name: string): string {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-scheduler-"));
+  tempDirs.push(dir);
+  return path.join(dir, name);
+}
+
+afterEach(() => {
+  for (const dir of tempDirs.splice(0)) {
+    fs.rmSync(dir, { recursive: true, force: true });
+  }
+});
+
+describe("AgentReminderScheduler fireDue", () => {
+  let db: DatabaseService;
+  let solicitService: AgentSolicitService;
+  let safetyService: SafetyService;
+  let auditService: AuditService;
+  let groupsService: TerminalGroupsService;
+  let delegationService: DelegationService;
+  let tmuxService: any;
+  let scheduler: AgentReminderScheduler;
+  let userId: number;
+
+  beforeEach(() => {
+    const dbPath = tempDb("test.sqlite");
+    db = new DatabaseService(dbPath);
+    db.prepare("INSERT INTO users (telegram_id, role) VALUES (12345, 'owner')").run();
+    userId = (db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number }).id;
+
+    solicitService = new AgentSolicitService(db);
+    safetyService = new SafetyService(db);
+    auditService = new AuditService(db);
+    groupsService = new TerminalGroupsService(db);
+    delegationService = new DelegationService(db, auditService);
+
+    // Mock TmuxService
+    tmuxService = {
+      listPanes: vi.fn().mockResolvedValue([
+        { target: "sess-a:0.0", session: "agent-a", window: "0", pane: "0", command: "", title: "" },
+        { target: "sess-b:0.0", session: "agent-b", window: "0", pane: "0", command: "", title: "" }
+      ]),
+      sendCommand: vi.fn().mockResolvedValue({ message: "sent", blocked: false })
+    };
+
+    scheduler = new AgentReminderScheduler(
+      solicitService,
+      tmuxService,
+      safetyService,
+      auditService,
+      groupsService,
+      delegationService
+    );
+
+    // Create terminal group for user
+    groupsService.put(userId, {
+      groups: [{ id: "group-a", name: "group-a", sessions: ["agent-a", "agent-b"] }],
+      activeGroup: "group-a"
+    });
+  });
+
+  afterEach(() => {
+    db.close();
+    vi.clearAllMocks();
+  });
+
+  it("fires due reminder to included agents only, skips excluded, safety checks, audits, advances", async () => {
+    // Create due reminder with past next_fire
+    const reminder = solicitService.create({
+      user_id: userId,
+      folder_group: "group-a",
+      cadence_minutes: 30,
+      repeat_limit: null,
+      solicit_message: "give me a status update",
+      next_fire: "2000-01-01 00:00:00",
+      recipients: [
+        { agent_name: "agent-a", include: 1 },
+        { agent_name: "agent-b", include: 0 }
+      ]
+    });
+
+    const results = await scheduler.fireDue(userId);
+    expect(results).toHaveLength(1);
+    const res = results[0];
+    expect(res.reminderId).toBe(reminder.id);
+    expect(res.sent).toHaveLength(1);
+    expect(res.sent[0].agentName).toBe("agent-a");
+    expect(res.sent[0].target).toBe("sess-a:0.0");
+    expect(res.skipped).toHaveLength(0);
+
+    // Tmux send called only for included agent
+    expect(tmuxService.sendCommand).toHaveBeenCalledTimes(1);
+    expect(tmuxService.sendCommand).toHaveBeenCalledWith("sess-a:0.0", "give me a status update");
+
+    // Audit logged
+    expect(res.auditIds).toHaveLength(1);
+    const auditRows = db.prepare("SELECT * FROM audit_log WHERE action_type = ?").all("reminder_fire") as any[];
+    expect(auditRows).toHaveLength(1);
+    expect(auditRows[0].agent_name).toBe("agent-a");
+    expect(auditRows[0].tmux_target).toBe("sess-a:0.0");
+
+    // Reminder advanced
+    const updated = solicitService.getById(reminder.id);
+    expect(updated?.repeat_count).toBe(1);
+    // next_fire advanced by 30 minutes from 2000-01-01 00:00:00
+    // The service uses ISO string for advance, so we check repeat_count and active
+    expect(updated?.active).toBe(1);
+  });
+
+  it("skips agent with no pane", async () => {
+    const reminder = solicitService.create({
+      user_id: userId,
+      folder_group: "group-a",
+      cadence_minutes: 30,
+      solicit_message: "ping",
+      next_fire: "2000-01-01 00:00:00",
+      recipients: [{ agent_name: "agent-missing", include: 1 }]
+    });
+
+    const results = await scheduler.fireDue(userId);
+    expect(results[0].sent).toHaveLength(0);
+    expect(results[0].skipped).toHaveLength(1);
+    expect(results[0].skipped[0].reason).toBe("no pane");
+    expect(tmuxService.sendCommand).not.toHaveBeenCalled();
+  });
+
+  it("blocks send when safety pattern matches", async () => {
+    // Add safety pattern that blocks the message
+    safetyService.addPattern("give me a status update", "test block", false);
+
+    const reminder = solicitService.create({
+      user_id: userId,
+      folder_group: "group-a",
+      cadence_minutes: 30,
+      solicit_message: "give me a status update",
+      next_fire: "2000-01-01 00:00:00",
+      recipients: [{ agent_name: "agent-a", include: 1 }]
+    });
+
+    const results = await scheduler.fireDue(userId);
+    expect(results[0].sent).toHaveLength(0);
+    expect(results[0].skipped).toHaveLength(1);
+    expect(results[0].skipped[0].reason).toBe("safety blocked");
+    expect(tmuxService.sendCommand).not.toHaveBeenCalled();
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

# THE SLICE — C3 (run command-center-2026-08-26)

## Scope (do ONLY this)
Services layer, ONE claim=`fireDue`: resolve current group panes, skip excluded agents, pass every solicit through existing `SafetyService`+`TmuxService`, write `AuditService`, advance/deactivate repeats with the Mini App closed.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **C5** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice C3 -- npx vitest run tests/unit/agent-reminder-scheduler.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=C3 attempt=1 role=validator
  marker=DRV-C3-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate C3 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator C3 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C3-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=C3 attempt=1 marker=DRV-C3-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
