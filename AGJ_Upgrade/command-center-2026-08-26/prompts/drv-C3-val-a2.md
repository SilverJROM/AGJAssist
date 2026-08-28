# [driver] C3 — THE COMMIT UNDER TEST IS `22c4ae4c92ca23808d06251dc705a591552ab769`

Analyse EXACTLY that commit: `git show 22c4ae4c92ca23808d06251dc705a591552ab769`, `git diff 22c4ae4c92ca23808d06251dc705a591552ab769^..22c4ae4c92ca23808d06251dc705a591552ab769`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=22c4ae4c92ca23808d06251dc705a591552ab769`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C3] fix user scoping and group session restriction in fireDue


 src/services/agent-reminder-scheduler.ts    | 15 ++++--
 tests/unit/agent-reminder-scheduler.spec.ts | 78 +++++++++++++++++++++++++++++
 2 files changed, 89 insertions(+), 4 deletions(-)
```
```diff
diff --git a/src/services/agent-reminder-scheduler.ts b/src/services/agent-reminder-scheduler.ts
index f0cefed..38b815f 100644
--- a/src/services/agent-reminder-scheduler.ts
+++ b/src/services/agent-reminder-scheduler.ts
@@ -24,7 +24,8 @@ export class AgentReminderScheduler {
 
   async fireDue(userId: number, folderGroup?: string): Promise<FireDueResult[]> {
     const due = this.solicitService.getDueReminders();
-    const filtered = folderGroup ? due.filter(r => r.folder_group === folderGroup) : due;
+    const userDue = due.filter(r => r.user_id === userId);
+    const filtered = folderGroup ? userDue.filter(r => r.folder_group === folderGroup) : userDue;
     const results: FireDueResult[] = [];
 
     for (const reminder of filtered) {
@@ -38,10 +39,11 @@ export class AgentReminderScheduler {
       // Resolve current group panes
       const group = this.groupsService.get(userId);
       const groupMeta = group.groups.find(g => g.id === reminder.folder_group || g.name === reminder.folder_group);
-      const sessionNames = groupMeta?.sessions ?? [];
+      const sessionNames = new Set(groupMeta?.sessions ?? []);
 
       const includedRecipients = reminder.recipients.filter(r => r.include === 1);
-      const panes = await this.tmuxService.listPanes();
+      const allPanes = await this.tmuxService.listPanes();
+      const panes = allPanes.filter(p => sessionNames.has(p.session));
       const solicitMessage = reminder.solicit_message || "give me a status update";
 
       // Safety check once per reminder
@@ -53,7 +55,12 @@ export class AgentReminderScheduler {
         }
       } else {
         for (const recipient of includedRecipients) {
-          // Find tmux target for agent via session name
+          // Only process recipients whose agent is in current group sessions
+          if (!sessionNames.has(recipient.agent_name)) {
+            result.skipped.push({ agentName: recipient.agent_name, reason: "outside group" });
+            continue;
+          }
+          // Find tmux target for agent via session name within group
           const matching = panes.find(p => p.session === recipient.agent_name);
           if (!matching) {
             result.skipped.push({ agentName: recipient.agent_name, reason: "no pane" });
diff --git a/tests/unit/agent-reminder-scheduler.spec.ts b/tests/unit/agent-reminder-scheduler.spec.ts
index e281f9f..4ed1400 100644
--- a/tests/unit/agent-reminder-scheduler.spec.ts
+++ b/tests/unit/agent-reminder-scheduler.spec.ts
@@ -121,6 +121,12 @@ describe("AgentReminderScheduler fireDue", () => {
   });
 
   it("skips agent with no pane", async () => {
+    // Make agent-missing part of group sessions
+    groupsService.put(userId, {
+      groups: [{ id: "group-a", name: "group-a", sessions: ["agent-missing"] }],
+      activeGroup: "group-a"
+    });
+
     const reminder = solicitService.create({
       user_id: userId,
       folder_group: "group-a",
@@ -156,4 +162,76 @@ describe("AgentReminderScheduler fireDue", () => {
     expect(results[0].skipped[0].reason).toBe("safety blocked");
     expect(tmuxService.sendCommand).not.toHaveBeenCalled();
   });
+
+  it("restricts due reminders to caller user", async () => {
+    // Create second user
+    db.prepare("INSERT INTO users (telegram_id, role) VALUES (99999, 'owner')").run();
+    const userBId = (db.prepare("SELECT id FROM users WHERE telegram_id = 99999").get() as { id: number }).id;
+
+    // Reminder for user A
+    const reminderA = solicitService.create({
+      user_id: userId,
+      folder_group: "group-a",
+      cadence_minutes: 30,
+      solicit_message: "ping A",
+      next_fire: "2000-01-01 00:00:00",
+      recipients: [{ agent_name: "agent-a", include: 1 }]
+    });
+
+    // Reminder for user B
+    const reminderB = solicitService.create({
+      user_id: userBId,
+      folder_group: "group-a",
+      cadence_minutes: 30,
+      solicit_message: "ping B",
+      next_fire: "2000-01-01 00:00:00",
+      recipients: [{ agent_name: "agent-a", include: 1 }]
+    });
+
+    const results = await scheduler.fireDue(userId);
+    // Only user A's reminder should be processed
+    expect(results).toHaveLength(1);
+    expect(results[0].reminderId).toBe(reminderA.id);
+    expect(results[0].sent).toHaveLength(1);
+
+    const updatedA = solicitService.getById(reminderA.id);
+    const updatedB = solicitService.getById(reminderB.id);
+    expect(updatedA?.repeat_count).toBe(1);
+    expect(updatedB?.repeat_count).toBe(0);
+  });
+
+  it("skips recipients outside current group sessions", async () => {
+    // Group contains only agent-inside
+    groupsService.put(userId, {
+      groups: [{ id: "group-a", name: "group-a", sessions: ["agent-inside"] }],
+      activeGroup: "group-a"
+    });
+
+    // Mock panes for both inside and outside agents
+    tmuxService.listPanes.mockResolvedValue([
+      { target: "sess-in:0.0", session: "agent-inside", window: "0", pane: "0", command: "", title: "" },
+      { target: "sess-out:0.0", session: "agent-outside", window: "0", pane: "0", command: "", title: "" }
+    ]);
+
+    const reminder = solicitService.create({
+      user_id: userId,
+      folder_group: "group-a",
+      cadence_minutes: 30,
+      solicit_message: "ping",
+      next_fire: "2000-01-01 00:00:00",
+      recipients: [
+        { agent_name: "agent-inside", include: 1 },
+        { agent_name: "agent-outside", include: 1 }
+      ]
+    });
+
+    const results = await scheduler.fireDue(userId);
+    expect(results[0].sent).toHaveLength(1);
+    expect(results[0].sent[0].agentName).toBe("agent-inside");
+    expect(results[0].skipped).toHaveLength(1);
+    expect(results[0].skipped[0].agentName).toBe("agent-outside");
+    expect(results[0].skipped[0].reason).toBe("outside group");
+    expect(tmuxService.sendCommand).toHaveBeenCalledTimes(1);
+    expect(tmuxService.sendCommand).toHaveBeenCalledWith("sess-in:0.0", "ping");
+  });
 });
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C3-fix-a2.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=C3 attempt=2 marker=DRV-C3-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
